const labels={en:{title:'Staff workspace',collapse:'Collapse navigation',expand:'Expand navigation',resize:'Resize staff navigation. Use left and right arrow keys.',width:'Navigation width'},vi:{title:'Không gian nhân viên',collapse:'Thu gọn điều hướng',expand:'Mở rộng điều hướng',resize:'Đổi độ rộng điều hướng nhân viên. Dùng phím mũi tên trái và phải.',width:'Độ rộng điều hướng'}};
const key='gary-jobs:staff-sidebar:v1';
const instances=new WeakMap();
export function mountJobsStaffSidebar(doc=document){
 const sidebar=doc.getElementById('jobs-staff-sidebar');if(!sidebar)return {refresh(){},destroy(){},getState:()=>null};if(instances.has(sidebar))return instances.get(sidebar);
 const win=doc.defaultView,layout=sidebar.closest('.jobs-staff-layout'),panel=doc.getElementById('signed-panel'),toggle=sidebar.querySelector('[data-jobs-sidebar-toggle]'),handle=sidebar.querySelector('[data-jobs-sidebar-resize]');
 let storage,preferred={width:272,collapsed:false,groups:{}},overlay=false,drag=null,disposed=false,applying=false;
 try{storage=win.localStorage;const saved=JSON.parse(storage.getItem(key)||'null');if(saved?.version===1){if(Number.isFinite(saved.width)&&saved.width>=200&&saved.width<=440)preferred.width=saved.width;if(typeof saved.collapsed==='boolean')preferred.collapsed=saved.collapsed;if(saved.groups&&typeof saved.groups==='object')preferred.groups=Object.fromEntries(Object.entries(saved.groups).filter(([name,value])=>['recruitment','directory','knowledge','media'].includes(name)&&typeof value==='boolean'));}}catch{}
 const strings=()=>labels[doc.documentElement.lang==='vi'?'vi':'en'];
 const constrained=()=>win.innerWidth<1060;
 const bounds=()=>({min:216,max:Math.max(216,Math.min(384,(win.innerWidth||1440)-640-72))});
 const save=()=>{try{storage?.setItem(key,JSON.stringify({version:1,...preferred}));}catch{}};
 function stop(){if(!drag)return;doc.body.style.cursor=drag.cursor;doc.body.style.userSelect=drag.select;try{if(handle.hasPointerCapture?.(drag.pointerId))handle.releasePointerCapture(drag.pointerId);}catch{}drag=null;}
 function refresh(){
  if(disposed)return;applying=true;
  const active=doc.body.dataset.jobsStaff==='true'&&panel.classList.contains('jobs-staff-active'),compact=constrained(),collapsed=compact?!overlay:preferred.collapsed,limit=bounds(),width=Math.max(limit.min,Math.min(preferred.width,limit.max)),copy=strings();
  layout.classList.toggle('jobs-sidebar-collapsed',active&&collapsed);layout.classList.toggle('jobs-sidebar-overlay',active&&compact&&overlay);layout.classList.toggle('jobs-sidebar-constrained',active&&compact);
  layout.style.setProperty('--jobs-sidebar-width',(collapsed||compact?68:width)+'px');sidebar.style.setProperty('--jobs-sidebar-expanded-width',width+'px');
  toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',collapsed?copy.expand:copy.collapse);toggle.title=collapsed?copy.expand:copy.collapse;toggle.querySelector('.jobs-sidebar-toggle-label').textContent=collapsed?copy.expand:copy.collapse;
  sidebar.querySelector('[data-jobs-sidebar-title]').textContent=copy.title;
  handle.hidden=!active||collapsed||compact;handle.setAttribute('aria-label',copy.resize);handle.title=copy.resize;handle.setAttribute('aria-valuemin',String(limit.min));handle.setAttribute('aria-valuemax',String(limit.max));handle.setAttribute('aria-valuenow',String(Math.round(width)));handle.setAttribute('aria-valuetext',copy.width+': '+Math.round(width)+' px');
  for(const group of sidebar.querySelectorAll('[data-jobs-nav-group]')){
   const name=group.dataset.jobsNavGroup,wanted=preferred.groups[name];
   group.open=collapsed&&win.innerWidth>520?true:typeof wanted==='boolean'?wanted:true;
   const current=group.querySelector('[aria-current=page]');if(current&&!group.open&&wanted===undefined)group.open=true;
  }
  applying=false;
 }
 function click(event){
  if(event.target.closest('[data-jobs-sidebar-toggle]')){event.preventDefault();if(constrained())overlay=!overlay;else{preferred.collapsed=!preferred.collapsed;save();}refresh();return;}
  if(constrained()&&event.target.closest('#workspace-nav button')){overlay=false;refresh();}
 }
 function toggleGroup(event){const group=event.target;if(applying||layout.classList.contains('jobs-sidebar-collapsed')&&win.innerWidth>520||!group.matches?.('[data-jobs-nav-group]'))return;preferred.groups[group.dataset.jobsNavGroup]=group.open;save();}
 function down(event){if(event.target!==handle||event.button!==0||handle.hidden)return;event.preventDefault();handle.focus();stop();drag={x:event.clientX,width:parseFloat(sidebar.style.getPropertyValue('--jobs-sidebar-expanded-width'))||preferred.width,pointerId:event.pointerId,cursor:doc.body.style.cursor,select:doc.body.style.userSelect};doc.body.style.cursor='ew-resize';doc.body.style.userSelect='none';try{handle.setPointerCapture?.(event.pointerId);}catch{}}
 function move(event){if(!drag||event.pointerId!==undefined&&event.pointerId!==drag.pointerId)return;const limit=bounds();preferred.width=Math.max(limit.min,Math.min(limit.max,drag.width+event.clientX-drag.x));refresh();}
 function up(event){if(drag&&(event.pointerId===undefined||event.pointerId===drag.pointerId)){save();stop();}}
 function keyboard(event){
  if(event.key==='Escape'&&overlay){event.preventDefault();event.stopPropagation();overlay=false;refresh();toggle.focus();return;}
  if(event.target!==handle||handle.hidden||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();const limit=bounds(),step=event.shiftKey?48:16;preferred.width=event.key==='Home'?limit.min:event.key==='End'?limit.max:Math.max(limit.min,Math.min(limit.max,preferred.width+(event.key==='ArrowLeft'?-step:step)));save();refresh();
 }
 function outside(event){if(overlay&&!sidebar.contains(event.target)){overlay=false;refresh();}}
 function resized(){stop();overlay=false;refresh();}
 sidebar.addEventListener('click',click);sidebar.addEventListener('toggle',toggleGroup,true);sidebar.addEventListener('pointerdown',down);sidebar.addEventListener('keydown',keyboard);doc.addEventListener('pointerdown',outside);doc.addEventListener('jobs:staff-navigation',refresh);win.addEventListener('resize',resized);win.addEventListener('pointermove',move);win.addEventListener('pointerup',up);win.addEventListener('pointercancel',up);win.addEventListener('blur',stop);
 const api={refresh,getState:()=>({...preferred,groups:{...preferred.groups},overlay,constrained:constrained()}),destroy(){disposed=true;stop();sidebar.removeEventListener('click',click);sidebar.removeEventListener('toggle',toggleGroup,true);sidebar.removeEventListener('pointerdown',down);sidebar.removeEventListener('keydown',keyboard);doc.removeEventListener('pointerdown',outside);doc.removeEventListener('jobs:staff-navigation',refresh);win.removeEventListener('resize',resized);win.removeEventListener('pointermove',move);win.removeEventListener('pointerup',up);win.removeEventListener('pointercancel',up);win.removeEventListener('blur',stop);instances.delete(sidebar);}};
 instances.set(sidebar,api);refresh();return api;
}
if(typeof document!=='undefined')mountJobsStaffSidebar(document);
