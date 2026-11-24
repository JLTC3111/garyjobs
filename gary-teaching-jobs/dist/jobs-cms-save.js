import {titleSlug} from './cms-foundation/content.js';
import {responseError} from './conflict-response.js';

const unwrap = result => { if (result.error) throw responseError(result); return result.data; };
const slugConflict = error => error?.code === '23505' && /jobs_cms_entries_kind_slug_key/.test(`${error.message || ''} ${error.details || ''}`);

async function reservedSlugs(db, base, kind) {
  const groups = await Promise.all(['jobs_cms_entries', 'jobs_public_content'].map(async table => {
    const slugs = [];
    for (let from = 0; ; from += 500) {
      const rows = unwrap(await db.from(table).select('slug').eq('kind', kind).like('slug', base + '%').order('slug').range(from, from + 499));
      slugs.push(...rows.map(row => row.slug));
      if (rows.length < 500) return slugs;
    }
  }));
  return new Set(groups.flat());
}

function availableSlug(base, reserved) {
  if (!reserved.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!reserved.has(candidate)) return candidate;
  }
}

/** Use the caller's Jobs permissions; database uniqueness remains authoritative. */
export async function saveJobsContent(db, record, {expectedVersion, automaticSlug = record.kind === 'vacancy'} = {}) {
  const payload = structuredClone(record);
  const save = () => db.rpc('jobs_cms_save', {p_record: payload, p_expected_version: expectedVersion ?? null});
  if (!automaticSlug) return unwrap(await save());

  if (payload.id && Number(expectedVersion ?? payload.version) > 0) {
    // A title edit must never change a previously assigned URL/reference name.
    const existing = unwrap(await db.from('jobs_cms_entries').select('slug').eq('id', payload.id).single());
    payload.slug = existing.slug;
    return unwrap(await save());
  }

  const base = titleSlug(payload);
  if (!base) throw new Error('jobs.title_required');
  let reserved = await reservedSlugs(db, base, payload.kind);
  for (let attempt = 0; attempt < 8; attempt++) {
    payload.slug = availableSlug(base, reserved);
    const result = await save();
    if (!result.error) return result.data;
    // Another editor may save the same title between the lookup and insert.
    // Retry only this exact URL conflict, not permission/version/network errors.
    if (!slugConflict(result.error) || attempt === 7) throw responseError(result);
    const fresh = await reservedSlugs(db, base, payload.kind);
    reserved = new Set([...reserved, ...fresh, payload.slug]);
  }
}
