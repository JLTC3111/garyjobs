import test from 'node:test';
import assert from 'node:assert/strict';
import {loadReferenceOptions, resolveReference, validateReferences, normalizeReferences} from '../dist/jobs-reference-data.js';

const row = (id, slug, title_en, title_vi, extra = {}) => ({id, slug, title_en, title_vi, kind: 'employer', ...extra});
function database({published = [], drafts = [], errorTable, error} = {}) {
  const reads = [];
  return {reads, from(table) {
    let rows = table === 'jobs_public_content' ? published : drafts;
    const q = {
      select(columns) { assert.equal(columns.includes('status'), table === 'jobs_cms_entries'); return q; },
      eq(key, value) { rows = rows.filter(item => item[key] === value); return q; },
      order() { return q; },
      async range(from, to) { reads.push({table, from, to}); return table === errorTable ? {error} : {data: rows.slice(from, to + 1)}; },
    };
    return q;
  }};
}
const published = (value, en, vi, extra = {}) => ({id: value, value, label: {en, vi}, published: true, status: 'published', ...extra});
const options = [published('abc-school', 'ABC School', 'Trường ABC'), published('hanoi', 'Hanoi', 'Hà Nội')];

test('reference options retain live snapshot slug/title when its working draft is renamed', async () => {
  const db = database({
    published: [row('a', 'original-school', 'Original school', 'Trường gốc')],
    drafts: [row('a', 'renamed-school', 'Renamed school', 'Trường đổi tên', {status: 'draft'}), row('b', 'draft-school', 'Draft school', 'Trường bản nháp', {status: 'review'})],
  });
  const result = await loadReferenceOptions(db, 'employer');
  assert.deepEqual(result.find(option => option.id === 'a'), published('original-school', 'Original school', 'Trường gốc', {id: 'a'}));
  assert.deepEqual(result.find(option => option.id === 'b'), {id: 'b', value: 'draft-school', label: {en: 'Draft school', vi: 'Trường bản nháp'}, published: false, status: 'review'});
});

test('published snapshots are retained even if a working entry is absent from a read', async () => {
  const db = database({published: [row('a', 'school', 'School', 'Trường')]});
  const result = await loadReferenceOptions(db, 'employer');
  assert.equal(result.length, 1);assert.equal(result[0].published, true);
});

test('reference options handle empty datasets, filter by kind and paginate beyond 500', async () => {
  assert.deepEqual(await loadReferenceOptions(database(), 'location'), []);
  const drafts = Array.from({length: 510}, (_, i) => row(String(i), 'school-' + i, 'School ' + i, 'Trường ' + i, {status: 'draft'}));
  drafts.push(row('unrelated', 'other', 'Other', 'Khác', {kind: 'category'}));
  const db = database({drafts}), result = await loadReferenceOptions(db, 'employer');
  assert.equal(result.length, 510);
  assert.ok(db.reads.some(call => call.table === 'jobs_cms_entries' && call.from === 500));
});

test('lookup failures propagate instead of pretending no reference records exist', async () => {
  for (const errorTable of ['jobs_public_content', 'jobs_cms_entries']) {
    const error = {code: '42501', message: 'Denied'}, db = database({errorTable, error});
    await assert.rejects(() => loadReferenceOptions(db, 'employer'), actual => actual === error);
  }
  await assert.rejects(() => loadReferenceOptions(database(), 'vacancy'), /reference_kind_invalid/);
});

test('legacy reference values resolve only exact slugs or unique normalized EN/VI titles', () => {
  assert.equal(resolveReference(' abc-school ', options).value, 'abc-school');
  assert.equal(resolveReference('  abc  SCHOOL ', options).value, 'abc-school');
  assert.equal(resolveReference('  Hà   Nội ', options).value, 'hanoi');
  assert.equal(resolveReference('Trường ABC', options).value, 'abc-school');
  assert.equal(resolveReference('HANOI', options).value, 'hanoi', 'This resolves through the human title, not a case-insensitive slug');
  assert.equal(resolveReference('ABC-SCHOOL', options).status, 'unavailable');
});

test('matching published slugs take precedence while ambiguous names never select a record', () => {
  const duplicate = [published('school-a', 'School', 'Trường A'), published('school-b', 'School', 'Trường B')];
  assert.equal(resolveReference('School', duplicate).status, 'ambiguous');
  assert.equal(resolveReference('school-a', duplicate).value, 'school-a');
  assert.equal(resolveReference('abc-school', [...options, {...published('abc-school', 'A draft', 'Bản nháp'), id: 'other', published: false, status: 'draft'}]).option.id, 'abc-school');
  assert.equal(resolveReference('School', [duplicate[0], {...duplicate[1], published: false}]).status, 'ambiguous');
});

test('unpublished, unknown and absent references remain distinct', () => {
  const draft = {...published('draft', 'Draft school', 'Trường bản nháp'), published: false, status: 'draft'};
  assert.equal(resolveReference('draft', [draft]).status, 'unpublished');
  assert.equal(resolveReference('Draft school', [draft]).status, 'unpublished');
  assert.equal(resolveReference('Unknown', options).status, 'unavailable');
  assert.equal(resolveReference('  ', options).status, 'required');
});

test('reference validation returns stable field-specific codes and parameters', () => {
  const record = {kind: 'vacancy', data: {employer_slug: '', category_slug: 'Missing', location_slug: 'Draft place'}};
  const issues = validateReferences(record, {location: [{...published('draft-place', 'Draft place', 'Nơi bản nháp'), published: false, status: 'draft'}]});
  assert.deepEqual(issues.map(issue => [issue.code, issue.field]), [
    ['jobs-reference-required', 'data.employer_slug'],
    ['jobs-reference-unavailable', 'data.category_slug'],
    ['jobs-reference-unpublished', 'data.location_slug'],
  ]);
  assert.ok(issues.every(issue => issue.severity === 'critical' && issue.params.kind && typeof issue.params.value === 'string'));
  assert.deepEqual(validateReferences({kind: 'guide'}, {}), []);
});

test('normalization resolves recognized legacy labels without mutating or discarding input', () => {
  const record = {kind: 'vacancy', title_en: 'My draft', data: {employer_slug: '  ABC School ', category_slug: 'Unrecognized category', location_slug: 'Hà Nội', benefits_en: 'Keep this text'}};
  const before = structuredClone(record);
  const normalized = normalizeReferences(record, {employer: options, location: options});
  assert.equal(normalized.data.employer_slug, 'abc-school');assert.equal(normalized.data.location_slug, 'hanoi');
  assert.equal(normalized.data.category_slug, 'Unrecognized category');assert.equal(normalized.data.benefits_en, 'Keep this text');
  assert.deepEqual(record, before);assert.notEqual(normalized, record);assert.notEqual(normalized.data, record.data);
  const duplicates = [published('one', 'School', 'Một'), published('two', 'School', 'Hai')];
  assert.equal(normalizeReferences({kind: 'vacancy', data: {employer_slug: 'School'}}, {employer: duplicates}).data.employer_slug, 'School');
});
