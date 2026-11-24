import {escapeText} from './jobs-public-content.js';

const roles = {
  admin: ['Admin', 'Quản trị viên'],
  editor: ['Editor', 'Biên tập viên'],
  publisher: ['Publisher', 'Người xuất bản'],
  recruiter: ['Recruiter', 'Chuyên viên tuyển dụng'],
};
const paths = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  staff: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  candidate: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 13h18"/>',
  signOut: '<path d="M10 17l5-5-5-5M15 12H3m9-8h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7"/>',
};
const icon = name => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const text = value => typeof value === 'string' ? value.trim() : '';

export function mountJobsAccountMenu(root, {signOut, retry, canNavigate, showGuest = true}) {
  const doc = root.ownerDocument;
  const signoutDescriptionId = `${root.id}-signout-description`;
  root.innerHTML = '<summary></summary><div class="jobs-login-options"></div>';
  const [trigger, panel] = root.children;
  let state = {}, signingOut = false, signOutFailed = false, triggerMarkup = '', panelMarkup = '';

  function render() {
    const {language, user, caps, loading, failed} = state;
    const t = (en, vi) => language === 'vi' ? vi : en;
    const label = loading ? t('Checking session…', 'Đang kiểm tra phiên đăng nhập…')
      : user || failed ? t('My account', 'Tài khoản của tôi') : t('Sign in', 'Đăng nhập');
    const email = text(user?.email);
    const name = text(user?.user_metadata?.full_name) || text(user?.user_metadata?.name) || email;
    const initials = name.split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] || '').join('').toUpperCase();
    const avatar = `<span class="jobs-account-avatar" aria-hidden="true">${initials ? escapeText(initials) : icon('user')}</span>`;
    const staff = caps?.read === true || caps?.recruit === true;
    const role = staff && Object.hasOwn(roles, caps.role) ? t(...roles[caps.role]) : '';
    const destination = (access, label) => `<a href="portal.html?access=${access}">${icon(access)}<span class="jobs-account-item-label">${label}</span></a>`;
    const candidate = t('Candidate', 'Ứng viên');
    const summary = `${avatar}<span class="jobs-account-trigger-label">${label}</span>`;
    root.hidden = !showGuest && (!user || loading);
    root.setAttribute('aria-busy', String(!!loading));
    trigger.setAttribute('aria-label', label);
    if (loading) trigger.setAttribute('aria-disabled', 'true');
    else trigger.removeAttribute('aria-disabled');
    if (triggerMarkup !== summary) {
      trigger.innerHTML = summary;
      triggerMarkup = summary;
    }

    let content = '';
    if (!loading && user) {
      content = `<div class="jobs-account-identity">${avatar}<div><strong>${escapeText(name || label)}</strong>${email && email !== name ? `<small>${escapeText(email)}</small>` : ''}
        <div class="jobs-account-badges">${role ? `<span>${t('Staff', 'Nhân viên')} · ${role}</span>` : ''}<span>${candidate}</span></div></div></div>
        ${staff ? destination('staff', t('Staff Dashboard', 'Bảng điều khiển nhân viên')) : ''}
        ${destination('candidate', t('Candidate Dashboard', 'Bảng điều khiển ứng viên'))}
        <footer><button id="sign-out" type="button" aria-describedby="${signoutDescriptionId}" ${signingOut ? 'disabled' : ''}>${icon('signOut')}<span class="jobs-account-item-label">${signingOut ? t('Signing out…', 'Đang đăng xuất…') : t('Sign out', 'Đăng xuất')}</span></button>
        <p class="jobs-account-signout-description" id="${signoutDescriptionId}">${t('End your session on this website.', 'Kết thúc phiên đăng nhập trên trang web này.')}</p>
        ${signOutFailed ? `<p role="alert">${t('Sign-out failed. Try again.', 'Đăng xuất chưa thành công. Vui lòng thử lại.')}</p>` : ''}</footer>`;
    } else if (!loading && !failed && showGuest) {
      content = destination('candidate', t('Candidate login', 'Đăng nhập ứng viên')) + destination('staff', t('Staff login', 'Đăng nhập nhân viên'));
    }
    if (!loading && failed && retry) {
      content += `<p role="status">${t('Account access could not be checked.', 'Chưa thể kiểm tra quyền truy cập tài khoản.')}</p><button type="button" data-jobs-account-retry><span class="jobs-account-item-label">${t('Try again', 'Thử lại')}</span></button>`;
    }
    // Rechecks often return identical access. Keep the currently focused row.
    if (panelMarkup !== content) {
      const hadFocus = panel.contains(doc.activeElement);
      panel.innerHTML = content;
      panelMarkup = content;
      if (hadFocus && !root.hidden && !loading) trigger.focus({preventScroll: true});
    }
    if (!content) root.open = false;
  }

  function closeOutside(event) {
    if (root.open && !root.contains(event.target)) root.open = false;
  }
  doc.addEventListener('pointerdown', closeOutside);
  doc.addEventListener('focusin', closeOutside);
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !root.open) return;
    event.preventDefault();
    event.stopPropagation();
    root.open = false;
    trigger.focus({preventScroll: true});
  });
  root.addEventListener('click', async event => {
    if (event.target.closest('summary') && state.loading) {
      event.preventDefault();
      return;
    }
    if (event.target.closest('[data-jobs-account-retry]')) retry?.();
    const link = event.target.closest('a');
    if (link && canNavigate && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !canNavigate()) event.preventDefault();
    if (!event.target.closest('#sign-out') || signingOut || !state.user) return;
    signingOut = true;
    signOutFailed = false;
    render();
    try { await signOut(); }
    catch { signOutFailed = true; }
    finally { signingOut = false; render(); }
  });

  return {
    update(next) {
      if (next.user?.id !== state.user?.id) {
        root.open = false;
        signOutFailed = false;
      }
      state = next;
      render();
    },
  };
}
