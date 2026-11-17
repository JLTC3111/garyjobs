const REFERENCE_KINDS = Object.freeze(['employer', 'category', 'location']);
const unwrap = result => { if (result.error) throw result.error; return result.data; };
const normalizedTitle = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();

async function referenceRows(db, table, kind) {
  const rows = [];
  const columns = 'id,slug,title_en,title_vi' + (table === 'jobs_cms_entries' ? ',status' : '');
  for (let from = 0; ; from += 500) {
    const page = unwrap(await db.from(table).select(columns).eq('kind', kind).order('slug').order('id').range(from, from + 499));
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

function option(row, published) {
  return {
    id: row.id,
    value: row.slug,
    label: {en: String(row.title_en || row.title_vi || row.slug), vi: String(row.title_vi || row.title_en || row.slug)},
    published,
    status: published ? 'published' : row.status || 'draft',
  };
}

/** References target the live snapshot, which can differ from the working draft. */
export async function loadReferenceOptions(db, kind) {
  if (!REFERENCE_KINDS.includes(kind)) throw new Error('jobs.reference_kind_invalid');
  const [published, drafts] = await Promise.all([
    referenceRows(db, 'jobs_public_content', kind),
    referenceRows(db, 'jobs_cms_entries', kind),
  ]);
  const snapshots = new Map(published.map(row => [row.id, row]));
  const options = drafts.map(row => {
    const live = snapshots.get(row.id);
    snapshots.delete(row.id);
    return option(live || row, !!live);
  });
  options.push(...[...snapshots.values()].map(row => option(row, true)));
  return options.sort((a, b) => a.value.localeCompare(b.value) || String(a.id).localeCompare(String(b.id)));
}

/** Never guess between similarly named records or infer publication from draft status. */
export function resolveReference(value, options = []) {
  const raw = String(value ?? ''), requested = raw.trim();
  if (!requested) return {status: 'required', value: raw};
  const exact = options.filter(item => item.value === requested);
  const exactPublished = exact.filter(item => item.published === true);
  if (exactPublished.length === 1) return {status: 'resolved', value: exactPublished[0].value, option: exactPublished[0]};
  if (exactPublished.length > 1) return {status: 'ambiguous', value: raw};
  if (exact.length) return {status: exact.length === 1 ? 'unpublished' : 'ambiguous', value: raw};
  const title = normalizedTitle(requested);
  const matches = options.filter(item => [item.label?.en, item.label?.vi].some(label => label && normalizedTitle(label) === title));
  if (matches.length > 1) return {status: 'ambiguous', value: raw};
  if (!matches.length) return {status: 'unavailable', value: raw};
  const match = matches[0];
  return match.published === true ? {status: 'resolved', value: match.value, option: match} : {status: 'unpublished', value: raw};
}

export function validateReferences(record, optionMap = {}) {
  if (record.kind !== 'vacancy') return [];
  return REFERENCE_KINDS.flatMap(kind => {
    const key = `${kind}_slug`, result = resolveReference(record.data?.[key], optionMap[kind] || []);
    return result.status === 'resolved' ? [] : [{
      code: `jobs-reference-${result.status}`,
      field: `data.${key}`,
      params: {kind, value: result.value},
      severity: 'critical',
    }];
  });
}

/** Resolve recognized legacy names on a clone; preserve unknown/ambiguous input. */
export function normalizeReferences(record, optionMap = {}) {
  const copy = structuredClone(record);
  if (record.kind !== 'vacancy') return copy;
  for (const kind of REFERENCE_KINDS) {
    const key = `${kind}_slug`, result = resolveReference(record.data?.[key], optionMap[kind] || []);
    if (result.status === 'resolved') (copy.data ||= {})[key] = result.value;
  }
  return copy;
}
