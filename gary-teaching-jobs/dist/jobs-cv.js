import {jobsConfig} from './jobs-config.js';

const cvTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

export function validateCv(file) {
  if (!file || !cvTypes.includes(file.type) || file.size < 1 || file.size > jobsConfig.maxCvBytes) {
    throw new Error('jobs.cv_invalid');
  }
}

export async function attachCv(db, applicationId, file) {
  validateCv(file);
  const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const fingerprint = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const {data: reservation, error} = await db.rpc('jobs_reserve_cv_upload', {
    p_application_id: applicationId,
    p_fingerprint: fingerprint,
    p_name: Array.from(file.name).slice(0, 200).join(''),
    p_mime: file.type,
    p_size: file.size,
  });
  if (error) throw error;
  if (reservation.document) return reservation.document;

  let uploadError;
  if (!reservation.stored) {
    try {
      const upload = await db.storage.from(jobsConfig.cvBucket).upload(reservation.object_path, file, {
        contentType: file.type, upsert: false,
      });
      uploadError = upload.error;
    } catch (failure) {
      uploadError = failure;
    }
  }

  // Storage can keep the object even if the upload response fails to arrive.
  const completed = await db.rpc('jobs_complete_cv_upload', {p_upload_id: reservation.id});
  if (completed.error) {
    if (uploadError && completed.error.message === 'jobs.cv_upload_missing') throw uploadError;
    throw completed.error;
  }
  return completed.data;
}
