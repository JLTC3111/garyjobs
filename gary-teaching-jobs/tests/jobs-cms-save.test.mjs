import test from 'node:test';
import assert from 'node:assert/strict';
import {saveJobsContent} from '../dist/jobs-cms-save.js';

function database({entries = [], published = [], onSave, readError} = {}) {
  const calls = {reads: [], saves: []};
  const tables = {jobs_cms_entries: entries, jobs_public_content: published};
  const db = {
    from(table) {
      let rows = tables[table];
      const q = {
        select() { return q; },
        eq(key, value) { rows = rows.filter(row => row[key] === value); return q; },
        like(key, value) { rows = rows.filter(row => row[key].startsWith(value.slice(0, -1))); return q; },
        order() { rows = [...rows].sort((a, b) => a.slug.localeCompare(b.slug)); return q; },
        async range(from, to) { calls.reads.push({table, from, to}); return readError ? {error: readError} : {data: rows.slice(from, to + 1)}; },
        async single() { calls.reads.push({table}); return readError ? {error: readError} : {data: rows[0]}; },
      };
      return q;
    },
    async rpc(name, args) {
      assert.equal(name, 'jobs_cms_save');
      calls.saves.push(structuredClone(args));
      if (onSave) return onSave(args, calls.saves.length);
      return {data: {...args.p_record, id: args.p_record.id || 'saved', version: Number(args.p_expected_version || 0) + 1}};
    },
  };
  return {db, calls};
}
const vacancy = title => ({kind: 'vacancy', title_en: title, title_vi: '', slug: '', version: 0, data: {}});
const reserved = slug => ({kind: 'vacancy', slug});
const collision = {code: '23505', message: 'duplicate key violates unique constraint "jobs_cms_entries_kind_slug_key"'};

test('new vacancy saves a title-generated address without asking for an address', async () => {
  const h = database(), record = {...vacancy('English Teacher — Hanoi!'), slug: 'not-the-title'};
  const saved = await saveJobsContent(h.db, record, {expectedVersion: 0});
  assert.equal(saved.slug, 'english-teacher-hanoi');
  assert.equal(record.slug, 'not-the-title', 'Caller draft is not mutated before persistence');
  assert.equal(h.calls.saves[0].p_expected_version, 0);
});

test('Vietnamese-only draft titles generate safe URL names', async () => {
  const h = database();
  const saved = await saveJobsContent(h.db, {...vacancy(''), title_vi: 'Đào tạo Tiếng Anh tại Đà Nẵng'});
  assert.equal(saved.slug, 'dao-tao-tieng-anh-tai-da-nang');
});

test('repeated titles receive suffixes while reserving existing published addresses', async () => {
  const h = database({entries: [reserved('english-teacher'), reserved('english-teacher-2')], published: [reserved('english-teacher-3')]});
  const saved = await saveJobsContent(h.db, vacancy('English teacher'));
  assert.equal(saved.slug, 'english-teacher-4');
});

test('collision lookups page past 500 records instead of reusing an occupied address', async () => {
  const h = database({entries: Array.from({length: 601}, (_, i) => reserved(i ? `teacher-${i + 1}` : 'teacher'))});
  const saved = await saveJobsContent(h.db, vacancy('Teacher'));
  assert.equal(saved.slug, 'teacher-602');
  assert.ok(h.calls.reads.some(call => call.table === 'jobs_cms_entries' && call.from === 500));
});

test('a concurrent same-title insert retries the database URL constraint', async () => {
  const entries = [];
  const h = database({entries, onSave(args, attempt) {
    if (attempt === 1) { entries.push(reserved(args.p_record.slug)); return {error: collision}; }
    return {data: {...args.p_record, id: 'saved', version: 1}};
  }});
  const saved = await saveJobsContent(h.db, vacancy('Teacher'));
  assert.equal(saved.slug, 'teacher-2');
  assert.equal(h.calls.saves.length, 2);
});

test('existing vacancy titles and stale client address fields cannot rename a saved URL', async () => {
  const h = database({entries: [{...reserved('original-teacher'), id: 'existing'}]});
  const saved = await saveJobsContent(h.db, {...vacancy('A new title'), id: 'existing', slug: 'accidental-rename', version: 4}, {expectedVersion: 4});
  assert.equal(saved.slug, 'original-teacher');
  assert.equal(h.calls.saves[0].p_expected_version, 4);
  assert.equal(h.calls.saves.length, 1);
});

test('permission failures, stale versions and other unique errors are never retried', async () => {
  for (const error of [{code: '42501'}, {code: '40001'}, {code: '23505', message: 'jobs_cms_revisions_entry_id_version_key'}, {message: 'Network error'}]) {
    const h = database({onSave: () => ({error})});
    await assert.rejects(() => saveJobsContent(h.db, vacancy('Teacher')), actual => actual === error);
    assert.equal(h.calls.saves.length, 1);
  }
});

test('URL lookups never bypass a denied Jobs content read', async () => {
  const error = {code: '42501'}, h = database({readError: error});
  await assert.rejects(() => saveJobsContent(h.db, vacancy('Teacher')), actual => actual === error);
  assert.equal(h.calls.saves.length, 0);
});

test('missing titles are rejected without a hidden address-field requirement', async () => {
  const h = database();
  await assert.rejects(() => saveJobsContent(h.db, vacancy('  ')), /jobs.title_required/);
  assert.equal(h.calls.reads.length, 0);
  assert.equal(h.calls.saves.length, 0);
});

test('other content collections keep their independent manual address behavior', async () => {
  const h = database();
  const saved = await saveJobsContent(h.db, {kind: 'category', title_en: 'Schools', slug: 'public-schools'});
  assert.equal(saved.slug, 'public-schools');
  assert.equal(h.calls.reads.length, 0);
});
