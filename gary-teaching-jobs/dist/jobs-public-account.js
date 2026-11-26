import {mountJobsAccountMenu} from './jobs-account-menu.js';

export function mountJobsPublicAccount(doc, auth, loadCapabilities, loadPhoto) {
  const root = doc.getElementById('public-account');
  if (!root) return;
  const win = doc.defaultView;
  let snapshot = {loading: true}, revision = 0, checking = -1, observedUserId = null, queued;
  let photoKey = '', photoUrl = '';
  const menu = mountJobsAccountMenu(root, {
    publicHeader: true,
    async signOut() {
      const attempt = revision;
      const {error} = await withinDeadline(auth.signOut({scope: 'local'}));
      if (error) throw error;
      if (attempt === revision) signedOut();
    },
    retry: () => scheduleCheck(),
  });
  const paint = () => menu.update({...snapshot, language: doc.documentElement.lang});
  function announce() {
    const EventType = win.CustomEvent || win.Event;
    doc.dispatchEvent(new EventType('jobs:public-auth', {
      detail: {loading: !!snapshot.loading, user: snapshot.user || null, failed: !!snapshot.failed},
    }));
  }
  function show(next) { snapshot = next; paint(); announce(); }
  function releasePhoto() {
    if (photoUrl) win.URL.revokeObjectURL(photoUrl);
    photoKey = ''; photoUrl = '';
  }
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
    releasePhoto();
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
      if (attempt !== revision) return;
      const path=caps?.account?.avatar_path;
      const key=typeof path==='string'&&path.startsWith(user.id+'/')&&/^[a-f0-9-]{36}\.webp$/i.test(path.split('/')[1]||'')
        &&path.split('/').length===2 ? path : '';
      if (key!==photoKey) releasePhoto();
      show({user,caps,photo:photoUrl});
      if (key&&key!==photoKey&&loadPhoto&&typeof win.URL.createObjectURL==='function') {
        photoKey=key;
        void withinDeadline(loadPhoto(key)).then(blob=>{
          if (observedUserId!==user.id||photoKey!==key||snapshot.user?.id!==user.id||!blob)return;
          photoUrl=win.URL.createObjectURL(blob);
          snapshot={...snapshot,photo:photoUrl}; paint();
        }).catch(()=>{
          if (observedUserId===user.id&&photoKey===key) releasePhoto();
        });
      }
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
  announce();
  doc.addEventListener('jobs:public-render', paint);
  auth.onAuthStateChange((event, session) => {
    const next = session?.user?.id || null;
    if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION' && !next) { signedOut(); return; }
    if (!next || !['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) return;
    if (next !== observedUserId) {
      releasePhoto();
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
  const {db, capabilities, unwrap} = await import('./jobs-backend.js');
  mountJobsPublicAccount(document, db.auth, capabilities,
    async path => unwrap(await db.storage.from('gary-jobs-profile-photos').download(path)));
}
