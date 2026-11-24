import {mountBranchedMenu} from './branched-menu.js';

const labels={en:{brand:'TEACHING JOBS',title:'Staff workspace',collapse:'Collapse navigation',expand:'Expand navigation',resize:'Resize staff navigation. Use left and right arrow keys.',width:'Navigation width'},vi:{brand:'Nền Tảng Tuyển Dụng',title:'Không gian nhân viên',collapse:'Thu gọn điều hướng',expand:'Mở rộng điều hướng',resize:'Đổi độ rộng điều hướng nhân viên. Dùng phím mũi tên trái và phải.',width:'Độ rộng điều hướng'}};
const key='gary-jobs:staff-sidebar:v1';
const instances=new WeakMap();
export function mountJobsStaffSidebar(doc=document){
 const sidebar=doc.getElementById('jobs-staff-sidebar');if(!sidebar)return {refresh(){},destroy(){},getState:()=>null};if(instances.has(sidebar))return instances.get(sidebar);
 const win=doc.defaultView,layout=sidebar.closest('.jobs-staff-layout'),panel=doc.getElementById('signed-panel'),toggle=sidebar.querySelector('[data-jobs-sidebar-toggle]'),nav=sidebar.querySelector('#workspace-nav'),handle=sidebar.querySelector('[data-jobs-sidebar-resize]');
 const branches=mountBranchedMenu(nav),summary=doc.getElementById('account-summary'),footer=doc.createElement('footer');
 footer.className='jobs-sidebar-account';
 const groupIds=['recruitment','directory','knowledge','media','administration'];
 const defaultGroups=()=>Object.fromEntries(groupIds.map(name=>[name,true]));
 let storage,preferred={width:272,collapsed:false,groups:defaultGroups()},overlay=false,closingOverlay=null,drag=null,disposed=false,activeLink;
 try{storage=win.localStorage;const saved=JSON.parse(storage.getItem(key)||'null');if(saved?.version===1||saved?.version===2){if(Number.isFinite(saved.width)&&saved.width>=200&&saved.width<=440)preferred.width=saved.width;if(typeof saved.collapsed==='boolean')preferred.collapsed=saved.collapsed;if(saved.version===2&&saved.groups&&typeof saved.groups==='object')preferred.groups={...defaultGroups(),...Object.fromEntries(Object.entries(saved.groups).filter(([name,value])=>groupIds.includes(name)&&typeof value==='boolean'))};}}catch{}
 const strings=()=>labels[doc.documentElement.lang==='vi'?'vi':'en'];
 const constrained=()=>win.innerWidth<1060;
 const bounds=()=>({min:216,max:Math.max(216,Math.min(384,(win.innerWidth||1440)-640-72))});
 const save=()=>{try{storage?.setItem(key,JSON.stringify({version:2,...preferred}));}catch{}};
 function stop(){if(!drag)return;doc.body.style.cursor=drag.cursor;doc.body.style.userSelect=drag.select;try{if(handle.hasPointerCapture?.(drag.pointerId))handle.releasePointerCapture(drag.pointerId);}catch{}drag=null;layout.removeAttribute('data-gary-resizing');}
 function accountFooter(active){
  if(!summary)return;
  if(active&&summary.parentElement!==footer){footer.append(summary);nav.after(footer);}
  else if(!active&&summary.parentElement===footer){layout.before(summary);footer.remove();}
 }
 function refresh({revealActive=false}={}){
  if(disposed)return;
  const active=doc.body.dataset.jobsStaff==='true'&&panel.classList.contains('jobs-staff-active'),compact=constrained(),collapsed=compact?!overlay:preferred.collapsed,limit=bounds(),width=Math.max(limit.min,Math.min(preferred.width,limit.max)),copy=strings();
  const closing=active&&compact&&!!closingOverlay;
  layout.classList.toggle('jobs-sidebar-collapsed',active&&collapsed&&!closing);layout.classList.toggle('jobs-sidebar-overlay',active&&compact&&(overlay||closing));layout.classList.toggle('jobs-sidebar-constrained',active&&compact);
  layout.toggleAttribute('data-sidebar-closing',closing);
  nav.inert=closing||active&&collapsed&&win.innerWidth<=520;
  if(active&&!nav.inert)nav.tabIndex=0;else nav.removeAttribute('tabindex');
  layout.style.setProperty('--jobs-sidebar-width',(collapsed||compact?68:width)+'px');sidebar.style.setProperty('--jobs-sidebar-expanded-width',width+'px');
  toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',collapsed?copy.expand:copy.collapse);toggle.title=collapsed?copy.expand:copy.collapse;toggle.querySelector('.jobs-sidebar-toggle-label').textContent=collapsed?copy.expand:copy.collapse;
  sidebar.querySelector('.jobs-sidebar-brand').textContent=copy.brand;sidebar.querySelector('[data-jobs-sidebar-title]').textContent=copy.title;
  handle.hidden=!active||collapsed||compact;handle.setAttribute('aria-label',copy.resize);handle.title=copy.resize;handle.setAttribute('aria-valuemin',String(limit.min));handle.setAttribute('aria-valuemax',String(limit.max));handle.setAttribute('aria-valuenow',String(Math.round(width)));handle.setAttribute('aria-valuetext',copy.width+': '+Math.round(width)+' px');
  accountFooter(active);
  branches.refresh({
   rail:active&&collapsed&&!closing&&win.innerWidth>520,revealActive,
   expanded:section=>preferred.groups[section.dataset.jobsNavGroup]!==false,
   reveal:section=>{preferred.groups[section.dataset.jobsNavGroup]=true;}
  });
  const next=nav.querySelector('[aria-current="page"]');
  const moved=activeLink!==next;
  activeLink=next;
  if(overlay&&moved&&next)dismissOverlay();
 }
 function dismissOverlay(){
  if(!overlay)return;
  if(nav.contains(doc.activeElement))toggle.focus({preventScroll:true});
  overlay=false;
  const attempt={};closingOverlay=attempt;refresh();
  const fade=sidebar.getAnimations?.().find(animation=>animation.transitionProperty==='opacity');
  const finish=()=>{if(closingOverlay===attempt){closingOverlay=null;refresh();}};
  if(fade)void fade.finished.then(finish,finish);else finish();
 }
 function click(event){
  if(event.target.closest('[data-jobs-sidebar-toggle]')){
   event.preventDefault();
   if(constrained()&&overlay){dismissOverlay();return;}
   if(constrained()){overlay=true;closingOverlay=null;}else{preferred.collapsed=!preferred.collapsed;save();}
   refresh({revealActive:overlay});return;
  }
  const heading=event.target.closest('.jobs-nav-group-toggle');
  if(heading){
   const section=heading.closest('[data-jobs-nav-group]');
   preferred.groups[section.dataset.jobsNavGroup]=section.dataset.open!=='true';
   save();refresh();return;
  }
  if(constrained()&&event.target.closest('#workspace-nav button[aria-current="page"]'))dismissOverlay();
 }
 function down(event){if(event.target!==handle||event.button!==0||handle.hidden)return;event.preventDefault();handle.focus();stop();drag={x:event.clientX,width:parseFloat(sidebar.style.getPropertyValue('--jobs-sidebar-expanded-width'))||preferred.width,pointerId:event.pointerId,cursor:doc.body.style.cursor,select:doc.body.style.userSelect};layout.setAttribute('data-gary-resizing','');doc.body.style.cursor='ew-resize';doc.body.style.userSelect='none';try{handle.setPointerCapture?.(event.pointerId);}catch{}}
 function move(event){if(!drag||event.pointerId!==undefined&&event.pointerId!==drag.pointerId)return;const limit=bounds();preferred.width=Math.max(limit.min,Math.min(limit.max,drag.width+event.clientX-drag.x));refresh();}
 function up(event){if(drag&&(event.pointerId===undefined||event.pointerId===drag.pointerId)){save();stop();}}
 function keyboard(event){
  if(event.key==='Escape'&&overlay){event.preventDefault();event.stopPropagation();dismissOverlay();toggle.focus();return;}
  if(event.target!==handle||handle.hidden||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();const limit=bounds(),step=event.shiftKey?48:16;preferred.width=event.key==='Home'?limit.min:event.key==='End'?limit.max:Math.max(limit.min,Math.min(limit.max,preferred.width+(event.key==='ArrowLeft'?-step:step)));save();refresh();
 }
 function outside(event){if(overlay&&!sidebar.contains(event.target))dismissOverlay();}
 function resized(){stop();overlay=false;closingOverlay=null;refresh();}
 sidebar.addEventListener('click',click);sidebar.addEventListener('pointerdown',down);sidebar.addEventListener('keydown',keyboard);doc.addEventListener('pointerdown',outside);doc.addEventListener('jobs:staff-navigation',refresh);win.addEventListener('resize',resized);win.addEventListener('pointermove',move);win.addEventListener('pointerup',up);win.addEventListener('pointercancel',up);win.addEventListener('blur',stop);
 const api={refresh,getState:()=>({...preferred,groups:{...preferred.groups},overlay,constrained:constrained()}),destroy(){disposed=true;stop();closingOverlay=null;branches.destroy();accountFooter(false);layout.removeAttribute('data-sidebar-closing');nav.inert=false;nav.removeAttribute('tabindex');sidebar.removeEventListener('click',click);sidebar.removeEventListener('pointerdown',down);sidebar.removeEventListener('keydown',keyboard);doc.removeEventListener('pointerdown',outside);doc.removeEventListener('jobs:staff-navigation',refresh);win.removeEventListener('resize',resized);win.removeEventListener('pointermove',move);win.removeEventListener('pointerup',up);win.removeEventListener('pointercancel',up);win.removeEventListener('blur',stop);instances.delete(sidebar);}};
 instances.set(sidebar,api);refresh();return api;
}
if(typeof document!=='undefined')mountJobsStaffSidebar(document);
