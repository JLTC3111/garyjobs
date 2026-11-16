import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const settle=()=>new Promise(r=>setTimeout(r,15));
async function portal({caps={},view='mine',canLeave=()=>true}={}){
 const dom=new JSDOM(await readFile(new URL('../dist/portal.html',import.meta.url),'utf8'),{url:'https://jobs.garyhome.vn/portal.html?view='+view,runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 let currentUser={id:'10000000-0000-4000-8000-000000000001',email:'candidate@example.test'};const calls={submissions:[],cms:[],destroy:[]};
 w.HTMLElement.prototype.scrollIntoView=function(){};w.errorText=e=>e.message;w.unwrap=r=>{if(r.error)throw r.error;return r.data;};w.capabilities=async()=>caps;w.collections=[];w.createCmsAdapter=()=>({});w.STAGES=['submitted','screening'];w.STAGE_LABELS={submitted:['Submitted','Đã nộp'],screening:['Screening','Sàng lọc']};w.jobsConfig={cvBucket:'jobs-cv'};
 w.db={auth:{getUser:async()=>({data:{user:currentUser}}),signOut:async()=>{currentUser=null;return {data:{}};},onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null})}),rpc:async()=>({data:[]})};
 w.mountCms=(root,options)=>{calls.cms.push(options);return {canLeave,destroy:value=>calls.destroy.push(value),setLanguage(){}};};
 w.applicationList=async()=>({records:[],total:0});w.uploadCv=async()=>{};w.transitionApplication=async()=>{};
 w.submitApplication=async value=>{calls.submissions.push(value);return {id:'app-1',candidate_id:currentUser.id,receipt_code:'GJ-TEST-RECEIPT'};};
 const source=(await readFile(new URL('../dist/jobs-portal.js',import.meta.url),'utf8')).split('\n').filter(l=>!l.startsWith('import ')).join('\n');vm.runInContext(source,dom.getInternalVMContext());await settle();return {dom,w,calls};
}
test('candidate account never receives a CMS mount without Jobs read capability',async()=>{
 const h=await portal({view:'cms'});try{assert.equal(h.calls.cms.length,0);assert.match(h.w.document.querySelector('#workspace-view').textContent,/Staff access not assigned/);assert.equal(h.w.document.querySelector('[data-view="cms"]'),null);}finally{h.dom.window.close();}
});
test('candidate submission displays durable backend receipt and includes consent/idempotency identity',async()=>{
 const h=await portal({view:'apply'});try{const f=h.w.document.querySelector('#persistent-application');f.elements.full_name.value='Test Candidate';f.elements.message.value='Teaching experience';f.elements.consent.checked=true;f.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));await settle();assert.equal(h.calls.submissions.length,1);const s=h.calls.submissions[0];assert.equal(s.profile.full_name,'Test Candidate');assert.equal(s.profile.consent,true);assert.match(s.requestId,/^[0-9a-f-]{36}$/);assert.match(h.w.document.querySelector('#portal-status').textContent,/GJ-TEST-RECEIPT/);assert.match(h.w.document.querySelector('#workspace-view').textContent,/My applications/);}finally{h.dom.window.close();}
});
test('signout destroys shared CMS private state forcibly and removes application workspace',async()=>{
 const h=await portal({view:'cms',caps:{read:true,edit:true,publish:true}});try{assert.equal(h.calls.cms.length,1);h.w.document.querySelector('#sign-out').click();await settle();assert.ok(h.calls.destroy.some(c=>c?.force===true));assert.equal(h.w.document.querySelector('#signed-panel').hidden,true);assert.equal(h.w.document.querySelector('#workspace-view').textContent,'');assert.match(h.w.document.querySelector('#auth-panel').textContent,/Sign in/);}finally{h.dom.window.close();}
});
test('browser history honors the CMS dirty guard and tears down discarded private editor state',async()=>{
 let allow=false;
 const h=await portal({view:'cms',caps:{read:true,edit:true},canLeave:()=>allow});
 try{
  h.w.history.pushState({},'','/portal.html?view=mine');h.w.dispatchEvent(new h.w.PopStateEvent('popstate'));await settle();
  assert.equal(new URL(h.w.location.href).searchParams.get('view'),'cms','Cancelled history navigation restores the current workspace URL');
  assert.equal(h.calls.cms.length,1);assert.equal(h.calls.destroy.length,0,'Cancelled departure keeps the live draft/controller');
  allow=true;h.w.history.pushState({},'','/portal.html?view=mine');h.w.dispatchEvent(new h.w.PopStateEvent('popstate'));await settle();
  assert.ok(h.calls.destroy.some(value=>value?.force===true),'Confirmed departure removes the old private editor and its leave guard');
  assert.match(h.w.document.querySelector('#workspace-view').textContent,/My applications/);
 }finally{h.dom.window.close();}
});
