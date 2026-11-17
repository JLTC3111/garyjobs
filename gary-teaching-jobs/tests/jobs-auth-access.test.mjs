import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const candidate={id:'10000000-0000-4000-8000-000000000001',email:'candidate@example.test'};
async function portal({access,view,user=candidate,caps={},getUser,getCapabilities,fastTimeout=false,query='',hash='',emitOnSignIn=false}={}){
 const url=new URL('https://jobs.garyhome.vn/portal.html');
 url.search=query;url.hash=hash;
 if(access)url.searchParams.set('access',access);
 if(view)url.searchParams.set('view',view);
 const dom=new JSDOM(await readFile(new URL('../dist/portal.html',import.meta.url),'utf8'),{url:url.href,runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,calls={cms:0,destroy:0,applications:0,applicationOptions:[],rpc:[],users:0,signIns:[],registrations:[]};
 let currentUser=user,authListener;
 if(fastTimeout){const schedule=w.setTimeout.bind(w);w.setTimeout=(fn,delay,...args)=>schedule(fn,delay>=1000?25:delay,...args);}
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.errorText=()=> 'The action could not be completed. Check your connection and try again.';
 w.unwrap=r=>{if(r.error)throw r.error;return r.data;};
 w.capabilities=async()=>getCapabilities?getCapabilities():caps;
 w.collections=[];w.createCmsAdapter=()=>({});
 w.STAGES=['submitted','screening'];
 w.STAGE_LABELS={submitted:['Submitted','Đã nộp'],screening:['Screening','Sàng lọc']};
 w.jobsConfig={cvBucket:'jobs-cv'};
 w.db={
  auth:{
   getUser:async()=>{calls.users++;return getUser?getUser(calls.users,currentUser):{data:{user:currentUser}};},
   signInWithPassword:async credentials=>{calls.signIns.push(credentials);currentUser=candidate;if(emitOnSignIn)authListener?.('SIGNED_IN',{user:currentUser});return {data:{user:currentUser}};},
   signUp:async credentials=>{calls.registrations.push(credentials);return {data:{}};},
   signOut:async()=>{currentUser=null;authListener?.('SIGNED_OUT',null);return {data:{}};},
   onAuthStateChange:callback=>{authListener=callback;return {data:{subscription:{unsubscribe(){}}}};},
  },
  from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null})}),
  rpc:async name=>{calls.rpc.push(name);return {data:[]};},
 };
 w.mountCms=root=>{
  calls.cms++;root.innerHTML='<p data-private-content>Private CMS workspace</p>';
  return {canLeave:()=>true,destroy:()=>{calls.destroy++;root.replaceChildren();},setLanguage(){}};
 };
 w.applicationList=async options=>{calls.applications++;calls.applicationOptions.push(options);return {records:[],total:0};};
 w.uploadCv=async()=>{};w.transitionApplication=async()=>{};w.submitApplication=async()=>({});
 const source=(await readFile(new URL('../dist/jobs-portal.js',import.meta.url),'utf8')).split('\n').filter(line=>!line.startsWith('import ')).join('\n');
 vm.runInContext(source,dom.getInternalVMContext());
 const result={dom,w,calls,emit(event,nextUser){currentUser=nextUser;return authListener?.(event,nextUser?{user:nextUser}:null);},settle:()=>pause(35)};
 return result;
}
function visible(element){return !!element&&!element.hidden&&!element.closest('[hidden]');}
function text(h){return h.w.document.querySelector('#portal-main').textContent;}

test('candidate and staff entry choices remain available when signed out',async()=>{
 const h=await portal({access:'candidate',user:null});
 try{
  await h.settle();
  const nav=h.w.document.querySelector('#portal-access');
  assert.ok(visible(nav));
  for(const access of ['candidate','staff'])assert.ok(nav.querySelector(`[data-action="access"][data-access="${access}"]`));
  h.w.document.querySelector('[data-action="access"][data-access="staff"]').click();
  await h.settle();
  assert.equal(new URL(h.w.location.href).searchParams.get('access'),'staff');
  assert.match(h.w.document.querySelector('#auth-panel').textContent,/Staff sign in/);
  assert.equal(h.w.document.querySelector('#auth-panel [data-action="register"]'),null);
 }finally{h.dom.window.close();}
});

test('staff sign-in entry hides candidate registration',async()=>{
 const h=await portal({access:'staff',user:null});
 try{
  await h.settle();
  assert.match(h.w.document.querySelector('#auth-panel').textContent,/Staff sign in/);
  assert.equal(h.w.document.querySelector('#auth-panel [data-action="register"]'),null);
  assert.equal(h.calls.cms,0);
 }finally{h.dom.window.close();}
});

test('staff entry opens content management for an authorized editor',async()=>{
 const h=await portal({access:'staff',caps:{read:true,edit:true,role:'editor'}});
 try{
  await h.settle();
  assert.equal(h.calls.cms,1);
  assert.equal(h.w.document.querySelector('[data-collection="media"]').getAttribute('aria-label'),'Media Library');
  h.w.document.querySelector('#portal-language').click();
  assert.equal(h.w.document.querySelector('[data-collection="media"]').getAttribute('aria-label'),'Thư viện tư liệu');
  assert.match(h.w.document.querySelector('#workspace-view').textContent,/Private CMS workspace/);
  assert.ok(visible(h.w.document.querySelector('#portal-access')));
  assert.equal(h.calls.applications,0);
  assert.equal(h.calls.rpc.includes('jobs_staff_directory'),false);
 }finally{h.dom.window.close();}
});

test('staff entry opens recruitment for a recruiter without CMS permission',async()=>{
 const h=await portal({access:'staff',caps:{recruit:true,role:'recruiter'}});
 try{
  await h.settle();
  assert.equal(h.w.document.querySelector('[data-view="applications"] .jobs-nav-label').textContent,'Recruitment');
  assert.match(h.w.document.querySelector('#workspace-view').textContent,/Recruitment workspace/);
  assert.equal(h.calls.cms,0);
  assert.equal(h.calls.applications,1);
  assert.ok(h.calls.rpc.includes('jobs_staff_directory'));
  h.w.document.querySelector('#portal-language').click();
  await h.settle();
  assert.equal(h.w.document.querySelector('[data-view="applications"] .jobs-nav-label').textContent,'Tuyển dụng');
  assert.match(h.w.document.querySelector('#workspace-view').textContent,/Không gian tuyển dụng/);
 }finally{h.dom.window.close();}
});

test('existing CMS, recruitment and staff-management deep links infer staff entry',async()=>{
 for(const view of ['cms','applications','staff']){
  const h=await portal({view,user:null});
  try{
   await h.settle();
   assert.match(h.w.document.querySelector('#auth-panel').textContent,/Staff sign in/);
   assert.equal(h.w.document.querySelector('#auth-panel [data-action="register"]'),null);
  }finally{h.dom.window.close();}
 }
});

test('an account without Jobs membership receives an explicit staff-access state',async()=>{
 const h=await portal({access:'staff',caps:{read:false,recruit:false,role:null}});
 try{
  await h.settle();
  assert.match(text(h),/Staff access not assigned/);
  assert.ok(visible(h.w.document.querySelector('#workspace-view [data-action="retry"]')));
  assert.equal(h.calls.cms,0);
  assert.equal(h.calls.applications,0);
  assert.equal(h.calls.rpc.includes('jobs_staff_directory'),false);
  assert.ok(visible(h.w.document.querySelector('#portal-access')));
 }finally{h.dom.window.close();}
});

test('candidate with no applications receives useful next steps',async()=>{
 const h=await portal({access:'candidate'});
 try{
  await h.settle();
  const workspace=h.w.document.querySelector('#workspace-view');
  assert.match(workspace.textContent,/no applications yet/i);
  const links=[...workspace.querySelectorAll('a')].map(a=>new URL(a.href));
  assert.ok(links.some(url=>url.pathname==='/'&&url.hash==='#opportunities'));
  assert.ok(links.some(url=>url.pathname==='/portal.html'&&url.searchParams.get('view')==='apply'));
  assert.equal(h.calls.cms,0);
 }finally{h.dom.window.close();}
});

test('startup displays session checking and clears it after completion',async()=>{
 let resolveUser;
 const pending=new Promise(resolve=>{resolveUser=resolve;});
 const h=await portal({getUser:()=>pending});
 try{
  const loading=h.w.document.querySelector('#portal-loading');
  assert.ok(visible(loading));
  assert.match(loading.textContent,/Checking your session/);
  resolveUser({data:{user:candidate}});
  await h.settle();
  assert.equal(visible(h.w.document.querySelector('#portal-loading')),false);
  assert.match(h.w.document.querySelector('#workspace-view').textContent,/My applications/);
 }finally{h.dom.window.close();}
});

test('rejected session validation displays a retry instead of a blank page',async()=>{
 const h=await portal({getUser:()=>Promise.reject(new Error('Network unavailable'))});
 try{
  await h.settle();
  const retry=h.w.document.querySelector('#portal-retry');
  assert.ok(visible(retry));
  assert.equal(retry.tagName,'BUTTON');
  assert.equal(visible(h.w.document.querySelector('#portal-loading')),false);
  assert.match(text(h),/try again|retry|connection/i);
 }finally{h.dom.window.close();}
});

test('a stalled session request exits loading with a retry and can recover',async()=>{
 const h=await portal({fastTimeout:true,getUser:count=>count===1?new Promise(()=>{}):Promise.resolve({data:{user:candidate}})});
 try{
  await pause(65);
  const retry=h.w.document.querySelector('#portal-retry');
  assert.ok(visible(retry));
  assert.equal(visible(h.w.document.querySelector('#portal-loading')),false);
  retry.click();await h.settle();
  assert.match(h.w.document.querySelector('#workspace-view').textContent,/My applications/);
  assert.ok(h.calls.users>=2);
 }finally{h.dom.window.close();}
});

test('SIGNED_IN refreshes the portal after its synchronous auth callback returns',async()=>{
 const h=await portal({access:'staff',user:null,caps:{read:true,edit:true,role:'editor'}});
 try{
  await h.settle();
  const before=h.calls.users;
  const returned=h.emit('SIGNED_IN',candidate);
  assert.equal(returned,undefined,'Auth callback must not return an async task');
  assert.equal(h.calls.users,before,'Supabase calls are deferred outside the auth callback');
  await h.settle();
  assert.equal(h.calls.cms,1);
  assert.match(h.w.document.querySelector('#workspace-view').textContent,/Private CMS workspace/);
 }finally{h.dom.window.close();}
});

test('SIGNED_OUT promptly removes private workspace even if later validation stalls',async()=>{
 const h=await portal({access:'staff',caps:{read:true,edit:true,role:'editor'},getUser:(count,current)=>count===1?Promise.resolve({data:{user:current}}):new Promise(()=>{})});
 try{
  await h.settle();
  assert.equal(h.calls.cms,1);
  h.emit('SIGNED_OUT',null);
  await h.settle();
  assert.equal(h.w.document.querySelector('[data-private-content]'),null);
  assert.ok(h.calls.destroy>=1);
  assert.equal(h.w.document.querySelector('#workspace-view').textContent,'');
 }finally{h.dom.window.close();}
});

test('failed capability loading is distinguished from an account without membership',async()=>{
 const h=await portal({access:'staff',getCapabilities:()=>Promise.reject(new Error('Failed to fetch'))});
 try{
  await h.settle();
  const workspace=h.w.document.querySelector('#workspace-view');
  assert.match(workspace.textContent,/Staff access could not be checked/);
  assert.doesNotMatch(workspace.textContent,/Staff access not assigned/);
  assert.ok(visible(workspace.querySelector('[data-action="retry"]')));
  assert.equal(h.calls.cms,0);
  assert.equal(h.calls.applications,0);
 }finally{h.dom.window.close();}
});

test('same-user session events preserve a live CMS controller',async()=>{
 const h=await portal({access:'staff',caps:{read:true,edit:true,role:'editor'}});
 try{
  await h.settle();
  assert.equal(h.calls.cms,1);
  const privateContent=h.w.document.querySelector('[data-private-content]');
  const requests=h.calls.users;
  h.emit('SIGNED_IN',candidate);h.emit('TOKEN_REFRESHED',candidate);
  await h.settle();
  assert.equal(h.calls.cms,1);
  assert.equal(h.calls.destroy,0);
  assert.equal(h.calls.users,requests);
  assert.equal(h.w.document.querySelector('[data-private-content]'),privateContent);
 }finally{h.dom.window.close();}
});

test('existing short passwords may sign in while new candidate passwords require 12 characters',async()=>{
 const h=await portal({access:'candidate',user:null});
 try{
  await h.settle();
  const form=h.w.document.querySelector('#auth-form');
  form.elements.email.value=candidate.email;form.elements.password.value='old-pass';
  assert.equal(form.elements.password.getAttribute('minlength'),null);
  assert.equal(form.checkValidity(),true);
  form.querySelector('[data-action="register"]').click();
  await h.settle();
  assert.equal(h.calls.registrations.length,0);
  assert.match(h.w.document.querySelector('#portal-status').textContent,/at least 12 characters/);
  form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));
  await h.settle();
  assert.equal(h.calls.signIns.length,1);
  assert.equal(h.calls.signIns[0].password,'old-pass');
  assert.match(h.w.document.querySelector('#workspace-view').textContent,/My applications/);
 }finally{h.dom.window.close();}
});

test('password recovery enforces the new-password length requirement',async()=>{
 const h=await portal({user:null});
 try{
  await h.settle();h.emit('PASSWORD_RECOVERY',candidate);
  const password=h.w.document.querySelector('#auth-form input[name="password"]');
  assert.equal(password.autocomplete,'new-password');
  assert.equal(password.minLength,12);
  password.value='short';assert.equal(password.value.length<password.minLength,true);
 }finally{h.dom.window.close();}
});

test('switching portal access preserves vacancy, unrelated query parameters and hash',async()=>{
 const h=await portal({access:'candidate',user:null,view:'apply',query:'vacancy=vacancy-one&utm_source=email&tracking=keep',hash:'#application'});
 try{
  await h.settle();
  h.w.document.querySelector('#portal-access [data-access="staff"]').click();
  await h.settle();
  let current=new URL(h.w.location.href);
  assert.equal(current.searchParams.get('access'),'staff');
  assert.equal(current.searchParams.get('vacancy'),'vacancy-one');
  assert.equal(current.searchParams.get('utm_source'),'email');
  assert.equal(current.searchParams.get('tracking'),'keep');
  assert.equal(current.hash,'#application');
  h.w.document.querySelector('#portal-access [data-access="candidate"]').click();
  await h.settle();
  current=new URL(h.w.location.href);
  assert.equal(current.searchParams.get('access'),'candidate');
  assert.equal(current.searchParams.get('vacancy'),'vacancy-one');
  assert.equal(current.searchParams.get('utm_source'),'email');
  assert.equal(current.hash,'#application');
 }finally{h.dom.window.close();}
});

test('a recruiter using the candidate portal lists only their own applications',async()=>{
 const h=await portal({access:'candidate',caps:{read:true,recruit:true,role:'admin'}});
 try{
  await h.settle();
  assert.equal(h.calls.cms,0);
  assert.equal(h.calls.rpc.includes('jobs_staff_directory'),false);
  assert.equal(h.calls.applicationOptions.length,1);
  assert.equal(h.calls.applicationOptions[0].candidateId,candidate.id);
  assert.equal(h.calls.applicationOptions[0].page,1);
  assert.match(h.w.document.querySelector('#workspace-view').textContent,/My applications/);
 }finally{h.dom.window.close();}
});

test('password sign-in and its auth event do not replace the newly opened CMS',async()=>{
 const h=await portal({access:'staff',user:null,caps:{read:true,edit:true,role:'editor'},emitOnSignIn:true});
 try{
  await h.settle();
  const form=h.w.document.querySelector('#auth-form');
  form.elements.email.value=candidate.email;form.elements.password.value='existing-password';
  form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));
  await h.settle();
  assert.equal(h.calls.cms,1,'The sign-in event must not duplicate explicit session initialization');
  assert.equal(h.calls.destroy,0,'A newly opened editor must not be destroyed by the queued sign-in event');
 }finally{h.dom.window.close();}
});

test('Vietnamese portal translates candidate, staff, session and empty states',async()=>{
 const h=await portal({access:'candidate'});
 try{
  await h.settle();h.w.document.querySelector('#portal-language').click();
  await h.settle();
  assert.equal(h.w.document.documentElement.lang,'vi');
  assert.match(h.w.document.title,/Cổng ứng viên/);
  assert.match(h.w.document.querySelector('#workspace-view').textContent,/Bạn chưa có hồ sơ ứng tuyển/);
  assert.match(h.w.document.querySelector('#account-summary').textContent,/Đã đăng nhập bằng/);
  assert.match(h.w.document.querySelector('#sign-out').textContent,/Đăng xuất/);
  h.w.document.querySelector('[data-action="access"][data-access="staff"]').click();await h.settle();
  assert.match(h.w.document.title,/Cổng nhân viên/);
  assert.match(h.w.document.querySelector('#workspace-view').textContent,/Chưa được cấp quyền nhân viên/);
  h.w.document.querySelector('#sign-out').click();await h.settle();
  assert.match(h.w.document.querySelector('#auth-panel').textContent,/Đăng nhập nhân viên/);
  assert.equal(h.w.document.querySelector('#auth-panel [data-action="register"]'),null);
 }finally{h.dom.window.close();}
});
