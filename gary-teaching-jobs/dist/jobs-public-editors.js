import {attachEditorWorkspace} from './editor-workspace/index.js';

// The public detail dialog is reused for several read-only views. Only its
// fallback application composer receives editing workspace controls.
export function mountPublicApplicationEditor(doc = document) {
 const dialog = doc.getElementById('detail-dialog'),content = doc.getElementById('dialog-content');
 if (!dialog || !content) return {destroy(){}};
 const shell = dialog.querySelector('.dialog-shell'),close = shell.querySelector('.dialog-close');
 let form = null,controller = null,header = null,cancel = null;
 const language = () => doc.documentElement.lang === 'vi' ? 'vi' : 'en';
 function release() {
  controller?.destroy();controller = null;
  if (header) {
   // On unmount, retain the active composer's title as well as its form fields.
   if (form && content.contains(form)) content.prepend(...header.querySelector('.gw-editor-title').childNodes);
   shell.prepend(close);header.remove();header = null;
  }
  form = null;
  dialog.classList.remove('jobs-application-editor');content.classList.remove('gw-public-content');
 }
 function refresh() {
  const next = content.querySelector('#application-form');
  if (next === form) { if(cancel){const label=language()==='vi'?'Hủy':'Cancel';if(cancel.textContent!==label)cancel.textContent=label;}controller?.refresh();return; }
  release();if (!next) return;
  form = next;header = doc.createElement('header');header.className = 'gw-editor-header';
  const title = doc.createElement('div');title.className = 'gw-editor-title';
  for (const node of [...content.children]) if (node.matches('.eyebrow,h2')) title.append(node);
  const controls = doc.createElement('div');controls.className = 'gw-editor-controls';controls.append(close);header.append(title,controls);shell.prepend(header);
  const body = doc.createElement('div');body.className = 'gw-editor-body';
  const actions = doc.createElement('footer');actions.className = 'gw-editor-actions';
  for (const node of [...content.childNodes]) if (node !== form) body.append(node);
  for (const node of [...form.childNodes]) {
   if (node.nodeType === 1 && node.matches('.form-submit,.email-fallback,.dialog-small')) actions.append(node);else body.append(node);
  }
  cancel=doc.createElement('button');cancel.type='button';cancel.className='button button-outline';cancel.dataset.buttonVariant='cancel';cancel.textContent=language()==='vi'?'Hủy':'Cancel';cancel.addEventListener('click',()=>close.click());actions.append(cancel);
  form.classList.add('gw-editor-form');form.append(body,actions);content.classList.add('gw-public-content');dialog.classList.add('jobs-application-editor');
  controller = attachEditorWorkspace(dialog,{key:'jobs.application-email',language,header,body,actions});
 }
 const observer = new doc.defaultView.MutationObserver(refresh);observer.observe(content,{childList:true,subtree:true});
 const localeObserver = new doc.defaultView.MutationObserver(refresh);localeObserver.observe(doc.documentElement,{attributes:true,attributeFilter:['lang']});
 refresh();
 return {destroy(){observer.disconnect();localeObserver.disconnect();release();}};
}
if (typeof document !== 'undefined') mountPublicApplicationEditor(document);
