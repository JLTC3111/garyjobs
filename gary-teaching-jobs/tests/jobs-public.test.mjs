import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {bindFeedbackDom} from './helpers/feedback-dom.mjs';
import {vacancyCard,vacancyPath,vacancySlug,escapeText,safeLink} from '../dist/jobs-public-content.js';
import * as jobsSeo from '../dist/jobs-seo.js';
import {mountJobsPublicAccount} from '../dist/jobs-public-account.js';
import {createVacancyHandler} from '../api/vacancy.js';
const records=[{id:'employer',kind:'employer',slug:'school',title_en:'School',title_vi:'Trường',summary_en:'A school',summary_vi:'Một trường'},{id:'location',kind:'location',slug:'hanoi',title_en:'Hanoi',title_vi:'Hà Nội'},{id:'category',kind:'category',slug:'public',title_en:'Public schools',title_vi:'Trường công'},{id:'10000000-0000-4000-8000-000000000001',kind:'vacancy',slug:'teacher',title_en:'New teacher vacancy',title_vi:'Tuyển giáo viên mới',summary_en:'A current teaching vacancy',summary_vi:'Tin tuyển dụng đang mở',body_en:'Details of this current role',body_vi:'Thông tin vị trí hiện tại',published_at:'2026-11-13T00:00:00Z',data:{location_slug:'hanoi',category_slug:'public',employer_slug:'school',hours:60,benefits_en:'Support',benefits_vi:'Hỗ trợ',contact_email:'jobs@example.test',requirements_en:'Degree',requirements_vi:'Bằng cấp'}}];
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
const signedInUser={id:'jobs-user',email:'teacher@example.test',user_metadata:{full_name:'Teacher One'}};
function signedInAuth(user=signedInUser){
 return{
  onAuthStateChange(callback){callback('INITIAL_SESSION',{user});return{data:{subscription:{unsubscribe(){}}}};},
  getUser:async()=>({data:{user},error:null}),
  signOut:async()=>({error:null}),
 };
}
async function publicPage(result,{url='https://jobs.garyhome.vn/',auth={onAuthStateChange:callback=>callback('INITIAL_SESSION',null)},loadCapabilities=async()=>({}),reducedMotion=false,storedStyle,loadCatalogue,shell}={}){
 const dom=new JSDOM(shell??await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),{url,runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 if(storedStyle!==undefined)w.localStorage.setItem('gary-jobs-vacancy-style',JSON.stringify(storedStyle));
  bindFeedbackDom(dom.window);
w.IntersectionObserver=class{observe(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};w.matchMedia=media=>({matches:reducedMotion&&media.includes("prefers-reduced-motion"),addEventListener(){},removeEventListener(){}});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){if(this.open){this.open=false;this.dispatchEvent(new w.Event('close'));}};
 w.mountGaryApps=()=>({unmount(){}});w.mountPhotoGallery=()=>({unmount(){}});w.mountGlassHero=()=>({unmount(){},update(){}});Object.assign(w,jobsSeo);
 w.vacancyCard=vacancyCard;w.vacancySlug=vacancySlug;w.escapeText=escapeText;w.safeLink=safeLink;w.publicContent=loadCatalogue||(()=>result instanceof Error?Promise.reject(result):Promise.resolve(result));
 const source=(await readFile(new URL('../dist/app.js',import.meta.url),'utf8')).split('\n').filter(l=>!l.startsWith('import ')).join('\n');
 vm.runInContext(source,dom.getInternalVMContext());
 mountJobsPublicAccount(w.document,auth,loadCapabilities);
 await settle();return dom;
}
test('published vacancies and managed categories/locations survive filter changes',async()=>{
 const dom=await publicPage(records);try{const d=dom.window.document;assert.match(d.querySelector('#job-grid').textContent,/New teacher vacancy/);assert.doesNotMatch(d.querySelector('#job-grid').textContent,/Bắc Giang/);assert.match(d.querySelector('#location').textContent,/Hanoi/);d.querySelector('[data-action="filter"][data-id="public"]').click();assert.match(d.querySelector('#job-grid').textContent,/New teacher vacancy/);assert.equal(d.querySelectorAll('[data-action="filter"][data-id="public"]').length,1);assert.equal(d.querySelectorAll('.jobs-live-note').length,0);}finally{dom.window.close();}
});
test('signed-in visitors see the vacancies guidance above the card grid with natural copy',async()=>{
 const dom=await publicPage(records,{auth:signedInAuth()});
 try{
  const d=dom.window.document;
  const note=d.querySelector('.jobs-live-note');
  assert.ok(note);
  assert.equal(note.nextElementSibling?.id,'job-grid');
  assert.match(note.textContent,/application deadline/);
  assert.match(note.textContent,/Candidate Portal/);
  d.querySelector('[data-language="vi"]').click();
  assert.match(d.querySelector('.jobs-live-note').textContent,/Các tin tuyển dụng được hiển thị đến hạn nhận hồ sơ/);
  assert.match(d.querySelector('.jobs-live-note').textContent,/Cổng ứng viên/);
 }finally{dom.window.close();}
});
test('vacancies guidance hides for anonymous visitors and after sign-out without flashing while auth loads',async()=>{
 const user=signedInUser;
 let notify,releaseIdentity;
 const restoring=new Promise(resolve=>{releaseIdentity=resolve;});
 const auth={
  onAuthStateChange(callback){notify=callback;callback('INITIAL_SESSION',{user});},
  getUser(){return restoring;},
  signOut:async()=>({error:null}),
 };
 const dom=await publicPage(records,{auth,loadCapabilities:async()=>({})});
 try{
  const d=dom.window.document;
  assert.equal(d.querySelectorAll('.jobs-live-note').length,0,'no banner while session is still verifying');
  releaseIdentity({data:{user},error:null});
  await settle();
  assert.ok(d.querySelector('.jobs-live-note'));
  assert.equal(d.querySelector('.jobs-live-note').nextElementSibling?.id,'job-grid');
  d.querySelector('#sign-out').click();
  await settle();
  notify('SIGNED_OUT',null);
  await settle();
  assert.equal(d.querySelectorAll('.jobs-live-note').length,0);
 }finally{dom.window.close();}
});
test('published vacancy cards keep the location, bookmark and optional image without a house badge',async()=>{
 const content=structuredClone(records),first=content[3];
 const image={id:'10000000-0000-4000-8000-000000000003',width:800,height:450,alt_en:'Classroom windows',alt_vi:'Cửa sổ lớp học'};
 first.data.vacancy_image=image;
 const second={...first,id:'10000000-0000-4000-8000-000000000002',slug:'language-teacher',title_en:'Language teacher',data:{...first.data,category_slug:'centers',vacancy_image:null}};
 content.push(second);
 const dom=await publicPage(content);
 try{
  const d=dom.window.document;
  const card=record=>d.querySelector(`#job-grid h3 a[href="/jobs/${record.slug}"]`).closest('.job-card');
  for(const record of [first,second]){
   const vacancy=card(record);
   assert.equal(vacancy.querySelector('h3 a').textContent,record.title_en);
   assert.equal(vacancy.querySelector('.job-card-top').children.length,2);
   assert.equal(vacancy.querySelector('.job-card-top .job-school-icon'),null);
   assert.ok(vacancy.querySelector('.job-card-top .job-location svg'));
   assert.ok(vacancy.querySelector('.job-card-top button[data-action="save"]'));
  }
  assert.equal(card(second).querySelector('img'),null);
  assert.equal(card(first).querySelector('img').alt,image.alt_en);
  d.querySelector('[data-language="vi"]').click();
  assert.equal(card(first).querySelector('img').alt,image.alt_vi);
 }finally{dom.window.close();}
});
test('anonymous, candidate and staff public pages show only current catalogue cards and featured guides',async t=>{
 for(const [name,options] of [
  ['anonymous',{}],
  ['candidate',{auth:signedInAuth()}],
  ['staff',{auth:signedInAuth(),loadCapabilities:async()=>({read:true,role:'editor'})}],
 ])await t.test(name,async()=>{
  let read,load=new Promise(resolve=>{read=resolve;});
  const dom=await publicPage(null,{...options,loadCatalogue:()=>load});
  try{
   const {window:w}=dom,d=w.document;
   const grid=()=>d.querySelector('#job-grid');
   const search=keyword=>{
    const form=d.querySelector('#job-search');
    form.elements.keyword.value=keyword;
    form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
   };
   assert.match(grid().textContent,/Loading vacancies/);
   assert.equal(grid().querySelectorAll('.job-card').length,0);
   assert.doesNotMatch(grid().textContent,/Bắc Giang/);

   const publishedGuide={kind:'guide',slug:'welcome-guide',title_en:'Published teaching guide'};
   read([...records,publishedGuide]);
   await settle();
   assert.match(grid().textContent,/New teacher vacancy/);
   assert.match(d.querySelector('#published-guides').textContent,/Published teaching guide/);
   search('Hải Phòng');
   assert.equal(grid().querySelectorAll('.job-card').length,0);
   search('New teacher');
   assert.equal(grid().querySelectorAll('.job-card').length,1);

   const refresh=()=>w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));
   load=Promise.reject(new Error('offline'));
   refresh();
   await settle();
   assert.match(grid().textContent,/temporarily unavailable/);
   assert.equal(grid().querySelectorAll('.job-card').length,0);
   assert.equal(d.querySelector('#published-guides'),null);
   assert.doesNotMatch(grid().textContent,/Bắc Giang/);

   load=Promise.resolve([]);
   grid().querySelector('[data-action="retry-catalogue"]').click();
   await settle();
   assert.equal(grid().querySelectorAll('.job-card').length,0);
   assert.equal(d.querySelector('#published-guides'),null);
  }finally{dom.window.close();}
 });
});
test('missing backend remains an honest email fallback without a fake application receipt',async()=>{
 const dom=await publicPage(new Error('not provisioned'));try{const d=dom.window.document;assert.equal(d.querySelectorAll('.jobs-live-note').length,0);d.querySelector('[data-action="apply"]').click();assert.match(d.querySelector('#application-form').textContent,/Nothing is submitted/);assert.equal(d.querySelector('[data-action="copy-email"]'),null);}finally{dom.window.close();}
});
test('signed-in visitors see the offline vacancies note when the catalogue is unavailable',async()=>{
 const dom=await publicPage(new Error('not provisioned'),{auth:signedInAuth()});
 try{
  const d=dom.window.document;
  assert.equal(d.querySelectorAll('.jobs-live-note').length,1);
  assert.match(d.querySelector('.jobs-live-note').textContent,/temporarily unavailable/);
  assert.equal(d.querySelector('.jobs-live-note').nextElementSibling?.id,'job-grid');
 }finally{dom.window.close();}
});
test('public desktop and mobile navigation distinguish candidate and staff login in both languages',async()=>{
 const dom=await publicPage(records);
 try{
  const d=dom.window.document;
  for(const [language,candidate,staff] of [['en','Candidate login','Staff login'],['vi','Đăng nhập ứng viên','Đăng nhập nhân viên']]){
   if(language==='vi')d.querySelector('[data-language="vi"]').click();
   const root=d.querySelector('.nav-actions #public-account');
   assert.equal(root.querySelector('a[href="portal.html?access=candidate"]').textContent,candidate);
   assert.equal(root.querySelector('a[href="portal.html?access=staff"]').textContent,staff);
   assert.equal(d.querySelector('#mobile-nav a[href^="portal.html"]'),null);
  }
 }finally{dom.window.close();}
});
test('public account restores verified dual access and removes revoked staff links without a reload',async()=>{
 const user={id:'jobs-user',email:'teacher@example.test',user_metadata:{full_name:'Teacher <One>',role:'admin'}};
 let notify,finishIdentity,users=0,caps={read:true,role:'editor'};
 const restoring=new Promise(resolve=>{finishIdentity=resolve;});
 const auth={
  onAuthStateChange(callback){notify=callback;callback('INITIAL_SESSION',{user});},
  getUser(){users++;return restoring;},
 };
 const dom=await publicPage(records,{auth,loadCapabilities:async()=>caps});
 try{
  const {document:d}=dom.window,menu=d.getElementById('public-account');
  const trigger=menu.querySelector('summary');
  assert.equal(trigger.getAttribute('aria-disabled'),'true');
  assert.equal(menu.querySelector('a'),null);
  finishIdentity({data:{user}});await settle();
  assert.equal(trigger.title,'Account Dashboard');
  assert.equal(trigger.getAttribute('aria-label'),trigger.title);
  assert.equal(trigger.querySelector('.jobs-account-trigger-label').textContent,'Account');
  assert.equal(trigger.querySelector('.jobs-account-avatar').textContent,'T<');
  assert.equal(menu.querySelector('strong').textContent,'Teacher <One>');
  assert.equal(menu.querySelector('small').textContent,user.email);
  assert.match(menu.textContent,/Staff · Editor/);
  assert.doesNotMatch(menu.textContent,/Admin/);
  assert.equal(menu.querySelector('a[href="portal.html?access=staff"] > .jobs-account-item-label').textContent,'Staff Dashboard');
  assert.equal(menu.querySelector('a[href="portal.html?access=candidate"]').textContent,'Candidate Dashboard');
  const signout=menu.querySelector('#sign-out');
  assert.equal(signout.nextElementSibling,d.getElementById(signout.getAttribute('aria-describedby')));
  assert.equal(signout.nextElementSibling.textContent,'End your session on this website.');
  d.querySelector('[data-language=vi]').click();
  assert.equal(d.getElementById('public-account'),menu);
  assert.equal(trigger.title,'Bảng điều khiển tài khoản');
  assert.equal(trigger.getAttribute('aria-label'),trigger.title);
  assert.equal(trigger.querySelector('.jobs-account-trigger-label').textContent,'Tài khoản');
  assert.match(menu.textContent,/Bảng điều khiển nhân viên/);
  assert.match(menu.textContent,/Bảng điều khiển ứng viên/);
  assert.equal(menu.querySelector('#sign-out + p').textContent,'Kết thúc phiên đăng nhập trên trang web này.');
  assert.equal(users,1);
  menu.open=true;
  menu.querySelector('a').focus();
  menu.querySelector('a').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(menu.open,false);
  assert.equal(d.activeElement,menu.querySelector('summary'));
  caps={read:false,recruit:false,role:null};
  notify('TOKEN_REFRESHED',{user});await settle();
  assert.equal(menu.querySelector('a[href="portal.html?access=staff"]'),null);
  assert.match(menu.textContent,/Bảng điều khiển ứng viên/);
 }finally{dom.window.close();}
});
test('public account rechecks a restored page and signs out after backend confirmation',async()=>{
 const user={id:'jobs-user',email:'candidate@example.test'};
 let signedIn=false,finishSignOut;
 const auth={
  onAuthStateChange:callback=>callback('INITIAL_SESSION',null),
  getUser:async()=>({data:{user:signedIn?user:null}}),
  signOut(options){
   assert.equal(options.scope,'local');
   return new Promise(resolve=>{finishSignOut=resolve;});
  },
 };
 const dom=await publicPage(records,{auth});
 try{
  const w=dom.window,menu=w.document.getElementById('public-account');
  assert.equal(menu.querySelector('summary').title,'Account sign-in');
  assert.equal(menu.querySelector('summary .jobs-account-trigger-label').textContent,'Account');
  assert.ok(menu.querySelector('summary .jobs-account-avatar svg[aria-hidden=true]'));
  signedIn=true;
  w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));
  assert.equal(menu.querySelector('a'),null);
  await settle();
  assert.match(menu.textContent,/Candidate Dashboard/);
  assert.equal(menu.querySelectorAll('a').length,1);
  menu.querySelector('#sign-out').click();
  assert.equal(menu.querySelector('#sign-out').disabled,true);
  assert.match(menu.textContent,/Candidate Dashboard/);
  finishSignOut({});await settle();
  assert.equal(menu.querySelector('#sign-out'),null);
  assert.match(menu.textContent,/Candidate login/);
  assert.match(menu.textContent,/Staff login/);
 }finally{dom.window.close();}
});
test('public account ignores permission results from a session signed out during verification',async()=>{
 const user={id:'jobs-user',email:'staff@example.test'};
 let notify,finishCapabilities;
 const permissions=new Promise(resolve=>{finishCapabilities=resolve;});
 const auth={
  onAuthStateChange(callback){notify=callback;callback('INITIAL_SESSION',{user});},
  getUser:async()=>({data:{user}}),
 };
 const dom=await publicPage(records,{auth,loadCapabilities:()=>permissions});
 try{
  const menu=dom.window.document.getElementById('public-account');
  assert.equal(menu.querySelector('a'),null);
  notify('SIGNED_OUT',null);
  finishCapabilities({read:true,role:'admin'});await settle();
  assert.match(menu.textContent,/Staff login/);
  assert.doesNotMatch(menu.textContent,/Dashboard|Admin|staff@example/);
 }finally{dom.window.close();}
});
test('CMS text cannot inject markup or unsafe source protocols into public vacancy cards',()=>{
 const card=vacancyCard({...records[3],title_en:'<img src=x onerror=alert(1)>',data:{...records[3].data,source_url:'javascript:alert(1)',requirements_en:'<script>bad()</script>'}},0,records,'en');
 assert.ok(card.title[0].startsWith('&lt;img'));assert.equal(card.source,'#opportunities');assert.ok(card.requirements[0][0].includes('&lt;script&gt;'));assert.equal(safeLink('https://example.org/jobs'),'https://example.org/jobs');assert.equal(safeLink('data:text/html,bad'),'');
});
test('vacancy images render on cards and detail routes with localized alt and no school glyph',async()=>{
 const content=structuredClone(records), id='11000000-0000-4000-8000-000000000001';
 content[3].data.vacancy_image={id,width:1120,height:740,alt_en:'Classroom "A"',alt_vi:'Lớp học A'};
 const dom=await publicPage(content);
 try{
  const d=dom.window.document, card=d.querySelector('.job-card'), photo=card.querySelector('.vacancy-photo img');
  assert.equal(photo.alt,'Classroom "A"');
  assert.equal(photo.getAttribute('loading'),'lazy');
  assert.equal(photo.width,1120);
  assert.equal(photo.height,740);
  assert.match(photo.src,new RegExp('/functions/v1/jobs-vacancy-image\\?image='+id+'$'));
  assert.equal(d.querySelector('.job-school-icon'),null);
  d.querySelector('[data-language="vi"]').click();
  assert.equal(d.querySelector('.job-card img').alt,'Lớp học A');
  d.querySelector('.job-card h3 a').click();
  await settle();
  const detail=d.querySelector('#detail-dialog .vacancy-photo img');
  assert.equal(detail.alt,'Lớp học A');
  assert.equal(detail.src,photo.src);
  detail.dispatchEvent(new dom.window.Event('error'));
  assert.equal(detail.closest('.vacancy-photo').hidden,true);
 }finally{dom.window.close();}
 const invalid=vacancyCard({...content[3],data:{...content[3].data,vacancy_image:{...content[3].data.vacancy_image,id:'javascript:alert(1)'}}},0,content);
 assert.equal(invalid.image,null);
 const fallback=await publicPage(records);
 try{
  const card=fallback.window.document.querySelector('.job-card');
  assert.equal(card.querySelector('.vacancy-photo, .job-school-icon'),null);
  assert.match(card.querySelector('h3').textContent,/New teacher vacancy/);
 }finally{fallback.window.close();}
});
test('a job-card photo opens that vacancy gallery and does not step into another job',async()=>{
 const content=structuredClone(records);
 const first={id:'11000000-0000-4000-8000-000000000011',width:1120,height:740,alt_en:'Classroom "A"',alt_vi:'Lớp học A',cover:false};
 const second={id:'11000000-0000-4000-8000-000000000012',width:800,height:1200,alt_en:'School gate',alt_vi:'Cổng trường',cover:true};
 const other={id:'11000000-0000-4000-8000-000000000014',width:640,height:480,alt_en:'Other campus',alt_vi:'Cơ sở khác',cover:true};
 content[3].data.vacancy_images=[first,second];
 content.push({...content[3],id:'10000000-0000-4000-8000-000000000002',slug:'language-teacher',title_en:'Language teacher',title_vi:'Giáo viên ngôn ngữ',data:{...content[3].data,vacancy_images:[other]}});
 const dom=await publicPage(content);
 try{
  const d=dom.window.document, w=dom.window;
  const cards=[...d.querySelectorAll('.job-card')];
  assert.equal(cards[0].querySelector('.vacancy-photo-count').textContent,'2');
  assert.equal(cards[1].querySelector('.vacancy-photo-count'),null);
  assert.match(cards[0].querySelector('.vacancy-photo img').src,/000000000012$/);
  const opener=cards[0].querySelector('[data-action="vacancy-gallery"]');
  assert.match(opener.getAttribute('aria-label'),/View 2 photos/);
  opener.click();
  const gallery=d.querySelector('#vacancy-gallery');
  assert.equal(gallery.open,true);
  assert.equal(d.querySelector('#detail-dialog').open,false);
  const photo=gallery.querySelector('.vacancy-gallery-photo');
  assert.equal(photo.alt,'School gate');
  assert.match(photo.src,/000000000012$/);
  assert.equal(photo.getAttribute('width'),'800');
  assert.equal(gallery.querySelector('.vacancy-gallery-caption').textContent,'New teacher vacancy · Hanoi');
  assert.equal(gallery.querySelector('#vacancy-gallery-status').textContent,'1 of 2');
  gallery.querySelector('[data-action="vacancy-gallery-step"][data-id="1"]').click();
  assert.equal(photo.alt,'Classroom "A"');
  assert.match(photo.src,/000000000011$/);
  assert.equal(gallery.querySelector('#vacancy-gallery-status').textContent,'2 of 2');
  d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(photo.alt,'School gate');
  const pointer=(type,x,y)=>{const event=new w.Event(type,{bubbles:true});Object.defineProperties(event,{clientX:{value:x},clientY:{value:y}});return event;};
  const stage=gallery.querySelector('.vacancy-gallery-stage');
  stage.dispatchEvent(pointer('pointerdown',240,80));
  stage.dispatchEvent(pointer('pointerup',40,84));
  assert.equal(photo.alt,'Classroom "A"');
  d.querySelector('[data-language="vi"]').click();
  assert.equal(d.querySelector('#vacancy-gallery .vacancy-gallery-photo').alt,'Lớp học A');
  assert.equal(d.querySelector('#vacancy-gallery-status').textContent,'2 / 2');
  assert.equal(d.querySelector('[data-action="vacancy-gallery-step"][data-id="-1"]').getAttribute('aria-label'),'Ảnh trước');
  d.querySelector('[data-action="close-vacancy-gallery"]').click();
  assert.equal(d.querySelector('#vacancy-gallery').open,false);
  assert.equal(d.activeElement,d.querySelector('[data-action="vacancy-gallery"][data-id="10000000-0000-4000-8000-000000000001"]'));
  d.querySelector('.job-card h3 a').click();
  await settle();
  d.querySelector('#detail-dialog [data-action="vacancy-gallery"]').click();
  assert.equal(d.querySelector('#vacancy-gallery').open,true);
  assert.equal(d.querySelector('#vacancy-gallery .vacancy-gallery-photo').alt,'Cổng trường');
 }finally{dom.window.close();}
 const single=structuredClone(records);
 single[3].data.vacancy_image={id:'11000000-0000-4000-8000-000000000013',width:640,height:480,alt_en:'One classroom',alt_vi:'Một lớp học'};
 const alone=await publicPage(single);
 try{
  const d=alone.window.document;
  d.querySelector('[data-action="vacancy-gallery"]').click();
  assert.equal(d.querySelector('[data-action="vacancy-gallery-step"][data-id="1"]').hidden,true);
  const src=d.querySelector('.vacancy-gallery-photo').src;
  d.dispatchEvent(new alone.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
  assert.equal(d.querySelector('.vacancy-gallery-photo').src,src);
 }finally{alone.window.close();}
});
test('published salary and employer profile fields are visible and translate on the public site',async()=>{
 const content=structuredClone(records);
 Object.assign(content[0],{body_en:'Our teaching team supports new colleagues.',body_vi:'Đội ngũ giảng dạy hỗ trợ đồng nghiệp mới.',data:{website:'https://employer.example.test/',logo_url:'https://images.example.test/school.png'}});
 Object.assign(content[3].data,{salary_en:'USD 2,000 per month',salary_vi:'2.000 USD mỗi tháng'});
 const dom=await publicPage(content);
 try{
  const d=dom.window.document;
  assert.match(d.querySelector('#job-grid').textContent,/USD 2,000 per month/);
  d.querySelector('[data-action="job"]').click();await settle();assert.match(d.querySelector('#detail-dialog').textContent,/USD 2,000 per month/);
  assert.match(d.querySelector('#published-guides').textContent,/Our teaching team supports new colleagues/);
  assert.equal(d.querySelector('#published-guides a').href,'https://employer.example.test/');
  assert.equal(d.querySelector('#published-guides img').alt,'School');
  d.querySelector('[data-language="vi"]').click();
  assert.match(d.querySelector('#job-grid').textContent,/2\.000 USD mỗi tháng/);
  assert.match(d.querySelector('#published-guides').textContent,/Đội ngũ giảng dạy hỗ trợ đồng nghiệp mới/);
 }finally{dom.window.close();}
});
test('employer links and logos reject executable and credential-bearing addresses',async()=>{
 const content=structuredClone(records);content[0].data={website:'javascript:alert(1)',logo_url:'https://name:password@images.example.test/school.png'};
 const dom=await publicPage(content);
 try{assert.equal(dom.window.document.querySelector('#published-guides a'),null);assert.equal(dom.window.document.querySelector('#published-guides img'),null);assert.equal(safeLink('https://name:password@example.test/'),'');}finally{dom.window.close();}
});

test('published vacancies have stable real links derived from the stored title slug',async()=>{
 const content=structuredClone(records);content[3].slug='english-teacher-hanoi-2';content[3].title_en='English teacher: Hanoi / Full-time!';
 const card=vacancyCard(content[3],0,content);
 assert.equal(card.url,'/jobs/english-teacher-hanoi-2');
 assert.equal(vacancyCard({...content[3],title_en:'An edited published title'},0,content).url,card.url);
 assert.equal(vacancyPath('../portal.html'),'');assert.equal(vacancyPath('javascript:alert(1)'),'');assert.equal(vacancyPath('a'.repeat(181)),'');
 assert.equal(vacancySlug('/jobs/english-teacher-hanoi-2'),'english-teacher-hanoi-2');assert.equal(vacancySlug('/jobs/foo/bar'),null);
 const dom=await publicPage(content);
 try{
  const d=dom.window.document,link=d.querySelector('#job-grid h3 a');
  assert.equal(link.href,'https://jobs.garyhome.vn/jobs/english-teacher-hanoi-2');
  assert.equal(d.querySelector('#job-grid .round-arrow').getAttribute('href'),'/jobs/english-teacher-hanoi-2');
  link.click();assert.equal(dom.window.location.pathname,'/jobs/english-teacher-hanoi-2');assert.equal(d.querySelector('#detail-dialog').open,true);
  await settle();
  assert.match(d.querySelector('#dialog-title').textContent,/English teacher: Hanoi \/ Full-time!/);
 }finally{dom.window.close();}
});

test('direct vacancy URLs wait for published data and reopen on refresh with root assets',async()=>{
 let resolveContent;const pending=new Promise(resolve=>{resolveContent=resolve;});
 const dom=await publicPage(pending,{url:'https://jobs.garyhome.vn/jobs/teacher?utm_source=test'});
 try{
  const d=dom.window.document;
  assert.match(d.querySelector('#dialog-title').textContent,/Loading vacancy/);
  assert.equal(d.querySelector('script[src="app.js"]').src,'https://jobs.garyhome.vn/app.js');
  assert.equal(d.querySelector('link[rel="stylesheet"]').href,'https://jobs.garyhome.vn/styles.css');
  assert.equal(d.querySelector('.jobs-login-options a').href,'https://jobs.garyhome.vn/portal.html?access=candidate');
  resolveContent(records);await settle();
  assert.match(d.querySelector('#dialog-title').textContent,/New teacher vacancy/);
  assert.equal(dom.window.location.pathname,'/jobs/teacher');
  assert.match(d.title,/New teacher vacancy/);
  assert.equal(d.querySelector('link[rel="canonical"]').href,'https://jobs.garyhome.vn/jobs/teacher');
  assert.equal(d.querySelector('meta[name="description"]').content,'A current teaching vacancy');
 }finally{dom.window.close();}
 const refreshed=await publicPage(records,{url:'https://jobs.garyhome.vn/jobs/teacher'});
 try{assert.match(refreshed.window.document.querySelector('#dialog-title').textContent,/New teacher vacancy/);}finally{refreshed.window.close();}
});

test('vacancy browser back, forward and close restore listings and selected role',async()=>{
 const dom=await publicPage(records,{url:'https://jobs.garyhome.vn/?utm_source=test#opportunities'});
 try{
  const w=dom.window,d=w.document;
  d.querySelector('#job-grid h3 a').click();
  assert.equal(w.location.pathname,'/jobs/teacher');assert.equal(w.location.search,'?utm_source=test');
  w.history.back();await settle();await settle();
  assert.equal(w.location.pathname,'/');assert.equal(w.location.hash,'#opportunities');assert.equal(d.querySelector('#detail-dialog').open,false);
  w.history.forward();await settle();await settle();
  assert.equal(w.location.pathname,'/jobs/teacher');assert.match(d.querySelector('#dialog-title').textContent,/New teacher vacancy/);
  d.querySelector('.dialog-close').click();await settle();await settle();
  assert.equal(w.location.pathname,'/');assert.equal(w.location.hash,'#opportunities');assert.equal(d.querySelector('#detail-dialog').open,false);
 }finally{dom.window.close();}
});

test('vacancy workspace searches published roles and keeps Back, Forward and return-to-listings usable',async()=>{
 const content=structuredClone(records);
 content[0].data={website:'https://school.example.test/'};
 content.push({...content[3],id:'10000000-0000-4000-8000-000000000002',slug:'science-teacher',title_en:'Science teacher',title_vi:'Giáo viên khoa học',body_en:'Teach laboratory safety.\n\nPlan practical classes.'});
 const dom=await publicPage(content,{url:'https://jobs.garyhome.vn/?utm_source=test#opportunities'});
 try{
  const w=dom.window,d=w.document;
  d.querySelector('#job-grid a[href="/jobs/teacher"]').click();
  await settle();
  assert.ok(d.querySelector('#detail-dialog.is-vacancy-workspace[open]'));
  assert.equal(d.querySelector('h1#dialog-title').textContent,'New teacher vacancy');
  const toggle=d.querySelector('.vacancy-browse-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'),'true');
  const search=d.querySelector('#vacancy-browse-search');
  search.value='giao vien khoa hoc';
  search.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(d.querySelector('.vacancy-result-status').textContent,'1 vacancy');
  const [result]=d.querySelectorAll('.vacancy-results a');
  assert.equal(result.getAttribute('href'),'/jobs/science-teacher');
  result.click();
  await settle();
  assert.equal(w.location.pathname,'/jobs/science-teacher');
  assert.equal(d.querySelector('.vacancy-results a').getAttribute('aria-current'),'page');
  assert.equal(d.querySelector('.vacancy-article .vacancy-copy').textContent,'Teach laboratory safety.\n\nPlan practical classes.');
  const apply=d.querySelector('.vacancy-sidebar a[href^="/portal.html"]').href;
  assert.equal(d.querySelector('.vacancy-mobile-apply a').href,apply);
  assert.equal(new URL(apply).searchParams.get('vacancy'),content.at(-1).id);
  assert.equal(d.querySelector('.vacancy-sidebar a[href^="https://school.example.test"]').target,'_blank');
  assert.equal(d.querySelector('.vacancy-workspace [data-action="publish"],.vacancy-workspace [data-action="edit"]'),null);
  w.history.back();await settle();await settle();
  assert.equal(w.location.pathname,'/jobs/teacher');
  w.history.forward();await settle();await settle();
  assert.equal(w.location.pathname,'/jobs/science-teacher');
  d.querySelector('.vacancy-workspace [data-action="vacancy-listings"]').click();await settle();await settle();
  assert.equal(w.location.href,'https://jobs.garyhome.vn/?utm_source=test#opportunities');
  assert.equal(d.querySelector('#detail-dialog').open,false);
 }finally{dom.window.close();}
});

function websitePreferences(document) {
 const panel=document.querySelector('#jobs-preferences-panel');
 if(panel.hidden)document.querySelector('#jobs-preferences-trigger').click();
 return panel;
}
function switchVacancyLanguage(document) {
 const next=document.documentElement.lang==='vi'?'en':'vi';
 websitePreferences(document).querySelector(`[data-language="${next}"]`).click();
}

test('vacancy workspace restores reading position across language changes and supports Share, Save and theme selection',async()=>{
 const dom=await publicPage(records,{url:'https://jobs.garyhome.vn/jobs/teacher?utm_source=test'});
 try{
  const w=dom.window,d=w.document;
  d.querySelector('.vacancy-reading').scrollTop=123;
  switchVacancyLanguage(d);
  assert.equal(d.querySelector('.vacancy-reading').scrollTop,123);
  assert.equal(d.querySelector('h1#dialog-title').textContent,'Tuyển giáo viên mới');
  const share=d.querySelector('[data-action="share-vacancy"]');
  share.click();
  const link=d.querySelector('.vacancy-share-link');
  assert.equal(link.hidden,false);
  assert.equal(link.querySelector('input').value,'https://jobs.garyhome.vn/jobs/teacher');
  assert.equal(d.activeElement,link.querySelector('input'));
  const saved=d.querySelector('.vacancy-save');
  saved.click();
  assert.equal(saved.getAttribute('aria-pressed'),'true');
  assert.ok(d.querySelector('#detail-dialog [data-action-toast-host]'));
  const themes=[...websitePreferences(d).querySelectorAll('[data-jobs-theme-choice]')];
  assert.deepEqual(themes.map(option=>option.dataset.jobsThemeChoice),['light','dark','system']);
  let preference;
  w.setGaryJobsTheme=value=>{preference=value;};
  themes.find(option=>option.dataset.jobsThemeChoice==='dark').click();
  assert.equal(preference,'dark');
 }finally{dom.window.close();}
});

test('vacancy reveal keeps intact text and reading styles persist independently of theme and language',async()=>{
 const listing=structuredClone(records);
 const body='Work with a supportive team & a <small class>. '+'Teach English in Hanoi. '.repeat(30).trim();
 listing[3].body_en=body;
 const url='https://jobs.garyhome.vn/jobs/teacher';
 const dom=await publicPage(listing,{url,storedStyle:'unknown'});
 let storedStyle;
 try{
  const w=dom.window,d=w.document;
  const workspace=d.querySelector('.vacancy-workspace');
  const copy=d.querySelector('.vacancy-article .vacancy-copy');
  const word=copy.querySelector('.vacancy-word');
  assert.ok(word);
  assert.equal(copy.textContent,body);
  assert.equal(copy.querySelector('small'),null);
  assert.ok(workspace.querySelectorAll('.vacancy-word').length<=64);
  const style=d.querySelector('#vacancy-style');
  assert.equal(style.value,'original');
  assert.deepEqual([...style.options].map(option=>option.value),['original','warm-editorial','modern-slate']);
  w.document.documentElement.dataset.jobsTheme='dark';
  style.value='modern-slate';
  style.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(workspace.dataset.vacancyStyle,'modern-slate');
  assert.equal(w.document.documentElement.dataset.jobsTheme,'dark');
  assert.equal(copy.querySelector('.vacancy-word'),word);
  switchVacancyLanguage(d);
  assert.equal(d.querySelector('.vacancy-word'),null);
  assert.equal(d.querySelector('#vacancy-style').value,'modern-slate');
  assert.equal(d.querySelector('label[for=vacancy-style]').textContent,'Kiểu trình bày');
  storedStyle=JSON.parse(w.localStorage.getItem('gary-jobs-vacancy-style'));
 }finally{dom.window.close();}
 const restored=await publicPage(listing,{url,storedStyle,reducedMotion:true});
 try{
  const d=restored.window.document;
  assert.equal(d.querySelector('#vacancy-style').value,'modern-slate');
  assert.equal(d.querySelector('.vacancy-word'),null);
  assert.equal(d.querySelector('.vacancy-article .vacancy-copy').textContent,body);
 }finally{restored.window.close();}
});

test('closing a directly opened vacancy returns to current listings without leaving the website',async()=>{
 const dom=await publicPage(records,{url:'https://jobs.garyhome.vn/jobs/teacher?utm_source=test'});
 try{
  const w=dom.window,d=w.document;d.querySelector('.dialog-close').click();
  assert.equal(w.location.pathname,'/');assert.equal(w.location.search,'?utm_source=test');assert.equal(w.location.hash,'#opportunities');
  assert.equal(d.querySelector('#detail-dialog').open,false);
 }finally{dom.window.close();}
});

test('language switching keeps the vacancy and campaign parameters with localized metadata',async()=>{
 const dom=await publicPage(records,{url:'https://jobs.garyhome.vn/jobs/teacher?utm_source=test'});
 try{
  const w=dom.window,d=w.document;switchVacancyLanguage(d);
  assert.equal(w.location.pathname,'/jobs/teacher');assert.equal(w.location.search,'?utm_source=test&lang=vi');
  assert.equal(d.querySelector('#detail-dialog').open,true);
  assert.match(d.querySelector('#dialog-title').textContent,/Tuyển giáo viên mới/);
  assert.match(d.title,/Tuyển giáo viên mới/);
  assert.equal(d.querySelector('link[rel="canonical"]').href,'https://jobs.garyhome.vn/jobs/teacher?lang=vi');
 }finally{dom.window.close();}
});

test('unknown or unpublished vacancy URLs show unavailable state instead of reference job details',async()=>{
 for(const content of [records,[]]){
  const dom=await publicPage(content,{url:'https://jobs.garyhome.vn/jobs/not-published'});
  try{
   const d=dom.window.document;
   assert.match(d.querySelector('#dialog-title').textContent,/Vacancy unavailable/);
   assert.equal(d.querySelector('#dialog-content [data-action="apply"]'),null);
   assert.equal(d.querySelector('meta[name="robots"]').content,'noindex,follow');
   d.querySelector('[data-action="vacancy-listings"]').click();
   assert.equal(dom.window.location.pathname,'/');
  }finally{dom.window.close();}
 }
});

test('backend failure on a vacancy URL offers a retry without opening a reference vacancy',async()=>{
 const dom=await publicPage(new Error('offline'),{url:'https://jobs.garyhome.vn/jobs/teacher'});
 try{
  const d=dom.window.document;
  assert.match(d.querySelector('#dialog-title').textContent,/Vacancy could not be loaded/);
  assert.ok(d.querySelector('[data-action="retry-vacancy"]'));
  assert.equal(d.querySelector('#dialog-content [data-action="apply"]'),null);
 }finally{dom.window.close();}
});

test('opening or restoring a vacancy rechecks publication and removes stale application links',async()=>{
 let current=records,reads=0;
 const dom=await publicPage(null,{loadCatalogue:async()=>{reads++;return current;}});
 try{
  const w=dom.window,d=w.document,listing=d.querySelector('#job-grid a[href="/jobs/teacher"]');
  current=records.filter(row=>row.kind!=='vacancy');
  listing.click();
  assert.match(d.getElementById('dialog-title').textContent,/Loading vacancy/);
  assert.equal(d.querySelector('#detail-dialog .vacancy-mobile-apply'),null);
  await settle();
  assert.equal(reads,2);
  assert.match(d.getElementById('dialog-title').textContent,/Vacancy unavailable/);
  assert.equal(d.querySelector('#job-grid a[href="/jobs/teacher"]'),null);

  current=records;
  w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));
  d.dispatchEvent(new w.Event('visibilitychange'));
  await settle();
  assert.equal(reads,3,'restoration events share one catalogue read');
  assert.match(d.getElementById('dialog-title').textContent,/New teacher vacancy/);
 }finally{dom.window.close();}
});

test('the server serves public vacancy text and metadata, with distinct missing and unavailable statuses',async()=>{
 const row={...records[3],seo_title_vi:'Việc dạy tiếng Anh',seo_description_vi:'Cơ hội tại Hà Nội',body_vi:'Nội dung <em>thuần văn bản</em>'};
 let fail=false;
 const calls=[];
 const handler=createVacancyHandler(async slug=>{calls.push(slug);if(fail)throw new Error('offline');return slug===row.slug?row:null;});
 async function request(url,method='GET',query){
  const response={writeHead(status,headers){this.status=status;this.headers=headers;return this;},end(body){this.body=body;}};
  await handler({url,method,query},response);
  return response;
 }
 const published=await request('/api/vacancy?slug=teacher&lang=vi');
 assert.equal(published.status,200);
 const doc=new JSDOM(published.body).window.document;
 try{
  assert.equal(doc.documentElement.lang,'vi');assert.equal(doc.title,row.seo_title_vi);
  assert.equal(doc.querySelector('meta[name=description]').content,row.seo_description_vi);
  assert.equal(doc.querySelector('#app h1').textContent,row.title_vi);
  assert.equal(doc.querySelector('#app em'),null);
  assert.match(doc.querySelector('#app').textContent,/<em>thuần văn bản<\/em>/);
  assert.equal(doc.querySelector('link[rel=canonical]').href,'https://jobs.garyhome.vn/jobs/teacher?lang=vi');
 }finally{doc.defaultView.close();}
 let resolveCatalogue;
 const catalogue=new Promise(resolve=>{resolveCatalogue=resolve;});
 const hydrated=await publicPage(catalogue,{shell:published.body,url:'https://jobs.garyhome.vn/jobs/teacher?lang=vi'});
 try{
  const page=hydrated.window.document;
  assert.equal(page.title,row.seo_title_vi,'the server title stays available during loading');
  resolveCatalogue([...records.slice(0,3),row]);await settle();
  assert.equal(page.title,row.seo_title_vi);
  assert.equal(page.querySelector('meta[name=description]').content,row.seo_description_vi);
 }finally{resolveCatalogue([]);hydrated.window.close();}
 const missing=await request('/jobs/unknown');
 assert.equal(missing.status,404);assert.match(missing.body,/noindex,follow/);
 const invalid=await request('/api/vacancy','GET',{slug:['teacher','unknown']});
 assert.equal(invalid.status,404);assert.deepEqual(calls,['teacher','unknown']);
 assert.equal((await request('/jobs/teacher','HEAD')).body,undefined);
 assert.equal((await request('/jobs/teacher','POST')).status,405);
 fail=true;
 const unavailable=await request('/jobs/teacher');
 assert.equal(unavailable.status,503);assert.equal(unavailable.headers['Retry-After'],'60');
 assert.match(unavailable.body,/Vacancy could not be loaded/);
});

test('modified vacancy link clicks retain native open-in-new-tab behavior',async()=>{
 const dom=await publicPage(records);
 try{
  const w=dom.window,d=w.document,link=d.querySelector('#job-grid h3 a'),event=new w.MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true});
  link.dispatchEvent(event);
  assert.equal(event.defaultPrevented,false);assert.equal(w.location.pathname,'/');
 }finally{dom.window.close();}
});

test('Vercel routes public SEO handlers before static files and keeps a root asset base',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.deepEqual(config.routes,[
  {src:'^/$',dest:'/api/discovery'},
  {src:'^/sitemap\\.xml$',dest:'/api/discovery?format=sitemap'},
  {src:'^/jobs/([^/]+)/?$',dest:'/api/vacancy?slug=$1'},
  {handle:'filesystem'},
 ]);
 assert.equal(config.functions['api/vacancy.js'].includeFiles,'dist/index.html');
 const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
 assert.match(html,/<base href="\/">/);
});

test('Apply from a nested vacancy URL links to the root candidate portal with vacancy identity',async()=>{
 const dom=await publicPage(records,{url:'https://jobs.garyhome.vn/jobs/teacher'});
 try{
  const link=dom.window.document.querySelector('#detail-dialog a[href^="/portal.html"]');
  assert.ok(link);const target=new URL(link.href);
  assert.equal(target.pathname,'/portal.html');assert.equal(target.searchParams.get('access'),'candidate');assert.equal(target.searchParams.get('view'),'apply');assert.equal(target.searchParams.get('vacancy'),records[3].id);
 }finally{dom.window.close();}
});

test('native Escape/dialog close restores listings from a vacancy route',async()=>{
 const dom=await publicPage(records,{url:'https://jobs.garyhome.vn/jobs/teacher'});
 try{
  dom.window.document.querySelector('#detail-dialog').close();
  assert.equal(dom.window.location.pathname,'/');
  assert.equal(dom.window.document.querySelector('#detail-dialog').open,false);
 }finally{dom.window.close();}
});

test('local static request handler serves a direct vacancy URL and preserves staff/assets routing',async()=>{
 const {readFile:read,stat}=await import('node:fs/promises'),{resolve,extname,sep}=await import('node:path'),{fileURLToPath}=await import('node:url');
 const source=(await readFile(new URL('../server.mjs',import.meta.url),'utf8')).split('\n').filter(line=>!line.startsWith('import ')).join('\n').replaceAll('import.meta.url',JSON.stringify(new URL('../server.mjs',import.meta.url).href));
 let handler;
 vm.runInNewContext(source,{vacancy:createVacancyHandler(async slug=>records.find(row=>row.kind==='vacancy'&&row.slug===slug)??null),createServer:fn=>{handler=fn;return {listen(){},close(){}};},readFile:read,stat,resolve,extname,sep,fileURLToPath,URL,process:{argv:[],env:{},on(){}}});
 async function request(url){const res={status:null,body:null,writeHead(status,headers){this.status=status;this.headers=headers;return this;},end(body){this.body=body;return this;}};await handler({url,method:'GET'},res);return res;}
 const vacancy=await request('/jobs/teacher?utm_source=test');assert.equal(vacancy.status,200);assert.match(vacancy.headers['Content-Type'],/text\/html/);assert.match(vacancy.body.toString(),/<base href="\/">/);
 assert.match(vacancy.body,/<h1>New teacher vacancy<\/h1>/);
 assert.equal((await request('/jobs/unknown')).status,404);
 assert.equal((await request('/portal.html')).status,200);assert.equal((await request('/app.js')).status,200);assert.equal((await request('/assets/favicon-32.png')).status,200);
 assert.equal((await request('/jobs/teacher/private')).status,404);assert.equal((await request('/api/nonexistent')).status,404);
});

test('archived or expired vacancies missing from the published catalogue cannot open via their old URL',async()=>{
 const published=records.filter(record=>record.kind!=='vacancy');
 const dom=await publicPage(published,{url:'https://jobs.garyhome.vn/jobs/teacher'});
 try{
  const d=dom.window.document;
  assert.match(d.querySelector('#dialog-title').textContent,/Vacancy unavailable/);
  assert.equal(d.querySelector('#detail-dialog a[href^="/portal.html"]'),null);
  assert.equal(d.querySelector('meta[name="robots"]').content,'noindex,follow');
  assert.equal(d.querySelectorAll('#job-grid [data-action="job"]').length,0);
 }finally{dom.window.close();}
});

test('malformed Vercel job paths show unavailable rather than an indexable duplicate homepage',async()=>{
 for(const slug of ['not_valid','%E6%95%99%E5%B8%88','a'.repeat(181)]){
  const dom=await publicPage(records,{url:'https://jobs.garyhome.vn/jobs/'+slug});
  try{
   const w=dom.window,d=w.document;
   assert.match(d.querySelector('#dialog-title').textContent,/Vacancy unavailable/);
   assert.equal(d.querySelector('meta[name="robots"]').content,'noindex,follow');
   d.querySelector('.dialog-close').click();
   assert.equal(w.location.pathname,'/');assert.equal(d.querySelector('meta[name="robots"]'),null);
   assert.equal(d.querySelector('link[rel="canonical"]').href,'https://jobs.garyhome.vn/');
  }finally{dom.window.close();}
 }
});

test('section navigation on nested job routes resolves to homepage anchors and close restores home metadata',async()=>{
 const dom=await publicPage(records,{url:'https://jobs.garyhome.vn/jobs/teacher'});
 try{
  const w=dom.window,d=w.document;
  assert.equal(d.querySelector('.desktop-nav a[href="#opportunities"]').href,'https://jobs.garyhome.vn/#opportunities');
  d.querySelector('.dialog-close').click();
  assert.match(d.title,/English Teaching Jobs in Vietnam/);
  assert.equal(d.querySelector('link[rel="canonical"]').href,'https://jobs.garyhome.vn/');
  assert.equal(d.querySelector('.desktop-nav a[href="#opportunities"]').href,w.location.origin+'/#opportunities');
 }finally{dom.window.close();}
});


test('standalone vacancies render employer, predefined bilingual filters and optional workplace without published references',async()=>{
 const vacancy={...structuredClone(records[3]),title_vi:'',summary_en:'',summary_vi:'',body_vi:'',data:{employer_name_en:'Independent Teaching Team',category_slug:'centers',location_slug:'hanoi',workplace_name:'West Lake branch',street_address:'12 Example Street',contact_email:'jobs@example.test'}};
 const dom=await publicPage([vacancy]);
 try{
  const d=dom.window.document;
  assert.match(d.querySelector('#job-grid').textContent,/Independent Teaching Team/);
  assert.match(d.querySelector('#job-tabs').textContent,/Language centers/);
  assert.ok(d.querySelector('#location option[value="hanoi"]'));
  d.querySelector('[data-action="filter"][data-id="centers"]').click();
  assert.match(d.querySelector('#job-grid').textContent,/New teacher vacancy/);
  for(const query of ['Independent Teaching Team','West Lake','12 Example Street']){
   d.querySelector('#keyword').value=query;
   d.querySelector('#job-search').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
   assert.match(d.querySelector('#job-grid').textContent,/New teacher vacancy/,'Direct vacancy details remain searchable: '+query);
  }
  d.querySelector('#job-grid h3 a').click();await settle();
  assert.match(d.querySelector('#detail-dialog').textContent,/Independent Teaching Team/);
  assert.match(d.querySelector('#detail-dialog').textContent,/West Lake branch · 12 Example Street/);
  switchVacancyLanguage(d);
  assert.match(d.querySelector('#dialog-title').textContent,/New teacher vacancy/,'English remains readable when Vietnamese is not supplied');
  assert.match(d.querySelector('#detail-dialog').textContent,/Details of this current role/);
  assert.match(d.querySelector('#job-tabs').textContent,/Trung tâm/);
  assert.match(d.querySelector('#location option[value="hanoi"]').textContent,/Hà Nội/);
 }finally{dom.window.close();}
});

test('unrelated misclassified taxonomy never appears as a public category filter and fixed labels take precedence',async()=>{
 const content=structuredClone(records);
 content.push({kind:'category',slug:'british-council',title_en:'british council',title_vi:'british coucil'});
 content[2].title_en='Wrong employer name';content[2].title_vi='Tên nhà tuyển dụng sai';
 const dom=await publicPage(content);
 try{
  const d=dom.window.document;
  assert.equal(d.querySelector('[data-action="filter"][data-id="british-council"]'),null);
  assert.match(d.querySelector('[data-action="filter"][data-id="public"]').textContent,/Public schools/);
  assert.doesNotMatch(d.querySelector('#job-tabs').textContent,/Wrong employer/);
 }finally{dom.window.close();}
});

test('legacy custom category, location and employer snapshots remain readable and filterable',async()=>{
 const content=structuredClone(records);
 content[2].slug='legacy-university';content[2].title_en='Legacy university role';content[2].title_vi='Vị trí đại học cũ';
 content[1].slug='legacy-campus';content[1].title_en='Legacy campus';content[1].title_vi='Cơ sở cũ';
 Object.assign(content[3].data,{category_slug:'legacy-university',location_slug:'legacy-campus'});
 const dom=await publicPage(content);
 try{
  const d=dom.window.document;
  assert.match(d.querySelector('#job-grid').textContent,/School/);
  d.querySelector('[data-action="filter"][data-id="legacy-university"]').click();
  assert.match(d.querySelector('#job-grid').textContent,/New teacher vacancy/);
  assert.equal(d.querySelector('#location option[value="legacy-campus"]').textContent,'Legacy campus');
  d.querySelector('[data-language="vi"]').click();
  assert.match(d.querySelector('#job-grid').textContent,/Trường/);
  assert.match(d.querySelector('#job-tabs').textContent,/Vị trí đại học cũ/);
 }finally{dom.window.close();}
});

test('direct employer, workplace and address text is escaped before reaching public markup',()=>{
 const data={...records[3].data,employer_name_en:'<img src=x onerror=bad()>',workplace_name:'<svg onload=bad()>',street_address:'<script>bad()</script>'};
 const card=vacancyCard({...records[3],data},0,records);
 assert.match(card.employer[0],/^&lt;img/);assert.match(card.workplace,/^&lt;svg/);assert.match(card.streetAddress,/^&lt;script&gt;/);
});

test('Undo restores the local shortlist after a confirmed bookmark change',async()=>{
 const dom=await publicPage(records);
 try{
  const doc=dom.window.document,key='gary-saved-jobs';
  const save=doc.querySelector('#job-grid [data-action="save"]'),id=save.dataset.id;
  save.click();
  assert.ok(JSON.parse(dom.window.localStorage.getItem(key)).includes(id));
  assert.equal(doc.querySelector('[data-action-toast-host] .action-toast-undo').textContent,'Undo');
  doc.querySelector('.action-toast-undo').click();
  assert.ok(!JSON.parse(dom.window.localStorage.getItem(key)).includes(id));
  assert.match(doc.querySelector('[data-tone="info"] [data-success-message]').textContent,/undone/);
 }finally{dom.window.close();}
});
