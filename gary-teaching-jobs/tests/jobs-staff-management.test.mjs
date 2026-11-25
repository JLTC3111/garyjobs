import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountStaffManagement} from '../dist/jobs-staff-management.js';
import {staffPortal,settle} from './helpers/jobs-staff-portal.mjs';

const member=(user_id,email,role,extra={})=>({user_id,email,display_name:'',name:null,role,active:true,protected:false,email_confirmed:true,version:1,is_self:false,can_manage:true,...extra});
const overview=({owner=false}={})=>({
 viewer:{user_id:'u-self',protected:owner,can_manage_admins:owner},
 members:[
  member('u-self','self@example.test','admin',{is_self:true,can_manage:false,protected:owner}),
  member('u-owner','owner@example.test','admin',{display_name:'Gary Owner',name:'Gary Owner',protected:true,can_manage:false,version:3}),
  member('u-peer','peer@example.test','admin',{name:'Peer Admin',can_manage:owner}),
  member('u-editor','editor@example.test','editor',{display_name:'<img src=x onerror=alert(1)>',name:'<img src=x onerror=alert(1)>',version:4}),
  member('u-recruiter','recruiter@example.test','recruiter',{display_name:'Rae',name:'Rae',active:false,version:2}),
  member('u-pending','pending@example.test','publisher',{email_confirmed:false}),
 ],
 events:[
  {id:2,target_user_id:'u-recruiter',target_email:'recruiter@example.test',actor_user_id:'u-self',actor_email:'self@example.test',action:'suspended',previous_role:'recruiter',new_role:'recruiter',previous_active:true,new_active:false,created_at:'2026-11-17T10:00:00Z'},
  {id:1,target_user_id:'u-owner',target_email:'owner@example.test',actor_user_id:null,actor_email:null,action:'protected',previous_role:'admin',new_role:'admin',previous_active:true,new_active:true,created_at:'2026-11-16T10:00:00Z'},
 ],
});
function mount({data=overview(),fail=null,respond=()=>{}}={}){
 const dom=new JSDOM('<!doctype html><main class="jobs-workspace"><div id="root"></div></main>',{url:'https://jobs.garyhome.vn/portal.html',pretendToBeVisual:true});
 const win=dom.window,doc=win.document,$=selector=>doc.querySelector(selector);
 const calls={overview:0,assign:[],update:[],confirms:[],notices:[]};
 win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 win.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new win.Event('close'));};
 const adapter={
  overview:async()=>{calls.overview++;await respond('overview');return structuredClone(data);},
  assign:async input=>{
   calls.assign.push(input);
   await respond('assign',input);
   if(fail)throw fail;
   data.members.push(member('new-'+calls.assign.length,input.email,input.role,{display_name:input.display_name}));
  },
  update:async input=>{
   calls.update.push(input);
   await respond('update',input);
   if(fail)throw fail;
   const entry=data.members.find(item=>item.user_id===input.user_id);
   Object.assign(entry,{role:input.role,active:input.active,
    display_name:input.display_name??entry.display_name,version:entry.version+1});
  }
 };
 const h={dom,doc,$,calls,answer:true,
  row:id=>$('[data-user-id="'+id+'"]'),
  action(id,action){return h.row(id)?.querySelector('[data-staff-action="'+action+'"]');},
  openAdd(){ $('[data-staff-action=add]').click(); },
  input(node,value){node.value=value;node.dispatchEvent(new win.Event('input',{bubbles:true}));},
  key(node,key){node.dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));},
  async submit(values={}){
   for(const [key,value] of Object.entries(values))h.input(h.form.elements[key],value);
   h.form.dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
   await settle();
  },
  close(){h.page.destroy();win.close();},
 };
 h.page=mountStaffManagement($('#root'),{adapter,language:'en',errorText:(error,lang)=>lang+':'+error.message,
  confirm:message=>{calls.confirms.push(message);return h.answer;},onNotice:(message,error,confirmed)=>calls.notices.push({message,error,confirmed})});
 h.drawer=$('#jobs-staff-drawer');
 h.form=$('[data-staff-form]');
 return h;
}
const values=select=>[...select.options].map(option=>option.value);

test('the directory leads with compact identities and actions gated by Jobs membership',async()=>{
 const h=mount();try{
  await h.page.ready;
  assert.equal(h.$('h1').textContent,'Staff management');
  assert.equal(h.$('.jobs-staff-admin > section').classList.contains('jobs-staff-directory'),true);
  assert.equal(h.doc.querySelectorAll('.jobs-staff-member').length,6);
  assert.equal(h.doc.querySelectorAll('.jobs-staff-member form, .jobs-staff-member input, .jobs-staff-member select').length,0);
  assert.match(h.$('[data-staff-count]').textContent,/6 memberships/);
  assert.match(h.row('u-owner').textContent,/Gary Owner.*owner@example\.test.*Admin.*Active.*Protected owner/s);
  assert.equal(h.row('u-owner').querySelector('.jobs-staff-avatar').textContent,'GO');
  assert.equal(h.doc.querySelector('#root img'),null,'display names are escaped');
  assert.equal(h.row('u-editor').querySelector('strong').textContent,'<img src=x onerror=alert(1)>');
  for(const [id,reason]of [['u-self',/Your account/],['u-owner',/Protected account/],['u-peer',/only a protected owner/]]){
   assert.equal(h.action(id,'edit'),null);assert.equal(h.action(id,'more'),null);
   assert.match(h.row(id).textContent,reason);
  }
  assert.match(h.row('u-recruiter').textContent,/Suspended · no access/);
  assert.match(h.row('u-pending').textContent,/Email not verified · no access/);
  const guide=h.$('details.jobs-staff-guide');
  assert.equal(guide.open,true);
  guide.querySelector('summary').click();assert.equal(guide.open,false);
  assert.deepEqual([...guide.querySelectorAll('dt')].map(term=>term.textContent),['Editor','Publisher','Recruiter','Admin','No access']);
  assert.match(guide.querySelectorAll('dd')[1].textContent,/Create and edit drafts.*upload media, publish and archive/);
  h.openAdd();
  assert.deepEqual(values(h.form.elements.role),['editor','publisher','recruiter']);
  assert.match(h.form.textContent,/only be granted by a protected Jobs owner/);
  assert.match(h.form.elements.role.options[1].title,/publish and archive content/);
  const history=[...h.doc.querySelectorAll('.jobs-staff-history li')].map(item=>item.textContent);
  assert.match(history[0],/Access suspended · recruiter@example\.test · Recruiter → No access.*By self@example\.test/);
  assert.match(history[1],/Marked protected.*By Database operator/);
 }finally{h.close();}
 const owner=mount({data:overview({owner:true})});try{
  await owner.page.ready;
  owner.action('u-peer','edit').click();
  assert.deepEqual(values(owner.form.elements.role),['editor','publisher','recruiter','admin']);
  assert.equal(owner.form.elements.role.value,'admin');
  owner.answer=false;await owner.submit({role:'editor'});
  assert.match(owner.calls.confirms[0],/Change Administrator access for peer@example\.test/);
  assert.equal(owner.calls.update.length,0);
  assert.equal(owner.action('u-owner','edit'),null,'another protected owner stays view-only');
 }finally{owner.close();}
});

test('search combines Jobs names and emails with role and status filters',async()=>{
 const h=mount();try{
  await h.page.ready;
  const form=h.$('.jobs-staff-filters');
  const shown=()=>[...h.doc.querySelectorAll('.jobs-staff-member')].map(row=>row.dataset.userId);
  for(const field of form.elements)assert.equal(field.labels.length,1);
  h.input(form.elements.query,'  GÁRY   OWNER ');
  assert.deepEqual(shown(),['u-owner']);
  h.input(form.elements.query,'example.test');
  h.input(form.elements.role,'publisher');h.input(form.elements.status,'unverified');
  assert.deepEqual(shown(),['u-pending']);
  assert.match(h.$('[data-staff-count]').textContent,/Showing 1 of 6/);
  h.input(form.elements.status,'suspended');
  assert.deepEqual(shown(),[]);
  assert.match(h.$('.jobs-staff-list').textContent,/No staff match/);
  h.$('[data-staff-action=clear]').click();
  assert.equal(shown().length,6);
  assert.equal(h.doc.activeElement,form.elements.query);
  assert.equal(h.calls.overview,1);
 }finally{h.close();}
});

test('Add and Edit share a drawer, and the menu confirms versioned suspensions and restores',async()=>{
 let finish;
 const pending=new Promise(resolve=>{finish=resolve;});
 const h=mount({respond:action=>action==='assign'?pending:undefined});
 try{
  await h.page.ready;h.openAdd();
  const drawer=h.drawer;
  assert.equal(h.doc.activeElement,h.$('#jobs-staff-drawer-title'));
  await h.submit();
  assert.equal(h.calls.assign.length,0,'a missing email is rejected before any request');
  await h.submit({email:' new.person@example.test ',display_name:' New Person ',role:'publisher'});
  assert.deepEqual(h.calls.assign,[{email:'new.person@example.test',role:'publisher',display_name:'New Person'}]);
  assert.equal(h.drawer.open,true);
  assert.equal(h.calls.notices.length,0,'there is no success before the RPC resolves');
  finish();await settle();
  assert.equal(drawer.open,false);
  assert.equal(h.calls.overview,2);
  assert.equal(h.calls.notices.at(-1).confirmed,true);
  assert.equal(h.doc.activeElement,h.$('[data-staff-action=add]'));
  h.openAdd();assert.equal(h.form.elements.email.value,'');
  h.$('.jobs-staff-drawer-header button').click();
  h.action('u-editor','edit').click();
  assert.equal(h.drawer,drawer);
  assert.equal(h.form.elements.email.value,'editor@example.test');
  assert.equal(h.form.elements.email.readOnly,true);
  assert.equal(h.form.elements.role.value,'editor');
  await h.submit({role:'publisher'});
  assert.deepEqual(h.calls.update.at(-1),{user_id:'u-editor',role:'publisher',active:true,display_name:'<img src=x onerror=alert(1)>',version:4});
  assert.equal(h.calls.confirms.length,0,'ordinary role changes need no confirmation');

  const more=h.action('u-editor','more'),suspend=h.action('u-editor','suspend');
  const panel=h.doc.getElementById(more.getAttribute('aria-controls'));
  assert.equal(panel.hasAttribute('inert'),true);
  suspend.click();assert.equal(h.calls.update.length,1);
  more.focus();h.key(more,'ArrowDown');
  assert.equal(h.doc.activeElement,suspend);
  assert.equal(more.getAttribute('aria-expanded'),'true');
  h.key(suspend,'Escape');
  assert.equal(h.doc.activeElement,more);
  assert.equal(panel.hasAttribute('inert'),true);
  h.answer=false;more.click();suspend.click();
  assert.equal(h.calls.update.length,1,'declining the suspension sends nothing');
  assert.match(h.calls.confirms.at(-1),/Suspend Jobs access for editor@example\.test\? Their history and recruitment assignments are kept\./);
  h.answer=true;more.click();suspend.click();await settle();
  assert.deepEqual(h.calls.update.at(-1),{user_id:'u-editor',role:'publisher',active:false,display_name:null,version:5});

  h.action('u-recruiter','edit').click();
  await h.submit({display_name:'Jobs Rae'});
  assert.deepEqual(h.calls.update.at(-1),{user_id:'u-recruiter',role:'recruiter',active:false,display_name:'Jobs Rae',version:2});
  h.action('u-recruiter','more').click();h.action('u-recruiter','restore').click();await settle();
  assert.match(h.calls.confirms.at(-1),/Restore Jobs access for recruiter@example\.test as Recruiter/);
  assert.deepEqual(h.calls.update.at(-1),{user_id:'u-recruiter',role:'recruiter',active:true,display_name:null,version:3});
  assert.deepEqual(h.calls.notices.at(-1),{message:'Jobs access restored for recruiter@example.test.',error:false,confirmed:true});
  const sent=h.calls.update.length;
  h.action('u-pending','edit').click();await h.submit();
  assert.equal(h.calls.update.length,sent);
  assert.equal(h.$('#jobs-staff-form-feedback').textContent,'No changes to save.');
 }finally{h.close();}
});

test('rejected writes keep the drawer values and show inline feedback',async()=>{
 const h=mount({fail:new Error('jobs.owner_required')});try{
  await h.page.ready;
  h.action('u-editor','edit').click();
  await h.submit({role:'publisher'});
  assert.equal(h.$('#jobs-staff-form-feedback').textContent,'en:jobs.owner_required');
  assert.equal(h.calls.notices.length,0);
  assert.equal(h.calls.overview,1);
  assert.equal(h.drawer.open,true);
  assert.equal(h.form.elements.role.value,'publisher');
  assert.equal(h.form.querySelector('[type=submit]').disabled,false);
 }finally{h.close();}
});

test('a concurrent membership change refreshes the version and keeps the unfinished edit',async()=>{
 const data=overview();
 let stale=true;
 const h=mount({data,respond:action=>{
  if(action!=='update'||!stale)return;
  stale=false;
  const entry=data.members.find(item=>item.user_id==='u-editor');
  Object.assign(entry,{role:'recruiter',version:5});
  throw Object.assign(new Error('jobs.version_conflict'),{code:'PT409'});
 }});try{
  await h.page.ready;h.action('u-editor','edit').click();
  await h.submit({display_name:'My Jobs name'});
  assert.equal(h.drawer.open,true);
  assert.match(h.$('#jobs-staff-form-feedback').textContent,/Review the refreshed values/);
  assert.equal(h.form.elements.role.value,'recruiter');
  assert.equal(h.form.elements.display_name.value,'My Jobs name');
  assert.equal(h.calls.update.length,1,'a conflict is never replayed automatically');
  assert.equal(h.calls.notices.length,0);
  await h.submit();
  assert.equal(h.calls.update.at(-1).version,5);
  assert.equal(h.calls.update.at(-1).role,'recruiter');
  assert.equal(h.calls.notices.at(-1).confirmed,true);
 }finally{h.close();}
});

test('Vietnamese labels and drawer drafts survive language changes and dismissal',async()=>{
 const h=mount();try{
  await h.page.ready;h.openAdd();
  h.input(h.form.elements.email,'draft@example.test');
  h.input(h.form.elements.role,'recruiter');
  const cancel=new h.dom.window.Event('cancel',{cancelable:true});
  h.drawer.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented,true);
  assert.equal(h.doc.activeElement,h.$('[data-staff-action=add]'));
  h.action('u-editor','edit').click();
  h.input(h.form.elements.display_name,'A Jobs draft');
  h.$('.jobs-staff-drawer-header button').click();
  h.openAdd();h.page.setLanguage('vi');
  assert.equal(h.$('h1').textContent,'Quản lý nhân viên');
  assert.equal(h.form.elements.email.value,'draft@example.test');
  assert.equal(h.form.elements.role.value,'recruiter');
  assert.equal(h.form.elements.role.selectedOptions[0].textContent,'Chuyên viên tuyển dụng');
  assert.match(h.form.elements.role.selectedOptions[0].title,/Chỉ tuyển dụng/);
  assert.match(h.row('u-recruiter').textContent,/Đã tạm ngưng · không có quyền/);
  assert.match(h.row('u-self').textContent,/Tài khoản của bạn · chỉ xem/);
  assert.match(h.$('.jobs-staff-history').textContent,/Bởi Quản trị cơ sở dữ liệu/);
  h.$('.jobs-staff-drawer-header button').click();
  h.action('u-editor','edit').click();
  assert.equal(h.form.elements.display_name.value,'A Jobs draft');
  assert.equal(h.calls.overview,1,'switching language does not refetch');
 }finally{h.close();}
});

test('the portal offers staff management only to Jobs administrators',async()=>{
 const adapter={calls:0,overview:async()=>{adapter.calls++;return overview();},assign:async()=>({}),update:async()=>({})};
 const admin=await staffPortal({caps:{read:true,edit:true,publish:true,media:true,recruit:true,role:'admin',manage_staff:true},staff:adapter});
 try{
  assert.equal(admin.doc.querySelector('[data-jobs-nav-group=administration] [data-view=staff] .jobs-nav-label').textContent,'Staff management');
  await admin.click('[data-view=staff]');
  assert.equal(new URL(admin.w.location.href).searchParams.get('view'),'staff');
  assert.equal(admin.doc.querySelector('[data-view=staff]').getAttribute('aria-current'),'page');
  assert.equal(admin.doc.querySelector('#workspace-view h1').textContent,'Staff management');
  assert.equal(adapter.calls,1);
  await admin.click('#portal-language');
  assert.equal(admin.doc.querySelector('#workspace-view h1').textContent,'Quản lý nhân viên');
  assert.equal(admin.doc.querySelector('[data-view=staff] .jobs-nav-label').textContent,'Quản lý nhân viên');
  assert.equal(adapter.calls,1);
  await admin.click('[data-staff-action=add]');
  const form=admin.doc.querySelector('[data-staff-form]');
  form.elements.email.value='verified@example.test';
  form.dispatchEvent(new admin.w.Event('submit',{bubbles:true,cancelable:true}));
  await settle();
  assert.match(admin.doc.querySelector('[data-toast-id]').textContent,/Đã cấp quyền Jobs cho verified@example\.test/);
  assert.equal(adapter.calls,2);
  await admin.click('[data-view=applications]');
  assert.equal(admin.doc.querySelector('.jobs-staff-admin'),null,'leaving the view removes the staff list');
 }finally{await admin.close();}
 for(const caps of [{read:true,edit:true,publish:true,media:true,recruit:true,role:'admin'},{read:true,edit:true,role:'editor',manage_staff:false}]){
  const h=await staffPortal({caps,view:'staff',staff:adapter});
  try{
   assert.equal(h.doc.querySelector('[data-view=staff]'),null);
   assert.equal(h.doc.querySelector('[data-jobs-nav-group=administration]'),null);
   assert.equal(h.doc.querySelector('.jobs-staff-admin'),null,'a staff deep link without permission opens a permitted workspace instead');
   assert.equal(adapter.calls,2);
  }finally{await h.close();}
 }
});
