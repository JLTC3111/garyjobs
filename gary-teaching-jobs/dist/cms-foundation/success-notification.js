import {showActionToast} from '../action-toast.js';

// Publication uses the same toast as other confirmed actions, with an optional public link.
export function createSuccessNotification(host, {language = () => 'en', returnFocus} = {}) {
  const doc = host.ownerDocument;
  let toast, content, href;
  const currentLanguage = () => typeof language === 'function' ? language() : language;
  const text = value => typeof value === 'object' && value ? value[currentLanguage()] || value.en || '' : String(value || '');
  function options() {
    const lang = currentLanguage();
    return {
      language: lang, heading: text(content.heading), detail: text(content.title), href,
      linkLabel: text(content.linkLabel) || (lang === 'vi' ? 'Xem nội dung đã đăng' : 'View published content')
    };
  }
  function show(value) {
    content = value;
    href = '';
    if (/^\/[a-z0-9][a-z0-9/_-]*$/i.test(value.href || '')) href = value.href;
    else if (value.href) {
      try {
        const url = new URL(value.href, doc.defaultView.location.href);
        if (['https:', 'http:'].includes(url.protocol) && url.origin === doc.defaultView.location.origin) href = url.href;
      } catch { /* Omit invalid publication links. */ }
    }
    toast = showActionToast(doc, text(value.message), {
      ...options(), publication: true, returnFocus, key: JSON.stringify([value.title, value.href, value.message])
    });
  }
  function dismiss() { toast?.dismiss(); toast = null; }
  return {show, setLanguage() { if (toast?.node.isConnected) toast.update(options(), text(content.message)); }, dismiss, destroy: dismiss};
}
