import {mountBranchedMenu} from './branched-menu.js';

const labels={
 en:{brand:'TEACHING JOBS',title:'Staff workspace',collapse:'Collapse navigation',expand:'Expand navigation',show:'Open staff navigation',hide:'Close staff navigation',resize:'Resize staff navigation. Use left and right arrow keys.',width:'Navigation width',navigation:'Staff workspace navigation'},
 vi:{brand:'Nền Tảng Tuyển Dụng',title:'Không gian nhân viên',collapse:'Thu gọn điều hướng',expand:'Mở rộng điều hướng',show:'Mở điều hướng nhân viên',hide:'Đóng điều hướng nhân viên',resize:'Đổi độ rộng điều hướng nhân viên. Dùng phím mũi tên trái và phải.',width:'Độ rộng điều hướng',navigation:'Điều hướng không gian nhân viên'}
};
const key='gary-jobs:staff-sidebar:v1';
const instances=new WeakMap();

export function mountJobsStaffSidebar(doc=document){
 const sidebar=doc.getElementById('jobs-staff-sidebar');
 if(!sidebar)return {refresh(){},destroy(){},getState:()=>null};
 if(instances.has(sidebar))return instances.get(sidebar);
 const win=doc.defaultView;
 const layout=sidebar.closest('.jobs-staff-layout');
 const panel=doc.getElementById('signed-panel');
 const workspace=doc.getElementById('workspace-view');
 const toggle=sidebar.querySelector('[data-jobs-sidebar-toggle]');
 const toggleIcon=toggle.querySelector('.jobs-sidebar-toggle-icon');
 const nav=sidebar.querySelector('#workspace-nav');
 const handle=sidebar.querySelector('[data-jobs-sidebar-resize]');
 const trigger=doc.getElementById('jobs-mobile-nav-trigger');
 const branches=mountBranchedMenu(nav);
 const summary=doc.getElementById('account-summary');
 const footer=doc.createElement('footer');
 footer.className='jobs-sidebar-account';
 const groupIds=['recruitment','directory','knowledge','media','administration'];
 const defaultGroups=()=>Object.fromEntries(groupIds.map(name=>[name,true]));
 let storage,preferred={width:272,collapsed:false,groups:defaultGroups()};
 let drawer=null,drag=null,disposed=false,activeLink=null,tabletExpanded=false;
 try{
  storage=win.localStorage;
  const saved=JSON.parse(storage.getItem(key)||'null');
  if(saved?.version===1||saved?.version===2){
   if(Number.isFinite(saved.width)&&saved.width>=200&&saved.width<=440)preferred.width=saved.width;
   if(typeof saved.collapsed==='boolean')preferred.collapsed=saved.collapsed;
   if(saved.version===2&&saved.groups&&typeof saved.groups==='object'){
    preferred.groups={...defaultGroups(),...Object.fromEntries(Object.entries(saved.groups).filter(([name,value])=>groupIds.includes(name)&&typeof value==='boolean'))};
   }
  }
 }catch{}

 const strings=()=>labels[doc.documentElement.lang==='vi'?'vi':'en'];
 const mobile=()=>win.innerWidth<=900;
 const tablet=()=>!mobile()&&win.innerWidth<1060;
 const bounds=()=>({min:216,max:Math.max(216,Math.min(384,(win.innerWidth||1440)-640-72))});
 const save=()=>{try{storage?.setItem(key,JSON.stringify({version:2,...preferred}));}catch{}};
 const staffActive=()=>doc.body.dataset.jobsStaff==='true'&&!panel.hidden&&panel.classList.contains('jobs-staff-active');

 function stop(){
  if(!drag)return;
  doc.body.style.cursor=drag.cursor;
  doc.body.style.userSelect=drag.select;
  try{if(handle.hasPointerCapture?.(drag.pointerId))handle.releasePointerCapture(drag.pointerId);}catch{}
  drag=null;
  layout.removeAttribute('data-gary-resizing');
 }

 function accountFooter(active){
  if(!summary)return;
  if(active&&summary.parentElement!==footer){footer.append(summary);nav.after(footer);}
  else if(!active&&summary.parentElement===footer){layout.before(summary);footer.remove();}
 }

 function ensureDrawer(){
  if(drawer)return drawer;
  drawer=doc.createElement('dialog');
  drawer.id='jobs-mobile-nav';
  drawer.className='jobs-mobile-nav-drawer';
  drawer.setAttribute('aria-modal','true');
  trigger?.setAttribute('aria-controls',drawer.id);
  layout.append(drawer);
  drawer.addEventListener('close',syncDrawer);
  drawer.addEventListener('cancel',event=>{event.preventDefault();closeDrawer();});
  drawer.addEventListener('keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeDrawer();}
  });
  drawer.addEventListener('click',event=>{
   if(event.target!==drawer)return;
   const rect=drawer.getBoundingClientRect();
   if(event.clientX<rect.left||event.clientX>=rect.right||event.clientY<rect.top||event.clientY>=rect.bottom)closeDrawer();
  });
  return drawer;
 }

 function syncDrawer(){
  const open=staffActive()&&Boolean(drawer?.open);
  if(trigger){
   trigger.setAttribute('aria-expanded',String(open));
   trigger.hidden=!staffActive()||!mobile();
  }
  layout.classList.toggle('jobs-sidebar-mobile-open',open);
  doc.body.classList.toggle('jobs-sidebar-scroll-locked',open);
  nav.inert=staffActive()&&mobile()&&!open;
 }

 function closeDrawer({focusWorkspace=false}={}){
  if(!drawer?.open)return;
  drawer.close();
  syncDrawer();
  if(focusWorkspace){
   // The workspace stays mounted while a collection replaces its headings and results.
   queueMicrotask(()=>{
    if(disposed||!staffActive()||doc.querySelector('dialog[open]'))return;
    workspace.tabIndex=-1;
    workspace.focus();
   });
  }else if(trigger&&!trigger.hidden)trigger.focus({preventScroll:true});
 }

 function openDrawer(){
  if(!staffActive()||!mobile()||drawer?.open)return;
  ensureDrawer();
  if(sidebar.parentElement!==drawer)drawer.append(sidebar);
  drawer.showModal();
  refresh({revealActive:true});
  toggle.focus({preventScroll:true});
 }

 function placeSidebar(){
  if(!staffActive()){
   if(drawer?.open)drawer.close();
   if(sidebar.parentElement!==layout)layout.prepend(sidebar);
   syncDrawer();
   return;
  }
  if(mobile()){
   ensureDrawer();
   if(sidebar.parentElement!==drawer)drawer.append(sidebar);
  }else{
   if(drawer?.open)drawer.close();
   if(sidebar.parentElement!==layout)layout.prepend(sidebar);
  }
  syncDrawer();
 }

 function refresh({revealActive=false}={}){
  if(disposed)return;
  const active=staffActive();
  const phone=mobile();
  const mid=tablet();
  // Intermediate widths use an icon rail by default; expand restores the full BranchedMenu in-grid.
  if(!mid)tabletExpanded=false;
  const showCollapsed=active&&!phone&&(mid?!tabletExpanded:preferred.collapsed);
  const copy=strings();
  const limit=bounds();
  const width=Math.max(limit.min,Math.min(preferred.width,limit.max));

  placeSidebar();
  layout.classList.toggle('jobs-sidebar-collapsed',showCollapsed);
  layout.classList.toggle('jobs-sidebar-constrained',active&&(phone||mid));
  layout.classList.remove('jobs-sidebar-overlay');
  layout.removeAttribute('data-sidebar-closing');
  layout.style.setProperty('--jobs-sidebar-width',(phone?'0px':showCollapsed?'68px':width+'px'));
  sidebar.style.setProperty('--jobs-sidebar-expanded-width',width+'px');

  if(trigger){
   trigger.setAttribute('aria-label',copy.show);
   trigger.title=copy.show;
  }

  const action=phone?copy.hide:showCollapsed?copy.expand:copy.collapse;
  toggle.setAttribute('aria-label',action);
  toggle.title=action;
  toggleIcon.textContent=phone?'×':'☰';
  toggle.querySelector('.jobs-sidebar-toggle-label').textContent=action;
  if(phone){
   toggle.removeAttribute('aria-expanded');
   toggle.removeAttribute('aria-controls');
  }else{
   toggle.setAttribute('aria-expanded',String(!showCollapsed));
   toggle.setAttribute('aria-controls','workspace-nav');
  }

  sidebar.querySelector('.jobs-sidebar-brand').textContent=copy.brand;
  sidebar.querySelector('[data-jobs-sidebar-title]').textContent=copy.title;
  if(drawer)drawer.setAttribute('aria-label',copy.navigation);
  nav.setAttribute('aria-label',copy.navigation);
  if(active){
   workspace.setAttribute('role','region');
   workspace.setAttribute('aria-label',copy.title);
  }else removeWorkspaceFocus();

  handle.hidden=!active||phone||showCollapsed;
  handle.setAttribute('aria-label',copy.resize);
  handle.title=copy.resize;
  handle.setAttribute('aria-valuemin',String(limit.min));
  handle.setAttribute('aria-valuemax',String(limit.max));
  handle.setAttribute('aria-valuenow',String(Math.round(width)));
  handle.setAttribute('aria-valuetext',copy.width+': '+Math.round(width)+' px');

  accountFooter(active);
  if(active&&!nav.inert)nav.tabIndex=0;else nav.removeAttribute('tabindex');

  branches.refresh({
   rail:active&&showCollapsed,
   revealActive,
   expanded:section=>preferred.groups[section.dataset.jobsNavGroup]!==false,
   reveal:section=>{preferred.groups[section.dataset.jobsNavGroup]=true;}
  });

  const next=nav.querySelector('[aria-current="page"]');
  const moved=activeLink!==next;
  activeLink=next;
  if(phone&&moved&&next)closeDrawer({focusWorkspace:true});
 }

 function click(event){
  if(event.target.closest('[data-jobs-sidebar-toggle]')){
   event.preventDefault();
   stop();
   if(mobile()){closeDrawer();return;}
   if(tablet()){
    tabletExpanded=!tabletExpanded;
    preferred.collapsed=!tabletExpanded;
   }else preferred.collapsed=!preferred.collapsed;
   save();
   refresh();
   return;
  }
  const heading=event.target.closest('.jobs-nav-group-toggle');
  if(heading){
   const section=heading.closest('[data-jobs-nav-group]');
   preferred.groups[section.dataset.jobsNavGroup]=section.dataset.open!=='true';
   save();
   refresh();
   return;
  }
  if(mobile()&&drawer?.open&&event.target.closest('#workspace-nav button[aria-current="page"]')){
   queueMicrotask(()=>{if(!disposed)closeDrawer({focusWorkspace:true});});
  }
 }

 function down(event){
  if(event.target!==handle||event.button!==0||handle.hidden)return;
  event.preventDefault();
  handle.focus();
  stop();
  drag={
   x:event.clientX,
   width:parseFloat(sidebar.style.getPropertyValue('--jobs-sidebar-expanded-width'))||preferred.width,
   pointerId:event.pointerId,
   cursor:doc.body.style.cursor,
   select:doc.body.style.userSelect
  };
  layout.setAttribute('data-gary-resizing','');
  doc.body.style.cursor='ew-resize';
  doc.body.style.userSelect='none';
  try{handle.setPointerCapture?.(event.pointerId);}catch{}
 }
 function move(event){
  if(!drag||event.pointerId!==undefined&&event.pointerId!==drag.pointerId)return;
  const limit=bounds();
  preferred.width=Math.max(limit.min,Math.min(limit.max,drag.width+event.clientX-drag.x));
  refresh();
 }
 function up(event){
  if(drag&&(event.pointerId===undefined||event.pointerId===drag.pointerId)){save();stop();}
 }
 function keyboard(event){
  if(event.target!==handle||handle.hidden||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  event.stopPropagation();
  const limit=bounds(),step=event.shiftKey?48:16;
  preferred.width=event.key==='Home'?limit.min:event.key==='End'?limit.max:Math.max(limit.min,Math.min(limit.max,preferred.width+(event.key==='ArrowLeft'?-step:step)));
  save();
  refresh();
 }
 function resized(){
  stop();
  const focused=doc.activeElement;
  const focusWasInNavigation=sidebar.contains(focused)||focused===trigger;
  refresh();
  if(!staffActive()||!focusWasInNavigation)return;
  if(mobile()&&!drawer?.open&&trigger&&!trigger.hidden)trigger.focus({preventScroll:true});
  if(!mobile()&&(!sidebar.contains(doc.activeElement)||
    (focused===handle&&handle.hidden)||
    (focused.matches('.jobs-nav-group-toggle')&&layout.classList.contains('jobs-sidebar-collapsed'))))toggle.focus({preventScroll:true});
 }

 function removeWorkspaceFocus(){
  workspace.removeAttribute('role');
  workspace.removeAttribute('aria-label');
  workspace.removeAttribute('tabindex');
 }

 if(trigger)trigger.addEventListener('click',openDrawer);
 sidebar.addEventListener('click',click);
 sidebar.addEventListener('pointerdown',down);
 sidebar.addEventListener('keydown',keyboard);
 doc.addEventListener('jobs:staff-navigation',refresh);
 win.addEventListener('resize',resized);
 win.addEventListener('pointermove',move);
 win.addEventListener('pointerup',up);
 win.addEventListener('pointercancel',up);
 win.addEventListener('blur',stop);

 const api={
  refresh,
  getState:()=>({
   ...preferred,
   groups:{...preferred.groups},
   mobile:mobile(),
   mobileExpanded:Boolean(drawer?.open),
   overlay:Boolean(drawer?.open),
   constrained:mobile()||tablet(),
   width:Math.max(bounds().min,Math.min(preferred.width,bounds().max))
  }),
  destroy(){
   disposed=true;
   stop();
   branches.destroy();
   accountFooter(false);
   if(trigger){
    trigger.removeEventListener('click',openDrawer);
    trigger.hidden=true;
    trigger.removeAttribute('aria-controls');
   }
   if(drawer){
    if(sidebar.parentElement===drawer)layout.prepend(sidebar);
    drawer.remove();
    drawer=null;
   }
   layout.classList.remove('jobs-sidebar-collapsed','jobs-sidebar-overlay','jobs-sidebar-constrained','jobs-sidebar-mobile-open');
   layout.removeAttribute('data-sidebar-closing');
   layout.style.removeProperty('--jobs-sidebar-width');
   doc.body.classList.remove('jobs-sidebar-scroll-locked');
   removeWorkspaceFocus();
   nav.inert=false;
   nav.removeAttribute('tabindex');
   sidebar.removeEventListener('click',click);
   sidebar.removeEventListener('pointerdown',down);
   sidebar.removeEventListener('keydown',keyboard);
   doc.removeEventListener('jobs:staff-navigation',refresh);
   win.removeEventListener('resize',resized);
   win.removeEventListener('pointermove',move);
   win.removeEventListener('pointerup',up);
   win.removeEventListener('pointercancel',up);
   win.removeEventListener('blur',stop);
   instances.delete(sidebar);
  }
 };
 instances.set(sidebar,api);
 refresh();
 return api;
}
if(typeof document!=='undefined')mountJobsStaffSidebar(document);
