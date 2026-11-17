import {saveJobsContent} from './jobs-cms-save.js';
import {validateEntry, emptyEntry} from './cms-foundation/content.js';
import {loadReferenceOptions, normalizeReferences, validateReferences, resolveReference} from './jobs-reference-data.js';

const REFERENCE_KINDS = ['employer', 'category', 'location'];
const unwrap = result => { if (result.error) throw result.error; return result.data; };
const issueError = issues => Object.assign(new Error('jobs.publication_invalid'), {code: 'JOBS_VALIDATION', issues});

export function createJobsPublishingAdapter(db, {collections}) {
  const collectionFor = kind => collections.find(collection => collection.kind === kind);
  async function referenceOptions(kind) {
    if (!REFERENCE_KINDS.includes(kind)) throw new Error('jobs.invalid_reference_kind');
    return loadReferenceOptions(db, kind);
  }
  async function referenceMap() {
    const pairs = await Promise.all(REFERENCE_KINDS.map(async kind => {
      try { return [kind, await referenceOptions(kind)]; }
      catch (cause) {
        throw Object.assign(issueError([{code: 'jobs-reference-lookup-failed', field: `data.${kind}_slug`, params: {kind}, severity: 'critical'}]), {cause});
      }
    }));
    return Object.fromEntries(pairs);
  }
  async function validatePublication(record) {
    const collection = collectionFor(record.kind);
    if (!collection) throw new Error('jobs.invalid_content');
    const issues = validateEntry(record, collection, true);
    if (record.kind !== 'vacancy') return issues;
    if (record.data?.contact_email && record.data.contact_email !== String(record.data.contact_email).trim()) issues.push({code: 'jobs-field-save-required', field: 'data.contact_email', params: {}, severity: 'critical'});
    const options = await referenceMap();
    issues.push(...validateReferences(record, options));
    for (const kind of REFERENCE_KINDS) {
      const raw = record.data?.[`${kind}_slug`], resolved = resolveReference(raw, options[kind]);
      if (resolved.status === 'resolved' && raw !== resolved.value) issues.push({code: 'jobs-reference-selection-required', field: `data.${kind}_slug`, params: {kind, value: raw, resolvedValue: resolved.value}, severity: 'critical'});
    }
    return issues;
  }
  async function save(record, options = {}) {
    let normalized = structuredClone(record);
    if (record.kind === 'vacancy') {
      try { normalized = normalizeReferences(record, await referenceMap()); }
      catch (error) {
        // Reference availability must not prevent saving an incomplete draft.
        // Review/publication still require a fresh successful lookup below.
        if (!error.issues?.every(issue => issue.code === 'jobs-reference-lookup-failed')) throw error;
      }
      if (normalized.data?.contact_email !== undefined) normalized.data.contact_email = String(normalized.data.contact_email).trim();
    }
    return saveJobsContent(db, normalized, {...options, automaticSlug: !!collectionFor(record.kind)?.automaticSlug});
  }
  async function transition(id, status, {expectedVersion} = {}) {
    let record;
    if (status === 'review' || status === 'published') {
      record = unwrap(await db.from('jobs_cms_entries').select('*').eq('id', id).single());
      if (record.version !== expectedVersion) throw Object.assign(new Error('jobs.version_conflict'), {code: '40001'});
      const issues = await validatePublication(record);
      if (issues.length) throw issueError(issues);
    }
    const result = await db.rpc('jobs_cms_transition', {p_id: id, p_status: status, p_expected_version: expectedVersion});
    if (result.error && record && result.error.message?.includes('jobs.references_required')) {
      // A linked record may have been archived between preflight and publication.
      const issues = await validatePublication(record);
      if (issues.length) throw issueError(issues);
    }
    return unwrap(result);
  }
  async function createReference(kind, input) {
    if (!REFERENCE_KINDS.includes(kind)) throw new Error('jobs.invalid_reference_kind');
    const caps = unwrap(await db.rpc('jobs_capabilities'));
    if (!caps?.edit || !caps?.publish) throw Object.assign(new Error('jobs.publisher_required'), {code: '42501'});
    const record = {...emptyEntry(kind), ...input, kind, data: input.data || {}};
    const issues = validateEntry(record, collectionFor(kind), true);
    if (issues.length) throw issueError(issues);
    let persisted;
    try {
      persisted = await save(record, {expectedVersion: input.version || 0});
      persisted = await transition(persisted.id, 'review', {expectedVersion: persisted.version});
      persisted = await transition(persisted.id, 'published', {expectedVersion: persisted.version});
      return persisted;
    } catch (error) {
      if (persisted) error.partialRecord = persisted;
      throw error;
    }
  }
  return {referenceOptions, validatePublication, save, transition, createReference};
}
