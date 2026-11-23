import {mountJobsAccountMenu} from './jobs-account-menu.js';

export function mountJobsPublicAccount(doc, auth, loadCapabilities) {
  const root = doc.getElementById('public-account');
  if (!root) return;
  const win = doc.defaultView;
  let snapshot = {loading: true}, revision = 0, checking = -1, observedUserId = null, queued;
  const menu = mountJobsAccountMenu(root, {
    async signOut() {
      const attempt = revision;
      const {error} = await withinDeadline(auth.signOut({scope: 'local'}));
      if (error) throw error;
      if (attempt === revision) signedOut();
    },
    retry: () => scheduleCheck(),
  });
  const paint = () => menu.update({...snapshot, language: doc.documentElement.lang});
  function show(next) { snapshot = next; paint(); }
  function withinDeadline(promise) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = win.setTimeout(() => reject(new Error('Account check timed out')), 12000);
    });
    return Promise.race([promise, timeout]).finally(() => win.clearTimeout(timer));
  }
  function signedOut() {
    revision++;
    observedUserId = null;
    win.clearTimeout(queued);
    show({});
  }
  async function verify() {
    const attempt = revision;
    if (checking === attempt) return;
    checking = attempt;
    let user;
    try {
      const result = await withinDeadline(auth.getUser());
      if (attempt !== revision) return;
      const error = result.error;
      if (['AuthSessionMissingError', 'AuthInvalidJwtError'].includes(error?.name) || [401, 403].includes(error?.status) ||
          ['session_not_found', 'user_banned', 'user_not_found', 'bad_jwt'].includes(error?.code)) {
        signedOut();
        return;
      }
      if (error) throw error;
      user = result.data?.user;
      if (!user) { signedOut(); return; }
      observedUserId = user.id;
      const caps = await withinDeadline(loadCapabilities());
      if (attempt === revision) show({user, caps});
    } catch {
      if (attempt === revision) show({user, failed: true});
    } finally {
      if (checking === attempt) checking = -1;
    }
  }
  function scheduleCheck() {
    win.clearTimeout(queued);
    // Run after Supabase releases its auth callback lock.
    queued = win.setTimeout(() => void verify(), 0);
  }
  paint();
  doc.addEventListener('jobs:public-render', paint);
  auth.onAuthStateChange((event, session) => {
    const next = session?.user?.id || null;
    if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION' && !next) { signedOut(); return; }
    if (!next || !['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) return;
    if (next !== observedUserId) {
      observedUserId = next;
      revision++;
      show({loading: true});
    }
    scheduleCheck();
  });
  win.addEventListener('focus', () => { if (snapshot.user || snapshot.failed) scheduleCheck(); });
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible' && (snapshot.user || snapshot.failed)) scheduleCheck();
  });
  win.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    revision++;
    show({loading: true});
    scheduleCheck();
  });
}

if (typeof document !== 'undefined') {
  const {db, capabilities} = await import('./jobs-backend.js');
  mountJobsPublicAccount(document, db.auth, capabilities);
}
