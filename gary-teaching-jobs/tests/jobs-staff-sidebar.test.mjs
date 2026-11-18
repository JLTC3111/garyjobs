import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
  await h.click('#portal-language');assert.equal(navigation(h,'vacancy').getAttribute('aria-label'),'Tin tuyển dụng');assert.equal(h.doc.querySelector('[data-jobs-sidebar-toggle]').getAttribute('aria-label'),'Thu gọn điều hướng');
 }finally{await h.close();}
});

test('sidebar visibility remains capability-dependent and candidate navigation is unchanged',async()=>{
 for(const [caps,expected]of [[{read:true,edit:false,publish:false,role:'reader'},7],[{recruit:true,role:'recruiter'},0],[{},0]]){
  const h=await staffPortal({caps});try{assert.equal(h.doc.querySelectorAll('#workspace-nav [data-collection]').length,expected);assert.equal(!!h.doc.querySelector('[data-view=applications]'),!!caps.recruit);if(!caps.read)assert.equal(h.cms,null);if(caps.read)assert.equal(h.doc.querySelector('[data-action=new]'),null);}finally{await h.close();}
 }
 const h=await staffPortal({access:'candidate',view:'mine'});try{assert.equal(h.doc.body.dataset.jobsStaff,'false');assert.equal(h.doc.querySelectorAll('[data-jobs-nav-group]').length,0);assert.equal(h.doc.querySelector('[data-view=mine]').textContent,'My applications');assert.equal(h.doc.querySelectorAll('#workspace-nav button').length,1);}finally{await h.close();}
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
  const savedSidebar=h.w.localStorage.getItem('gary-jobs:staff-sidebar:v1'),savedEditor=h.w.localStorage.getItem('gary-editor-workspace:v1:jobs:cms:vacancy');assert.ok(savedSidebar);assert.ok(savedEditor);assert.equal(JSON.parse(savedEditor).maximized,true);assert.equal(JSON.parse(savedSidebar).width,384);
 }finally{await h.close();}
});

test('sidebar preferences and nested groups persist without changing editor preferences; mobile overlay is keyboard accessible',async()=>{
 const h=await staffPortal();try{
  resizeKey(h,'Home');const group=h.doc.querySelector('[data-jobs-nav-group=directory]');group.open=false;group.dispatchEvent(new h.w.Event('toggle',{bubbles:false}));await h.click('[data-jobs-sidebar-toggle]');h.sidebar.destroy();const sidebar=mountJobsStaffSidebar(h.doc);assert.equal(sidebar.getState().width,216);assert.equal(sidebar.getState().collapsed,true);assert.equal(sidebar.getState().groups.directory,false);assert.equal(h.doc.querySelector('[data-jobs-nav-group=directory]').open,true,'collapsed rail keeps every labelled icon route reachable');await h.click('[data-jobs-sidebar-toggle]');assert.equal(h.doc.querySelector('[data-jobs-nav-group=directory]').open,false,'expanding restores the preferred closed group');
  h.w.innerWidth=390;h.w.innerHeight=844;h.w.dispatchEvent(new h.w.Event('resize'));assert.ok(h.doc.querySelector('[data-jobs-sidebar-resize]').hidden);assert.equal(h.doc.querySelector('[data-jobs-sidebar-toggle]').getAttribute('aria-expanded'),'false');
  await h.click('[data-jobs-sidebar-toggle]');assert.equal(sidebar.getState().overlay,true);
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
  assert.equal(h.doc.querySelector('.cms-dialog').open,false);assert.ok(h.doc.querySelector('[data-cms-success]').open);await h.click('[data-success-close]');await h.click('[data-jobs-sidebar-toggle]');await h.click('[data-collection=media]');const form=h.doc.querySelector('[data-cms-upload]'),file=form.elements.file;const selected=new h.w.File(['image'],'classroom.png',{type:'image/png'});Object.defineProperty(file,'files',{value:[selected]});form.elements.alt_en.value='A classroom';form.elements.alt_vi.value='Lớp học';resizeKey(h,'End');assert.equal(h.doc.querySelector('[data-cms-upload]'),form);assert.equal(file.files[0],selected);form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));await settle();assert.equal(h.calls.uploads.length,1);assert.equal(h.calls.uploads[0].file,selected);
 }finally{await h.close();}
 const css=await readFile(new URL('../dist/jobs-staff-sidebar.css',import.meta.url),'utf8');assert.match(css,/--jobs-staff-surface:var\(--jobs-portal-surface\)/);assert.match(css,/prefers-reduced-motion/);assert.match(css,/@media\(max-width:520px\)/);
});
