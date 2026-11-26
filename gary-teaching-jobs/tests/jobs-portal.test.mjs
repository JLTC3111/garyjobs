import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {bindFeedbackDom} from './helpers/feedback-dom.mjs';
import {mountJobsAccountMenu} from '../dist/jobs-account-menu.js';
import {mountJobsProfileAvatar} from '../dist/jobs-profile-avatar.js';
import {mountPortalAppearance} from '../dist/jobs-portal-appearance.js';
const settle=()=>new Promise(r=>setTimeout(r,15));
async function portal({caps={},view='mine',canLeave=()=>true,listApplications,stats={}}={}){
 const dom=new JSDOM(await readFile(new URL('../dist/portal.html',import.meta.url),'utf8'),{url:'https://jobs.garyhome.vn/portal.html?view='+view,runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
  bindFeedbackDom(dom.window);
 w.mountJobsAccountMenu=mountJobsAccountMenu;
 w.mountJobsProfileAvatar=mountJobsProfileAvatar;

 let currentUser={id:'10000000-0000-4000-8000-000000000001',email:'candidate@example.test'};const calls={submissions:[],cms:[],destroy:[]};
 w.HTMLElement.prototype.scrollIntoView=function(){};w.errorText=e=>e.message;w.unwrap=r=>{if(r.error)throw r.error;return r.data;};w.capabilities=async()=>caps;w.collections=[];w.createCmsAdapter=()=>({});w.STAGES=['submitted','screening'];w.STAGE_LABELS={submitted:['Submitted','Đã nộp'],screening:['Screening','Sàng lọc']};w.jobsConfig={cvBucket:'jobs-cv'};
 w.db={auth:{getUser:async()=>({data:{user:currentUser}}),signOut:async()=>{currentUser=null;return {data:{}};},onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null})}),rpc:async()=>({data:[]})};
 w.mountCms=(root,options)=>{calls.cms.push(options);return {canLeave,destroy:value=>calls.destroy.push(value),setLanguage(){}};};
 w.applicationList=listApplications|| (async()=>({records:[],total:0}));w.uploadCv=async()=>{};w.transitionApplication=async()=>{};
 const originalFrom=w.db.from;
 w.db.from=table=>{
  const query=originalFrom(table);
  let filter, countRequested;
  return {
   select(fields,options){countRequested=options?.head;query.select(fields);return this;},
   eq(key,value){filter=value;query.eq(key,value);return this;},
   maybeSingle:()=>query.maybeSingle(),
   then(resolve,reject){return Promise.resolve({data:null,count:countRequested?stats[filter||table]:null}).then(resolve,reject);}
  };
 };
 w.submitApplication=async value=>{calls.submissions.push(value);return {id:'app-1',candidate_id:currentUser.id,receipt_code:'GJ-TEST-RECEIPT'};};
 const source=(await readFile(new URL('../dist/jobs-portal.js',import.meta.url),'utf8')).split('\n').filter(l=>!l.startsWith('import ')).join('\n');vm.runInContext(source,dom.getInternalVMContext());await settle();return {dom,w,calls};
}
test('candidate account never receives a CMS mount without Jobs read capability',async()=>{
 const h=await portal({view:'cms'});try{assert.equal(h.calls.cms.length,0);assert.match(h.w.document.querySelector('#workspace-view').textContent,/Staff access not assigned/);assert.equal(h.w.document.querySelector('[data-view="cms"]'),null);}finally{h.dom.window.close();}
});
test('candidate submission displays durable backend receipt and includes consent/idempotency identity',async()=>{
 const h=await portal({view:'apply'});try{const f=h.w.document.querySelector('#persistent-application');f.elements.full_name.value='Test Candidate';f.elements.message.value='Teaching experience';f.elements.consent.checked=true;f.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));await settle();assert.equal(h.calls.submissions.length,1);const s=h.calls.submissions[0];assert.equal(s.profile.full_name,'Test Candidate');assert.equal(s.profile.consent,true);assert.match(s.requestId,/^[0-9a-f-]{36}$/);assert.match(h.w.document.querySelector('[data-success-message]').textContent,/GJ-TEST-RECEIPT/);assert.match(h.w.document.querySelector('#workspace-view').textContent,/My applications/);}finally{h.dom.window.close();}
});
test('signout destroys shared CMS private state forcibly and removes application workspace',async()=>{
 const h=await portal({view:'cms',caps:{read:true,edit:true,publish:true}});try{assert.equal(h.calls.cms.length,1);h.w.document.querySelector('#sign-out').click();await settle();assert.ok(h.calls.destroy.some(c=>c?.force===true));assert.equal(h.w.document.querySelector('#signed-panel').hidden,true);assert.equal(h.w.document.querySelector('#workspace-view').textContent,'');assert.match(h.w.document.querySelector('#auth-panel').textContent,/Sign in/);}finally{h.dom.window.close();}
});
test('account links and browser history honor the CMS dirty guard',async()=>{
 let allow=false;
 const h=await portal({view:'cms',caps:{read:true,edit:true},canLeave:()=>allow});
 try{
  const link=h.w.document.querySelector('#portal-account a[href="portal.html?access=candidate"]');
  const click=new h.w.MouseEvent('click',{bubbles:true,cancelable:true});
  link.dispatchEvent(click);
  assert.equal(click.defaultPrevented,true);
  h.w.history.pushState({},'','/portal.html?view=mine');h.w.dispatchEvent(new h.w.PopStateEvent('popstate'));await settle();
  assert.equal(new URL(h.w.location.href).searchParams.get('view'),'cms','Cancelled history navigation restores the current workspace URL');
  assert.equal(h.calls.cms.length,1);assert.equal(h.calls.destroy.length,0,'Cancelled departure keeps the live draft/controller');
  allow=true;h.w.history.pushState({},'','/portal.html?view=mine');h.w.dispatchEvent(new h.w.PopStateEvent('popstate'));await settle();
  assert.ok(h.calls.destroy.some(value=>value?.force===true),'Confirmed departure removes the old private editor and its leave guard');
  assert.match(h.w.document.querySelector('#workspace-view').textContent,/My applications/);
 }finally{h.dom.window.close();}
});

test('mobile Preferences moves the single portal switcher and uses the existing route guard',async()=>{
 let allow=false;
 const h=await portal({view:'cms',caps:{read:true,edit:true},canLeave:()=>allow});
 h.w.innerWidth=390;
 const doc=h.w.document,switcher=doc.getElementById('portal-access'),home=switcher.parentElement;
 const preferences=mountPortalAppearance(doc);
 try{
  const panel=doc.getElementById('portal-preferences-panel'),trigger=doc.getElementById('portal-preferences-trigger');
  assert.ok(panel.contains(switcher));
  assert.equal(doc.querySelectorAll('#portal-access').length,1);
  assert.equal(doc.querySelector('.jobs-portal-header > #portal-access'),null);
  trigger.click();
  assert.equal(panel.hidden,false);
  assert.equal(switcher.querySelector('[aria-current=page]').dataset.access,'staff');
  doc.getElementById('portal-language').click();await settle();
  assert.equal(doc.getElementById('jobs-preferences-portal-title').textContent,'Cổng thông tin');
  assert.deepEqual([...switcher.querySelectorAll('button')].map(button=>button.textContent),['Ứng viên','Nhân viên']);
  switcher.querySelector('[data-access=candidate]').click();
  assert.equal(panel.hidden,false);
  assert.equal(switcher.querySelector('[aria-current=page]').dataset.access,'staff');
  allow=true;switcher.querySelector('[data-access=candidate]').click();await settle();
  assert.equal(new URL(h.w.location.href).searchParams.get('access'),'candidate');
  assert.equal(switcher.querySelector('[aria-current=page]').dataset.access,'candidate');
  assert.equal(panel.hidden,true);
  assert.equal(doc.activeElement,trigger);
  h.w.innerWidth=1024;h.w.dispatchEvent(new h.w.Event('resize'));
  assert.equal(switcher.parentElement,home);
  assert.equal(panel.querySelector('.jobs-preferences-portal').hidden,true);
 }finally{preferences.destroy();h.dom.window.close();}
});

test('application confirmation is visible while the subsequent list read is pending',async()=>{
  let release, reading=false;
  const list=new Promise(resolve=>{release=resolve;});
  const h=await portal({view:'apply',listApplications:()=>{reading=true;return list;}});
  try {
    const form=h.w.document.querySelector('#persistent-application');
    form.elements.full_name.value='Test Candidate';
    form.elements.consent.checked=true;
    form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));
    await settle();
    assert.equal(reading,true);
    assert.match(h.w.document.querySelector('[data-success-message]').textContent,/GJ-TEST-RECEIPT/);
    release({records:[],total:0});
    await settle();
  } finally { release({records:[],total:0}); h.dom.window.close(); }
});

test('recruitment KPIs use confirmed totals independent of the application list',async()=>{
  const h=await portal({view:'applications',caps:{recruit:true},stats:{vacancy:12,jobs_applications:57,jobs_candidates:42,hired:5}});
  try {
    const doc=h.w.document;
    assert.deepEqual([...doc.querySelectorAll('.jobs-recruitment-stats dd')].map(node=>node.textContent),['12','57','42','5']);
    assert.match(doc.querySelector('#page-count').textContent,/0 applications/);
  } finally { h.dom.window.close(); }
});

test('slower recruitment responses cannot replace rows for the latest filter',async()=>{
 const pending=[];
 const h=await portal({view:'applications',caps:{recruit:true},listApplications:options=>{
  if(!options.stage)return Promise.resolve({records:[],total:0});
  return new Promise(resolve=>pending.push({stage:options.stage,resolve}));
 }});
 const doc=h.w.document;
 const answer=(stage,title)=>({records:[{id:stage,vacancy_title:title,stage,created_at:'2026-11-24T00:00:00Z'}],total:1});
 try{
  const filter=doc.getElementById('application-filters');
  const submit=stage=>{filter.elements.stage.value=stage;filter.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));};
  submit('screening');await settle();
  // Pagination and filtering can overlap because they use different controls.
  const go=()=>vm.runInContext('loadApplications()',h.dom.getInternalVMContext());
  vm.runInContext("filterValues={stage:'submitted'}",h.dom.getInternalVMContext());
  const latest=go();
  assert.deepEqual(pending.map(entry=>entry.stage),['screening','submitted']);
  pending[1].resolve(answer('submitted','New result'));await latest;
  pending[0].resolve(answer('screening','Old result'));await settle();
  assert.match(doc.getElementById('applications-list').textContent,/New result/);
  assert.doesNotMatch(doc.getElementById('applications-list').textContent,/Old result/);
 }finally{h.dom.window.close();}
});
