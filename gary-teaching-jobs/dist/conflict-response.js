export function isConflictResponse(error) {
  return ['PT409', '409'].includes(String(error?.code))
    || Number(error?.status) === 409
    || ['jobs.version_conflict', 'jobs.talent_conflict'].includes(error?.message);
}

export function responseError({error, status}) {
  if (status === 409 && error && !isConflictResponse(error)) {
    return Object.assign(new Error(error.message), error, {status});
  }
  return error;
}
