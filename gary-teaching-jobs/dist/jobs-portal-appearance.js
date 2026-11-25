/* The portal edits the public site's existing appearance preference. */
export function mountPortalAppearance(doc=document) {
  const win=doc.defaultView,select=doc.querySelector('#portal-appearance');
  if(!win||!select)return {destroy(){}};
  const trigger=doc.querySelector('[data-portal-preferences]');
  const panel=doc.querySelector('#portal-preferences-panel');
  const closeButton=doc.querySelector('[data-portal-preferences-close]');
  const portalSection=panel?.querySelector('.jobs-preferences-portal');
  const portalAccess=doc.getElementById('portal-access');
  const portalHome=portalAccess?.parentElement,portalNext=portalAccess?.nextSibling;
  const copy=()=>{
    const vi=doc.documentElement.lang==='vi';
    return {
      preferences:vi?'Tùy chọn website':'Site preferences',
      close:vi?'Đóng tùy chọn':'Close preferences',
      appearance:vi?'Giao diện':'Appearance',
      portal:vi?'Cổng thông tin':'Portal',
      help:vi?'Hệ thống theo cài đặt thiết bị của bạn.':'System follows your device settings.',
      labels:vi?['Sáng','Tối','Hệ thống']:['Light','Dark','System'],
    };
  };
  let open=false;
  const setOpen=(next,restore=false)=>{
    if(!panel||!trigger)return;
    open=next;
    panel.hidden=!open;
    panel.inert=!open;
    trigger.setAttribute('aria-expanded',String(open));
    if(open){
      doc.querySelectorAll('.jobs-portal-header details[open]').forEach(menu=>{menu.open=false;});
      (panel.querySelector('[role=radiogroup], #portal-appearance')||closeButton)?.focus?.({preventScroll:true});
    }else if(restore)trigger.focus({preventScroll:true});
  };
  const render=()=>{
    const t=copy();
    select.setAttribute('aria-label',t.appearance);
    doc.querySelector('[data-portal-appearance-label]').textContent=t.appearance;
    doc.querySelector('[data-portal-appearance-help]').textContent=t.help;
    const title=doc.querySelector('#portal-preferences-title');
    if(title)title.textContent=t.preferences;
    const portalTitle=doc.getElementById('jobs-preferences-portal-title');
    if(portalTitle)portalTitle.textContent=t.portal;
    if(trigger)trigger.setAttribute('aria-label',t.preferences);
    if(closeButton)closeButton.setAttribute('aria-label',t.close);
    [...select.options].forEach((option,index)=>{option.textContent=t.labels[index];});
    select.value=win.garyJobsTheme?.preference||'system';
  };
  const change=()=>win.setGaryJobsTheme?.(select.value);
  const header=doc.querySelector('.jobs-portal-header');
  function placePortal(inPreferences){
    if(!portalSection||!portalHome)return;
    const target=inPreferences?portalSection:portalHome;
    if(portalAccess.parentElement===target)return;
    const focused=portalAccess.contains(doc.activeElement)?doc.activeElement:null;
    target.insertBefore(portalAccess,inPreferences?null:portalNext);
    portalSection.hidden=!inPreferences;
    if(focused)(inPreferences&&!open?trigger:focused)?.focus({preventScroll:true});
  }
  const layout=()=>{
    placePortal(win.innerWidth<=760);
    const height=header?.getBoundingClientRect().height;
    if(height)doc.documentElement.style.setProperty('--jobs-portal-header-height',`${height}px`);
  };
  const resize=win.ResizeObserver?new win.ResizeObserver(layout):null;
  if(header)resize?.observe(header);
  win.addEventListener('resize',layout);layout();
  const onPointer=(event)=>{if(open&&!event.target.closest('.jobs-portal-preferences'))setOpen(false);};
  const onFocus=(event)=>{if(open&&!event.target.closest?.('.jobs-portal-preferences'))setOpen(false);};
  const onKey=(event)=>{
    if(!open)return;
    if(event.key==='Escape'){event.preventDefault();setOpen(false,true);}
  };
  const onTrigger=()=>setOpen(!open,true);
  const onClose=()=>setOpen(false,true);
  const onPortalChange=()=>{if(open&&panel.contains(portalAccess))setOpen(false,true);};
  const observer=new win.MutationObserver(render);
  observer.observe(doc.documentElement,{attributes:true,attributeFilter:['lang']});
  select.addEventListener('change',change);
  doc.addEventListener('gary-jobs:theme',render);
  doc.addEventListener('jobs:portal-access',onPortalChange);
  trigger?.addEventListener('click',onTrigger);
  closeButton?.addEventListener('click',onClose);
  doc.addEventListener('pointerdown',onPointer);
  doc.addEventListener('focusin',onFocus);
  doc.addEventListener('keydown',onKey);
  if(panel){panel.hidden=true;panel.inert=true;}
  render();
  return {destroy(){
    observer.disconnect();resize?.disconnect();
    win.removeEventListener('resize',layout);
    select.removeEventListener('change',change);
    doc.removeEventListener('gary-jobs:theme',render);
    doc.removeEventListener('jobs:portal-access',onPortalChange);
    trigger?.removeEventListener('click',onTrigger);
    closeButton?.removeEventListener('click',onClose);
    doc.removeEventListener('pointerdown',onPointer);
    doc.removeEventListener('focusin',onFocus);
    doc.removeEventListener('keydown',onKey);
    placePortal(false);
  }};
}
if(typeof document!=='undefined')mountPortalAppearance();
