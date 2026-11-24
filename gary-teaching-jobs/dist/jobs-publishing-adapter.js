import {saveJobsContent} from './jobs-cms-save.js';
import {responseError} from './conflict-response.js';
import {validateEntry, emptyEntry} from './cms-foundation/content.js';
import {loadReferenceOptions} from './jobs-reference-data.js';
import {categoryOptions, locationOptions, resolveVacancyOption} from './jobs-vacancy-options.js';

const REFERENCE_KINDS = ['employer', 'category', 'location'];
const unwrap = result => { if (result.error) throw result.error; return result.data; };
const issueError = issues => Object.assign(new Error('jobs.publication_invalid'), {code: 'JOBS_VALIDATION', issues});

export function createJobsPublishingAdapter(db, {collections}) {
  const collectionFor = kind => collections.find(collection => collection.kind === kind);
  async function referenceOptions(kind) {
    if (!REFERENCE_KINDS.includes(kind)) throw new Error('jobs.invalid_reference_kind');
    return loadReferenceOptions(db, kind);
  }
  function normalizeVacancy(record) {
    const copy = structuredClone(record);
    if (copy.kind !== 'vacancy') return copy;
    const data = copy.data ||= {};
    for (const key of ['employer_name_en','employer_name_vi','contact_email']) if (data[key] !== undefined) data[key] = String(data[key]).trim();
    // A legacy name is usable without any profile being available or published.
    if (data.employer_name_en == null && data.employer_slug) data.employer_name_en = String(data.employer_slug).trim();
    const aliases = {'public-schools':'public','language-centers':'centers','ha-noi':'hanoi','danang':'da-nang','hcmc':'ho-chi-minh'};
    for (const [key,options] of [['category_slug',categoryOptions],['location_slug',locationOptions]]) {
      const raw = data[key]; if (raw) data[key] = aliases[raw] || resolveVacancyOption(raw,options);
    }
    return copy;
  }
  async function prepare(record) {
    const copy = normalizeVacancy(record);
    if (record.kind === 'vacancy' && record.data?.employer_name_en == null && record.data?.employer_slug) {
      try {
        const choices = await referenceOptions('employer'), old = record.data.employer_slug;
        const choice = choices.find(item => item.value === old || Object.values(item.label).some(name => name === old));
        if (choice) { copy.data.employer_name_en = choice.label.en; copy.data.employer_name_vi = choice.label.vi; }
      } catch { /* Names remain editable even if the old profile cannot be loaded. */ }
    }
    return copy;
  }
  function publicationError(error) {
    if (Array.isArray(error?.issues)) return error;
    try {
      const detail = JSON.parse(error?.details || error?.detail || '{}');
      const issues = Array.isArray(detail) ? detail : detail.issues;
      if (Array.isArray(issues) && issues.length) return Object.assign(issueError(issues), {cause:error});
    } catch { /* Unstructured connection/authorization errors keep their original message. */ }
    return error;
  }
  async function validatePublication(record) {
    const collection = collectionFor(record.kind);
    if (!collection) throw new Error('jobs.invalid_content');
    return validateEntry(normalizeVacancy(record), collection, true);
  }
  async function save(record, options = {}) {
    return saveJobsContent(db, normalizeVacancy(record), {...options, automaticSlug: !!collectionFor(record.kind)?.automaticSlug});
  }
  async function transition(id, status, {expectedVersion} = {}) {
    if (status === 'review' || status === 'published') {
      const record = unwrap(await db.from('jobs_cms_entries').select('*').eq('id', id).single());
      if (record.version !== expectedVersion) throw Object.assign(new Error('jobs.version_conflict'), {code: 'PT409', status: 409});
      const issues = await validatePublication(record);
      if (issues.length) throw issueError(issues);
    }
    const result = await db.rpc('jobs_cms_transition', {p_id: id, p_status: status, p_expected_version: expectedVersion});
    if (result.error) throw publicationError(responseError(result));
    return result.data;
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
  return {prepare, referenceOptions, validatePublication, save, transition, createReference};
}
