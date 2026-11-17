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
function mount({data=overview(),fail=null}={}){
 const dom=new JSDOM('<!doctype html><main class="jobs-workspace"><div id="root"></div></main>',{url:'https://jobs.garyhome.vn/portal.html',pretendToBeVisual:true});
 const doc=dom.window.document,calls={overview:0,assign:[],update:[],confirms:[],notices:[]};
 const adapter={
  overview:async()=>{calls.overview++;return structuredClone(data);},
  assign:async input=>{calls.assign.push(input);if(fail)throw fail;return {};},
  update:async input=>{calls.update.push(input);if(fail)throw fail;return {};},
 };
 const h={dom,doc,calls,answer:true,
  row:id=>doc.querySelector(`.jobs-staff-member[data-user-id="${id}"]`),
  async submit(form){form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();},
  close(){h.page.destroy();dom.window.close();},
 };
 h.page=mountStaffManagement(doc.getElementById('root'),{adapter,language:'en',errorText:(error,lang)=>`${lang}:${error.message}`,confirm:message=>{calls.confirms.push(message);return h.answer;},onNotice:(message,error=false)=>calls.notices.push({message,error})});
 return h;
}
const values=select=>[...select.options].map(option=>option.value);

test('staff list shows names, emails, roles and access while self, protected and peer administrator rows stay read-only',async()=>{
 const h=mount();try{
  await h.page.ready;
  assert.equal(h.doc.querySelector('h1').textContent,'Staff management');
  assert.equal(h.doc.querySelectorAll('.jobs-staff-member').length,6);
  assert.match(h.row('u-owner').textContent,/Gary Owner.*owner@example\.test.*Admin.*Active.*Protected/);
  assert.equal(h.doc.querySelector('#root img'),null,'display names are escaped');
  assert.equal(h.row('u-editor').querySelector('strong').textContent,'<img src=x onerror=alert(1)>');
  for(const [id,reason]of [['u-self',/Your account/],['u-owner',/Protected account/],['u-peer',/only a protected owner/]]){
   assert.equal(h.row(id).querySelector('form'),null,id);assert.match(h.row(id).textContent,reason);
  }
  const access=h.row('u-editor').querySelector('select[name=access]');
  assert.deepEqual(values(access),['editor','publisher','recruiter','none'],'Admin is not offered without owner authority');
  assert.match(access.getAttribute('aria-label'),/^Access · editor@example\.test$/);
  assert.equal(h.row('u-recruiter').querySelector('select[name=access]').value,'none');
  assert.match(h.row('u-recruiter').textContent,/Suspended · no access/);
  assert.match(h.row('u-pending').textContent,/Email not verified · no access/);
  assert.deepEqual(values(h.doc.querySelector('[data-staff-form=assign] select[name=role]')),['editor','publisher','recruiter']);
  assert.match(h.doc.querySelector('[data-staff-form=assign]').textContent,/only be granted by a protected Jobs owner/);
  assert.deepEqual([...h.doc.querySelectorAll('.jobs-staff-permissions tbody th')].map(cell=>cell.textContent),['Editor','Publisher','Recruiter','Admin','No access']);
  const history=[...h.doc.querySelectorAll('.jobs-staff-history li')].map(item=>item.textContent);
  assert.match(history[0],/Access suspended · recruiter@example\.test · Recruiter → No access.*By self@example\.test/);
  assert.match(history[1],/Marked protected.*By Database operator/);
 }finally{h.close();}
 const owner=mount({data:overview({owner:true})});try{
  await owner.page.ready;
  assert.deepEqual(values(owner.row('u-peer').querySelector('select[name=access]')),['editor','publisher','recruiter','admin','none']);
  assert.ok(values(owner.doc.querySelector('[data-staff-form=assign] select[name=role]')).includes('admin'));
  assert.equal(owner.row('u-owner').querySelector('form'),null,'another protected owner stays read-only');
 }finally{owner.close();}
});

test('assigning, changing, suspending and restoring access call the guarded API with expected versions',async()=>{
 const h=mount();try{
  await h.page.ready;
  const assign=()=>h.doc.querySelector('[data-staff-form=assign]');
  await h.submit(assign());
  assert.equal(h.calls.assign.length,0,'a missing email is rejected before any request');
  assign().elements.email.value='  new.person@example.test ';assign().elements.display_name.value=' New Person ';assign().elements.role.value='publisher';
  await h.submit(assign());
  assert.deepEqual(h.calls.assign,[{email:'new.person@example.test',role:'publisher',display_name:'New Person'}]);
  assert.equal(h.calls.overview,2,'the list reloads after a change');
  assert.deepEqual(h.calls.notices.at(-1),{message:'Jobs access assigned to new.person@example.test.',error:false});
  assert.equal(assign().elements.email.value,'','the draft clears after success');

  const form=id=>h.row(id).querySelector('form');
  form('u-editor').elements.access.value='publisher';await h.submit(form('u-editor'));
  assert.deepEqual(h.calls.update.at(-1),{user_id:'u-editor',role:'publisher',active:true,display_name:'<img src=x onerror=alert(1)>',version:4});
  assert.equal(h.calls.confirms.length,0,'ordinary role changes need no confirmation');

  h.answer=false;form('u-editor').elements.access.value='none';await h.submit(form('u-editor'));
  assert.equal(h.calls.update.length,1,'declining the suspension sends nothing');
  assert.match(h.calls.confirms.at(-1),/Suspend Jobs access for editor@example\.test\? Their history and recruitment assignments are kept\./);
  h.answer=true;await h.submit(form('u-editor'));
  assert.deepEqual(h.calls.update.at(-1),{user_id:'u-editor',role:'editor',active:false,display_name:'<img src=x onerror=alert(1)>',version:4},'suspension keeps the role for history');

  form('u-recruiter').elements.access.value='recruiter';await h.submit(form('u-recruiter'));
  assert.deepEqual(h.calls.update.at(-1),{user_id:'u-recruiter',role:'recruiter',active:true,display_name:'Rae',version:2});
  assert.equal(h.calls.notices.at(-1).message,'Access updated for recruiter@example.test.');

  const sent=h.calls.update.length;await h.submit(form('u-pending'));
  assert.equal(h.calls.update.length,sent);assert.equal(h.calls.notices.at(-1).message,'No changes to save.');
 }finally{h.close();}

 const denied=mount({fail:new Error('jobs.owner_required')});try{
  await denied.page.ready;
  const form=denied.row('u-editor').querySelector('form');form.elements.access.value='publisher';
  await denied.submit(form);
  assert.deepEqual(denied.calls.notices.at(-1),{message:'en:jobs.owner_required',error:true});
  assert.equal(denied.calls.overview,1,'a rejected change does not pretend to refresh');
  assert.equal(form.elements.access.value,'publisher','the unsaved choice remains for correction');
  assert.equal([...denied.doc.querySelectorAll('#root button')].some(button=>button.disabled),false);
 }finally{denied.close();}
});

test('Vietnamese staff management translates roles and guidance and keeps an unsaved assignment draft',async()=>{
 const h=mount();try{
  await h.page.ready;
  const email=h.doc.querySelector('[data-staff-form=assign] [name=email]');
  email.value='draft@example.test';email.dispatchEvent(new h.dom.window.Event('input',{bubbles:true}));
  h.page.setLanguage('vi');
  assert.equal(h.doc.querySelector('h1').textContent,'Quản lý nhân viên');
  assert.equal(h.doc.querySelector('[data-staff-form=assign] [name=email]').value,'draft@example.test');
  assert.deepEqual([...h.doc.querySelectorAll('.jobs-staff-permissions tbody th')].map(cell=>cell.textContent),['Biên tập viên','Người xuất bản','Chuyên viên tuyển dụng','Quản trị viên','Không có quyền']);
  assert.match(h.row('u-recruiter').textContent,/Đã tạm ngưng · không có quyền/);
  assert.match(h.row('u-self').textContent,/Tài khoản của bạn · chỉ xem/);
  assert.match(h.doc.querySelector('.jobs-staff-history').textContent,/Bởi Quản trị cơ sở dữ liệu/);
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
  await admin.click('[data-view=applications]');
  assert.equal(admin.doc.querySelector('.jobs-staff-admin'),null,'leaving the view removes the staff list');
 }finally{await admin.close();}
 for(const caps of [{read:true,edit:true,publish:true,media:true,recruit:true,role:'admin'},{read:true,edit:true,role:'editor',manage_staff:false}]){
  const h=await staffPortal({caps,view:'staff',staff:adapter});
  try{
   assert.equal(h.doc.querySelector('[data-view=staff]'),null);
   assert.equal(h.doc.querySelector('[data-jobs-nav-group=administration]'),null);
   assert.equal(h.doc.querySelector('.jobs-staff-admin'),null,'a staff deep link without permission opens a permitted workspace instead');
   assert.equal(adapter.calls,1);
  }finally{await h.close();}
 }
});
