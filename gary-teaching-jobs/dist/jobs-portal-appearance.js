/* The portal edits the public site's existing appearance preference. */
export function mountPortalAppearance(doc=document) {
  const win=doc.defaultView,select=doc.querySelector('#portal-appearance');
  if(!win||!select)return {destroy(){}};
  const render=()=>{
    const vi=doc.documentElement.lang==='vi';
    const label=vi?'Giao diện':'Appearance';
    select.setAttribute('aria-label',label);
    doc.querySelector('[data-portal-appearance-label]').textContent=label;
    const labels=vi?['Sáng','Tối','Theo hệ thống']:['Light','Dark','System'];
    [...select.options].forEach((option,index)=>{option.textContent=labels[index];});
    select.value=win.garyJobsTheme?.preference||'system';
  };
  const change=()=>win.setGaryJobsTheme?.(select.value);
  const header=doc.querySelector('.jobs-portal-header');
  const layout=()=>{const height=header?.getBoundingClientRect().height;if(height)doc.documentElement.style.setProperty('--jobs-portal-header-height',`${height}px`);};
  const resize=win.ResizeObserver?new win.ResizeObserver(layout):null;
  if(header)resize?.observe(header);
  win.addEventListener('resize',layout);layout();
  const observer=new win.MutationObserver(render);
  observer.observe(doc.documentElement,{attributes:true,attributeFilter:['lang']});
  select.addEventListener('change',change);doc.addEventListener('gary-jobs:theme',render);render();
  return {destroy(){observer.disconnect();resize?.disconnect();win.removeEventListener('resize',layout);select.removeEventListener('change',change);doc.removeEventListener('gary-jobs:theme',render);}};
}
if(typeof document!=='undefined')mountPortalAppearance();
