import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {attachEditorWorkspace} from '../dist/editor-workspace/index.js';
import {mountJobsStaffSidebar} from '../dist/jobs-staff-sidebar.js';
import {staffPortal,settle} from './helpers/jobs-staff-portal.mjs';
const navigation=(h,kind)=>h.doc.querySelector(`[data-collection="${kind}"]`);
const resizeKey=(h,key,shiftKey=false)=>h.doc.querySelector('[data-jobs-sidebar-resize]').dispatchEvent(new h.w.KeyboardEvent('keydown',{key,shiftKey,bubbles:true,cancelable:true}));

test('Jobs staff sidebar exposes every implemented CMS destination and permitted recruitment without duplicate collection controls',async()=>{
 const h=await staffPortal();try{
  assert.equal(h.doc.querySelectorAll('#workspace-nav [data-collection]').length,7);assert.equal(h.doc.querySelectorAll('[data-jobs-nav-group]').length,4);assert.equal(h.doc.querySelector('.cms-collections'),null);assert.ok(h.doc.querySelector('[data-view=applications]'));
  assert.equal(navigation(h,'vacancy').getAttribute('aria-current'),'page');
  await h.click('[data-collection=category]');assert.equal(h.calls.lists.at(-1).kind,'category');assert.equal(navigation(h,'category').getAttribute('aria-current'),'page');
  await h.click('[data-collection=media]');assert.ok(h.calls.mediaLists>0);assert.equal(navigation(h,'media').getAttribute('aria-current'),'page');
  await h.click('[data-view=applications]');assert.ok(h.calls.applications.length);assert.equal(h.doc.querySelector('[data-view=applications]').getAttribute('aria-current'),'page');
  await h.click('[data-collection=employer]');assert.equal(h.calls.lists.at(-1).kind,'employer');assert.equal(navigation(h,'employer').getAttribute('aria-current'),'page');
  assert.equal(h.doc.querySelector('.jobs-sidebar-brand').textContent,'TEACHING JOBS');assert.equal(h.doc.querySelector('.cms-header .cms-eyebrow').textContent,'Vietnam English Teaching Jobs');
  await h.click('#portal-language');assert.equal(navigation(h,'vacancy').getAttribute('aria-label'),'Tin tuyển dụng');assert.equal(h.doc.querySelector('[data-jobs-sidebar-toggle]').getAttribute('aria-label'),'Thu gọn điều hướng');assert.equal(h.doc.querySelector('.jobs-sidebar-brand').textContent,'Nền Tảng Tuyển Dụng');assert.equal(h.doc.querySelector('.cms-header .cms-eyebrow').textContent,'Tuyển Dụng Dạy Tiếng Anh');
 }finally{await h.close();}
});

test('sidebar visibility remains capability-dependent and candidate navigation is unchanged',async()=>{
 for(const [caps,expected]of [[{read:true,edit:false,publish:false,role:'reader'},6],[{recruit:true,role:'recruiter'},0],[{},0]]){
  const h=await staffPortal({caps});try{assert.equal(h.doc.querySelectorAll('#workspace-nav [data-collection]').length,expected);assert.equal(!!h.doc.querySelector('[data-view=applications]'),!!caps.recruit);if(!caps.read)assert.equal(h.cms,null);if(caps.read)assert.equal(h.doc.querySelector('[data-action=new]'),null);}finally{await h.close();}
 }
 const h=await staffPortal({access:'candidate',view:'mine'});try{assert.equal(h.doc.body.dataset.jobsStaff,'false');assert.equal(h.doc.querySelectorAll('[data-jobs-nav-group]').length,0);assert.equal(h.doc.querySelector('[data-view=mine]').textContent,'My applications');assert.equal(h.doc.querySelectorAll('#workspace-nav button').length,1);}finally{await h.close();}
});

test('Jobs renders unique Lucide symbols for headings and destinations across sidebar modes',async()=>{
 const sprite=new JSDOM(await readFile(new URL('../dist/assets/staff-nav-icons.svg',import.meta.url),'utf8'),{contentType:'image/svg+xml'});
 const h=await staffPortal({caps:{read:true,edit:true,recruit:true,media:true,view_staff:true,manage_staff:true,role:'admin'}});
 try{
  const nav=h.doc.querySelector('#workspace-nav');
  const controls=[...nav.querySelectorAll('.branched-menu__head, [data-collection], [data-view]')];
  assert.equal(controls.length,15);
  const icons=controls.map(button=>{
   const matches=button.querySelectorAll(':scope > svg.branched-menu__icon');
   assert.equal(matches.length,1);
   const icon=matches[0];
   assert.equal(icon,button.firstElementChild);
   assert.equal(icon.getAttribute('aria-hidden'),'true');
   assert.equal(icon.getAttribute('focusable'),'false');
   const id=icon.getAttribute('data-lucide');
   assert.equal(icon.querySelector('use').getAttribute('href'),'./assets/staff-nav-icons.svg#'+id);
   assert.ok(sprite.window.document.getElementById(id)?.children.length);
   return id;
  });
  assert.equal(new Set(icons).size,controls.length);
  const grid=navigation(h,'category').firstElementChild;
  assert.equal(grid.getAttribute('data-lucide'),'layout-grid');
  assert.ok(nav.querySelector('[data-view=talent] [data-lucide=user-search]'));
  assert.ok(nav.querySelector('[data-view=staff] [data-lucide=key-round]'));
  await h.click('#portal-language');
  await h.click('[data-jobs-sidebar-toggle]');
  assert.equal(nav.hasAttribute('data-branched-rail'),true);
  assert.equal(navigation(h,'category').firstElementChild,grid);
 }finally{await h.close();sprite.window.close();}
});

test('Jobs Back and Forward restore collection routes without rebuilding the branch controls', {timeout:5000}, async()=>{
 const h=await staffPortal({collection:'category'});try{
  const {w,doc}=h,nav=doc.querySelector('#workspace-nav');
  const category=navigation(h,'category'),directory=category.closest('[data-jobs-nav-group]');
  const directoryHead=directory.querySelector('.jobs-nav-group-toggle');
  const marker=nav.querySelector('.branched-menu__marker'),reach=directory.querySelectorAll('.branched-menu__reach')[1];
  assert.deepEqual(h.calls.lists.map(call=>call.kind),['category']);
  assert.equal(category.getAttribute('aria-current'),'page');
  assert.equal(reach.getAttribute('stroke-dashoffset'),'0');
  directoryHead.click();
  await h.click('[data-collection=guide]');
  assert.equal(new URL(w.location.href).searchParams.get('collection'),'guide');
  assert.equal(reach.getAttribute('stroke-dashoffset'),'1');
  await h.click('[data-view=applications]');
  assert.equal(new URL(w.location.href).searchParams.has('collection'),false);
  async function history(direction){
   const changed=new Promise(resolve=>w.addEventListener('popstate',resolve,{once:true}));
   w.history[direction]();await changed;await settle();
  }
  await history('back');assert.equal(navigation(h,'guide').getAttribute('aria-current'),'page');
  await history('back');
  assert.equal(h.cms.navigationState().kind,'category');
  assert.equal(directoryHead.getAttribute('aria-expanded'),'true');
  assert.equal(navigation(h,'category'),category);
  assert.equal(directory.querySelectorAll('.branched-menu__reach')[1],reach);
  assert.equal(reach.getAttribute('stroke-dashoffset'),'0');
  assert.equal(nav.querySelector('.branched-menu__marker'),marker);
  await history('forward');
  assert.equal(navigation(h,'guide').getAttribute('aria-current'),'page');
  assert.equal(doc.querySelector('.jobs-sidebar-account #account-summary').closest('nav'),null);
 }finally{await h.close();}
});

test('Jobs removes revoked links and their traces and keeps the permitted navigation node',async()=>{
 const h=await staffPortal({caps:{read:true,edit:true,recruit:true,media:true,view_staff:true,manage_staff:true,role:'admin'}});try{
  const nav=h.doc.querySelector('#workspace-nav'),applications=nav.querySelector('[data-view=applications]');
  assert.ok(nav.querySelector('[data-view=staff]'));
  await h.changeCapabilities({recruit:true,role:'recruiter'});
  assert.equal(nav.querySelector('[data-view=staff]'),null);
  assert.equal(nav.querySelector('[data-collection]'),null);
  assert.equal(nav.querySelector('[data-view=applications]'),applications);
  assert.equal(applications.getAttribute('aria-current'),'page');
  assert.equal(new URL(h.w.location.href).searchParams.get('view'),'applications');
  assert.equal(nav.querySelectorAll('.branched-menu__reach').length,2);
  assert.equal(nav.querySelectorAll('.branched-menu__reach[stroke-dashoffset="0"]').length,1);
  await h.changeCapabilities({});
  assert.equal(nav.querySelector('[data-jobs-nav-group], .branched-menu__marker'),null);
 }finally{await h.close();}
});

test('navigation resizing and collapse preserve an unsaved invalid vacancy and editor size independently',async()=>{
 const h=await staffPortal();try{
  await h.click('[data-action=new]');h.input('title_en','Unsaved teaching position');await h.click('[data-action=publish]');const form=h.doc.querySelector('[data-cms-editor]'),title=form.querySelector('[name=title_en]'),error=form.querySelector('[data-error-for=body_en]');assert.ok(error.textContent);const dialog=h.doc.querySelector('.cms-dialog'),editor=attachEditorWorkspace(dialog);dialog.querySelector('[data-gw-toggle]').click();const editorState=editor.getState();
  const handle=h.doc.querySelector('[data-jobs-sidebar-resize]'),pointer=(target,type,x)=>{const event=new h.w.MouseEvent(type,{clientX:x,button:0,bubbles:true,cancelable:true});Object.defineProperty(event,'pointerId',{value:1});target.dispatchEvent(event);};
  const layout=handle.closest('.jobs-staff-layout');
  pointer(handle,'pointerdown',272);assert.ok(layout.hasAttribute('data-gary-resizing'));
  pointer(h.w,'pointermove',342);pointer(h.w,'pointerup',342);assert.equal(h.sidebar.getState().width,342);assert.equal(h.doc.body.style.userSelect,'');assert.equal(layout.hasAttribute('data-gary-resizing'),false);
  resizeKey(h,'Home');assert.equal(h.sidebar.getState().width,216);resizeKey(h,'End');assert.equal(h.sidebar.getState().width,384);
  await h.click('[data-jobs-sidebar-toggle]');assert.equal(h.sidebar.getState().collapsed,true);assert.deepEqual(editor.getState(),editorState);assert.equal(h.doc.querySelector('[data-cms-editor]'),form);assert.equal(title.value,'Unsaved teaching position');assert.ok(error.textContent);assert.equal(h.cms.isDirty(),true);
  await h.click('[data-jobs-sidebar-toggle]');await h.click('[data-collection=guide]');assert.equal(h.cms.navigationState().kind,'vacancy','declining the dirty warning leaves the current collection intact');assert.equal(h.doc.querySelector('[data-cms-editor]'),form);assert.equal(title.value,'Unsaved teaching position');
  const savedSidebar=h.w.localStorage.getItem('gary-jobs:staff-sidebar:v1'),savedEditor=h.w.localStorage.getItem('gary-editor-workspace:v1:jobs:cms:vacancy');assert.ok(savedSidebar);assert.ok(savedEditor);assert.equal(JSON.parse(savedEditor).maximized,true);assert.equal(JSON.parse(savedSidebar).width,384);assert.equal(JSON.parse(savedSidebar).version,2);assert.equal(JSON.parse(savedSidebar).groups.administration,true);
 }finally{await h.close();}
});

test('Administration opens by default and survives unrelated group collapse',async()=>{
 const h=await staffPortal({caps:{read:true,edit:true,publish:true,recruit:true,media:true,view_staff:true,manage_staff:true,role:'admin'}});try{
  const admin=h.doc.querySelector('[data-jobs-nav-group=administration]');
  assert.equal(admin.dataset.open,'true');
  assert.equal(h.sidebar.getState().groups.administration,true);
  h.doc.querySelector('[data-jobs-nav-group=directory] .jobs-nav-group-toggle').click();
  assert.equal(h.doc.querySelector('[data-jobs-nav-group=directory]').dataset.open,'false');
  assert.equal(admin.dataset.open,'true');
  h.w.localStorage.setItem('gary-jobs:staff-sidebar:v1',JSON.stringify({version:1,width:272,collapsed:false,groups:{administration:false}}));
  h.sidebar.destroy();
  const sidebar=mountJobsStaffSidebar(h.doc);
  h.doc.dispatchEvent(new h.w.CustomEvent('jobs:staff-navigation'));
  assert.equal(sidebar.getState().groups.administration,true,'v1 closed preference does not keep Administration closed');
  assert.equal(h.doc.querySelector('[data-jobs-nav-group=administration]').dataset.open,'true');
  sidebar.destroy();
 }finally{await h.close();}
});

test('sidebar preferences and nested groups persist without changing editor preferences; mobile overlay is keyboard accessible',async()=>{
 const h=await staffPortal();try{
  const group=h.doc.querySelector('[data-jobs-nav-group=directory]'),head=group.querySelector('.jobs-nav-group-toggle'),employer=navigation(h,'employer');
  const key=(element,key)=>element.dispatchEvent(new h.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  head.focus();key(head,'ArrowLeft');
  assert.equal(employer.tabIndex,-1);
  key(head,'ArrowDown');assert.equal(h.doc.activeElement.closest('[data-jobs-nav-group]').dataset.jobsNavGroup,'knowledge');
  head.focus();key(head,'ArrowRight');key(head,'ArrowDown');assert.equal(h.doc.activeElement,employer);
  key(employer,'End');assert.equal(h.doc.activeElement,navigation(h,'media'));
  head.click();resizeKey(h,'Home');await h.click('[data-jobs-sidebar-toggle]');h.sidebar.destroy();
  const sidebar=mountJobsStaffSidebar(h.doc);assert.equal(sidebar.getState().width,216);assert.equal(sidebar.getState().collapsed,true);assert.equal(sidebar.getState().groups.directory,false);assert.equal(group.dataset.open,'true','collapsed rail keeps every labelled icon route reachable');await h.click('[data-jobs-sidebar-toggle]');assert.equal(group.dataset.open,'false','expanding restores the preferred closed group');
  h.w.innerWidth=390;h.w.innerHeight=844;h.w.dispatchEvent(new h.w.Event('resize'));assert.ok(h.doc.querySelector('[data-jobs-sidebar-resize]').hidden);assert.equal(h.doc.querySelector('[data-jobs-sidebar-toggle]').getAttribute('aria-expanded'),'false');
  await h.click('[data-jobs-sidebar-toggle]');assert.equal(sidebar.getState().overlay,true);
  head.click();assert.equal(sidebar.getState().overlay,true);
  const panel=h.doc.querySelector('.jobs-staff-sidebar'),layout=panel.closest('.jobs-staff-layout'),toggle=h.doc.querySelector('[data-jobs-sidebar-toggle]');
  let finished;const fade=new Promise(resolve=>{finished=resolve;});
  panel.getAnimations=()=>[{transitionProperty:'opacity',finished:fade}];
  toggle.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(sidebar.getState().overlay,false);assert.equal(h.doc.activeElement,toggle);
  assert.ok(layout.classList.contains('jobs-sidebar-overlay'));assert.equal(h.doc.querySelector('#workspace-nav').inert,true);
  finished();await fade;assert.equal(layout.classList.contains('jobs-sidebar-overlay'),false);
  assert.equal(JSON.parse(h.w.localStorage.getItem('gary-jobs:staff-sidebar:v1')).width,216);sidebar.destroy();
 }finally{await h.close();}
});

test('a vacancy still validates, saves and publishes after navigation panel changes, and media uploads keep their original input',async()=>{
 const h=await staffPortal();try{
  await h.click('[data-action=new]');h.input('title_en','English teacher');h.input('body_en','Teach and support learners.');h.input('data.employer_name_en','Independent School');h.input('data.category_slug','public');h.input('data.location_slug','hanoi');h.input('data.contact_email','jobs@example.test');h.input('data.closes_on','2099-12-31');resizeKey(h,'Home');await h.click('[data-jobs-sidebar-toggle]');await h.click('[data-action=publish]');assert.equal(h.calls.saves.length,1);assert.equal(h.calls.transitions.length,1);assert.equal(h.calls.transitions[0].status,'published');assert.equal(h.calls.saves[0].record.title_en,'English teacher');
  assert.equal(h.doc.querySelector('.cms-dialog').open,false);assert.ok(h.doc.querySelector('[data-cms-success]')?.isConnected);await h.click('[data-success-close]');await h.click('[data-jobs-sidebar-toggle]');await h.click('[data-collection=media]');const form=h.doc.querySelector('[data-cms-upload]'),file=form.elements.file;const selected=new h.w.File(['image'],'classroom.png',{type:'image/png'});Object.defineProperty(file,'files',{value:[selected]});form.elements.alt_en.value='A classroom';form.elements.alt_vi.value='Lớp học';resizeKey(h,'End');assert.equal(h.doc.querySelector('[data-cms-upload]'),form);assert.equal(file.files[0],selected);form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));await settle();assert.equal(h.calls.uploads.length,1);assert.equal(h.calls.uploads[0].file,selected);
 }finally{await h.close();}
 const css=await readFile(new URL('../dist/jobs-staff-sidebar.css',import.meta.url),'utf8');assert.match(css,/--jobs-staff-surface:var\(--jobs-portal-surface\)/);assert.match(css,/prefers-reduced-motion/);assert.match(css,/@media\(max-width:520px\)/);
});
