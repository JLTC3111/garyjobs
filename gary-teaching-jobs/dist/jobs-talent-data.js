import {portraitPathPattern, signedPortrait} from './jobs-public-content.js';

export const talentStages = {
  new: ['New', 'Mới'],
  screening: ['Screening', 'Sàng lọc'],
  shortlisted: ['Shortlisted', 'Vào danh sách chọn'],
  interview: ['Interview', 'Phỏng vấn'],
  offer: ['Offer', 'Mời nhận việc'],
  placed: ['Placed', 'Đã bố trí việc làm'],
  rejected: ['Rejected', 'Không phù hợp'],
  withdrawn: ['Withdrawn', 'Đã rút hồ sơ']
};

export const talentSpecialties = {
  early_years: ['Early years', 'Mầm non'],
  primary: ['Primary', 'Tiểu học'],
  secondary: ['Secondary', 'Trung học'],
  english_language: ['English language', 'Tiếng Anh'],
  exam_preparation: ['Exam preparation', 'Luyện thi'],
  business_english: ['Business English', 'Tiếng Anh thương mại'],
  other: ['Other', 'Khác']
};

export const talentAvailability = {
  now: ['Available now', 'Có thể bắt đầu ngay'],
  within_month: ['Within a month', 'Trong vòng một tháng'],
  later: ['Later', 'Có thể bắt đầu muộn hơn'],
  unavailable: ['Unavailable', 'Chưa thể nhận việc']
};

export const talentPageSize = 18;
export const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const normalized = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase().trim();
export const candidateKey = record => `${record.source}:${record.id}`;
const missingDirectory = error => ['PGRST202', '42883'].includes(error?.code);
const privatePortraits = 'jobs-talent-portraits';

export function filterCandidates(records, filters, language) {
  const query = normalized(filters.query);
  const location = normalized(filters.location);
  const minimum = filters.min_experience === '' || filters.min_experience==null ? null : Number(filters.min_experience);
  return records.filter(row => {
    const specialty = Object.hasOwn(talentSpecialties,row.specialty) ? talentSpecialties[row.specialty].join(' ') : '';
    return (!query || normalized([row.full_name, row.email, row.location, specialty].join(' ')).includes(query))
      && (!location || normalized(row.location).includes(location))
      && (!filters.stage || row.stage === filters.stage)
      && (!filters.specialty || row.specialty === filters.specialty)
      && (!filters.availability || row.availability === filters.availability)
      && (minimum === null || (Number.isFinite(row.experience_years) && row.experience_years >= minimum));
  }).sort((a, b) => a.full_name.localeCompare(b.full_name, language === 'vi' ? 'vi-VN' : 'en'));
}

export function showcaseReady(record) {
  return record?.status === 'draft' && record.placement_confirmed === true
    && record.consent_confirmed === true && record.portrait_ready === true
    && ['public_name', 'specialty_en', 'specialty_vi', 'story_en', 'story_vi']
      .every(field => typeof record[field] === 'string' && record[field].trim());
}

export function applicationStage(value) {
  if (value === 'hired') return 'placed';
  return Object.hasOwn(talentStages, value) ? value : 'new';
}

function applicant(row) {
  return {
    id: row.id, source: 'applicant', full_name: row.full_name, email: row.email,
    location: row.current_location, phone: row.phone, stage: applicationStage(row.jobs_applications?.[0]?.stage),
    applications: row.jobs_applications || []
  };
}

function hasIdentity(row) {
  return typeof row?.id === 'string' && row.id.length > 0 && ['applicant', 'talent'].includes(row.source)
    && typeof row.full_name === 'string' && Object.hasOwn(talentStages, row.stage);
}

export function createTalentAdapter({db, unwrap, deadline, backend}) {
  let applicantRows;
  const run = (request, signal) => deadline(request.abortSignal(signal));
  const rpc = (name, params, signal) => run(db.rpc(name, params), signal);
  async function portraits(records, signal) {
    const paths = [...new Set(records.map(row => row.portrait_path).filter(path => portraitPathPattern.test(path || '')))];
    const signed = new Map();
    if (paths.length) {
      try {
        const result = await deadline(db.storage.from(privatePortraits).createSignedUrls(paths, 300));
        signal.throwIfAborted();
        if (!result.error) for (const item of result.data || []) {
          signed.set(item.path, signedPortrait(item.signedUrl, backend, privatePortraits));
        }
      } catch {
        signal.throwIfAborted();
      }
    }
    return records.map(row => ({...row, portrait_url: signed.get(row.portrait_path) || ''}));
  }
  async function legacyDirectory(signal) {
    const rows = new Map();
    const batchSize = 200;
    for (let offset = 0; ; offset += batchSize) {
      signal.throwIfAborted();
      const batch = unwrap(await run(db.from('jobs_candidates')
        .select('id,full_name,email,current_location,jobs_applications(stage)')
        .order('id').order('updated_at', {ascending:false, referencedTable:'jobs_applications'})
        .order('id', {referencedTable:'jobs_applications'}).limit(1, {referencedTable:'jobs_applications'})
        .range(offset, offset + batchSize - 1), signal));
      for (const row of batch) rows.set(row.id, applicant(row));
      if (batch.length < batchSize) return [...rows.values()];
    }
  }
  async function list({filters, page, language, signal, refresh = false}) {
    signal.throwIfAborted();
    if (!applicantRows || refresh) {
      const minimum = filters.min_experience === '' || filters.min_experience==null ? null : Number(filters.min_experience);
      const result = await rpc('jobs_talent_directory', {
        p_filters: {...filters, min_experience: minimum},
        p_offset: page * talentPageSize, p_limit: talentPageSize
      }, signal);
      if (!missingDirectory(result.error)) {
        const data = unwrap(result);
        if (!Array.isArray(data?.records) || !Number.isSafeInteger(data.total) || data.total < 0 || !data.records.every(hasIdentity))
          throw new Error('jobs.talent_invalid_response');
        applicantRows = undefined;
        return {records: await portraits(data.records, signal), total: data.total, writable: true};
      }
      const rows = await legacyDirectory(signal);
      signal.throwIfAborted();
      applicantRows = rows;
    }
    const records = filterCandidates(applicantRows, filters, language);
    const start = page * talentPageSize;
    return {records: records.slice(start, start + talentPageSize), total: records.length, writable: false};
  }
  async function profile(record, {writable, signal}) {
    if (!writable) {
      const row = unwrap(await run(db.from('jobs_candidates').select(
        'id,full_name,email,phone,current_location,jobs_applications(id,receipt_code,vacancy_title,stage,updated_at)'
      ).eq('id', record.id).order('updated_at', {ascending:false, referencedTable:'jobs_applications'})
        .order('id', {referencedTable:'jobs_applications'}).limit(20, {referencedTable:'jobs_applications'}).maybeSingle(), signal));
      if (!row) throw new Error('jobs.talent_missing');
      return applicant(row);
    }
    const detail = unwrap(await rpc('jobs_talent_profile', {p_id:record.id, p_source:record.source}, signal));
    if (!hasIdentity(detail) || candidateKey(detail) !== candidateKey(record)) throw new Error('jobs.talent_invalid_response');
    return (await portraits([detail], signal))[0];
  }
  async function save(candidate, record, signal) {
    const result = unwrap(await rpc('jobs_talent_save', {
      p_candidate: candidate, p_id:record?.id ?? null, p_source:record?.source ?? null,
      p_expected_version:record?.version ?? null
    }, signal));
    if (!hasIdentity(result) || result.source !== 'talent' || !Number.isSafeInteger(result.version))
      throw new Error('jobs.talent_invalid_response');
    return result;
  }
  async function saveShowcase(record, draft, signal) {
    const result = unwrap(await rpc('jobs_teacher_showcase_save', {
      p_candidate_id:record.id, p_profile:draft, p_expected_version:record.showcase?.version ?? null
    }, signal));
    if (result?.status !== 'draft' || !Number.isSafeInteger(result.version)) throw new Error('jobs.talent_invalid_response');
    return result;
  }
  async function setShowcaseVisibility(record, publish, signal) {
    const result = unwrap(await rpc('jobs_teacher_showcase_visibility', {
      p_candidate_id:record.id, p_publish:publish, p_expected_version:record.showcase.version
    }, signal));
    if (result?.status !== (publish ? 'published' : 'draft') || !Number.isSafeInteger(result.version))
      throw new Error('jobs.talent_invalid_response');
    return result;
  }
  return {list, profile, save, saveShowcase, setShowcaseVisibility};
}
