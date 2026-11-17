// Reusable confirmation for completed CMS operations. Call only after the
// authoritative operation resolves; errors belong to the original form.
let notificationSerial = 0;
const copy = {
  en: {heading: 'Changes completed', close: 'Close', view: 'View published content', timeout: 'Automatically closes after 5 seconds', paused: 'Automatic closing paused while you interact.'},
  vi: {heading: 'Đã hoàn tất thay đổi', close: 'Đóng', view: 'Xem nội dung đã đăng', timeout: 'Tự động đóng sau 5 giây', paused: 'Đã tạm dừng tự động đóng khi bạn tương tác.'}
};
export function createSuccessNotification(host, {language = () => 'en', returnFocus = () => {}, duration = 5000} = {}) {
  const doc = host.ownerDocument, win = doc.defaultView, id = `cms-success-${++notificationSerial}`;
  let dialog = null, timer = null, content = null, destroyed = false, paused = false;
  const currentLanguage = () => typeof language === 'function' ? language() : language;
  const text = value => typeof value === 'object' && value ? value[currentLanguage()] || value.en || '' : String(value || '');
  function clearTimer() { if (timer !== null) win.clearTimeout(timer); timer = null; }
  function dismiss({restoreFocus = true} = {}) {
    clearTimer();
    if (!dialog) return;
    const previous = dialog; dialog = null; content = null;
    if (previous.open) previous.close?.();
    previous.remove();
    if (restoreFocus && !destroyed) returnFocus();
  }
  function setLanguage() {
    if (!dialog || !content) return;
    const words = copy[currentLanguage() === 'vi' ? 'vi' : 'en'];
    dialog.lang = currentLanguage() === 'vi' ? 'vi' : 'en';
    dialog.querySelector('h2').textContent = text(content.heading) || words.heading;
    dialog.querySelector('[data-success-message]').textContent = text(content.message);
    dialog.querySelector('[data-success-title]').textContent = text(content.title);
    dialog.querySelector('[data-success-link] span').textContent = text(content.linkLabel) || words.view;
    dialog.querySelector('[data-success-close]').textContent = words.close;
    dialog.querySelector('[data-success-timer]').textContent = paused ? words.paused : words.timeout;
  }
  function pause() { if (!dialog || paused) return; paused = true; clearTimer(); setLanguage(); }
  function show(value) {
    if (destroyed) return;
    dismiss({restoreFocus: false}); content = value; paused = false;
    dialog = doc.createElement('dialog');
    dialog.className = 'gary-cms cms-success-dialog';
    dialog.dataset.cmsSuccess = '';
    dialog.setAttribute('aria-labelledby', `${id}-heading`);
    dialog.setAttribute('aria-describedby', `${id}-message ${id}-title`);
    dialog.innerHTML = `<div class="cms-success-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="12"/><path d="m10 16 4 4 8-9"/></svg></div><h2 id="${id}-heading"></h2><p id="${id}-message" data-success-message></p><p id="${id}-title" class="cms-success-title" data-success-title></p><div class="cms-success-actions"><a data-success-link target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M11 3h6v6m0-6-9 9M8 4H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4"/></svg><span></span></a><button type="button" data-success-close></button></div><small data-success-timer></small>`;
    const link = dialog.querySelector('[data-success-link]');
    try {
      // Local publication routes work on every host, including file-backed QA.
      if (/^\/[a-z0-9][a-z0-9/_-]*$/i.test(value.href || '')) link.setAttribute('href', value.href);
      else { const url = new URL(value.href, win.location.href); if (!value.href || !['https:', 'http:'].includes(url.protocol) || url.origin !== win.location.origin) throw Error('Unsafe publication URL'); link.href = url.href; }
    }
    catch { link.hidden = true; }
    dialog.querySelector('[data-success-close]').addEventListener('click', () => dismiss());
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); return; }
      pause();
      if (event.key === 'Tab') {
        const controls = [...dialog.querySelectorAll('a[href]:not([hidden]),button')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus({preventScroll: true}); }
        else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus({preventScroll: true}); }
      }
    });
    dialog.addEventListener('pointerenter', pause);
    dialog.addEventListener('pointerdown', pause);
    // A separate top-layer dialog survives CMS list and language renders, and
    // inherits the same semantic tokens as every other CMS surface.
    doc.body.append(dialog); setLanguage();
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    dialog.querySelector('[data-success-close]').focus({preventScroll: true});
    timer = win.setTimeout(() => dismiss(), duration);
  }
  return {show, setLanguage, dismiss, destroy() { destroyed = true; dismiss({restoreFocus: false}); }};
}
