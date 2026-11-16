import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {vacancyCard,escapeText,safeLink} from '../dist/jobs-public-content.js';
const records=[{id:'employer',kind:'employer',slug:'school',title_en:'School',title_vi:'Trường',summary_en:'A school',summary_vi:'Một trường'},{id:'location',kind:'location',slug:'hanoi',title_en:'Hanoi',title_vi:'Hà Nội'},{id:'category',kind:'category',slug:'public',title_en:'Public schools',title_vi:'Trường công'},{id:'10000000-0000-4000-8000-000000000001',kind:'vacancy',slug:'teacher',title_en:'New teacher vacancy',title_vi:'Tuyển giáo viên mới',summary_en:'A current teaching vacancy',summary_vi:'Tin tuyển dụng đang mở',body_en:'Details of this current role',body_vi:'Thông tin vị trí hiện tại',published_at:'2026-11-13T00:00:00Z',data:{location_slug:'hanoi',category_slug:'public',employer_slug:'school',hours:60,benefits_en:'Support',benefits_vi:'Hỗ trợ',contact_email:'jobs@example.test',requirements_en:'Degree',requirements_vi:'Bằng cấp'}}];
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
async function publicPage(result){
 const dom=new JSDOM(await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),{url:'https://jobs.garyhome.vn/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.IntersectionObserver=class{observe(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};w.matchMedia=()=>({matches:false});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.mountGaryApps=()=>({unmount(){}});w.mountPhotoGallery=()=>({unmount(){}});w.vacancyCard=vacancyCard;w.escapeText=escapeText;w.safeLink=safeLink;w.publicContent=()=>result instanceof Error?Promise.reject(result):Promise.resolve(result);
 const source=(await readFile(new URL('../dist/app.js',import.meta.url),'utf8')).split('\n').filter(l=>!l.startsWith('import ')).join('\n');
 vm.runInContext(source,dom.getInternalVMContext());await settle();return dom;
}
test('published vacancies replace reference cards and managed categories/locations survive filter changes',async()=>{
 const dom=await publicPage(records);try{const d=dom.window.document;assert.match(d.querySelector('#job-grid').textContent,/New teacher vacancy/);assert.doesNotMatch(d.querySelector('#job-grid').textContent,/Bắc Giang/);assert.match(d.querySelector('#location').textContent,/Hanoi/);d.querySelector('[data-action="filter"][data-id="public"]').click();assert.match(d.querySelector('#job-grid').textContent,/New teacher vacancy/);assert.equal(d.querySelectorAll('[data-action="filter"][data-id="public"]').length,1);assert.match(d.querySelector('.jobs-live-note').textContent,/Submit securely/);}finally{dom.window.close();}
});
test('missing backend remains an honest email fallback without a fake application receipt',async()=>{
 const dom=await publicPage(new Error('not provisioned'));try{const d=dom.window.document;assert.equal(d.querySelectorAll('.jobs-live-note').length,1);assert.match(d.querySelector('.jobs-live-note').textContent,/not available yet/);d.querySelector('[data-action="apply"]').click();assert.match(d.querySelector('#application-form').textContent,/Nothing is submitted/);assert.equal(d.querySelector('[data-action="copy-email"]'),null);}finally{dom.window.close();}
});
test('CMS text cannot inject markup or unsafe source protocols into public vacancy cards',()=>{
 const card=vacancyCard({...records[3],title_en:'<img src=x onerror=alert(1)>',data:{...records[3].data,source_url:'javascript:alert(1)',requirements_en:'<script>bad()</script>'}},0,records,'en');
 assert.ok(card.title[0].startsWith('&lt;img'));assert.equal(card.source,'#opportunities');assert.ok(card.requirements[0][0].includes('&lt;script&gt;'));assert.equal(safeLink('https://example.org/jobs'),'https://example.org/jobs');assert.equal(safeLink('data:text/html,bad'),'');
});
test('published salary and employer profile fields are visible and translate on the public site',async()=>{
 const content=structuredClone(records);
 Object.assign(content[0],{body_en:'Our teaching team supports new colleagues.',body_vi:'Đội ngũ giảng dạy hỗ trợ đồng nghiệp mới.',data:{website:'https://employer.example.test/',logo_url:'https://images.example.test/school.png'}});
 Object.assign(content[3].data,{salary_en:'USD 2,000 per month',salary_vi:'2.000 USD mỗi tháng'});
 const dom=await publicPage(content);
 try{
  const d=dom.window.document;
  assert.match(d.querySelector('#job-grid').textContent,/USD 2,000 per month/);
  d.querySelector('[data-action="job"]').click();assert.match(d.querySelector('#detail-dialog').textContent,/USD 2,000 per month/);
  assert.match(d.querySelector('#published-guides').textContent,/Our teaching team supports new colleagues/);
  assert.equal(d.querySelector('#published-guides a').href,'https://employer.example.test/');
  assert.equal(d.querySelector('#published-guides img').alt,'School');
  d.querySelector('[data-action="language"]').click();
  assert.match(d.querySelector('#job-grid').textContent,/2\.000 USD mỗi tháng/);
  assert.match(d.querySelector('#published-guides').textContent,/Đội ngũ giảng dạy hỗ trợ đồng nghiệp mới/);
 }finally{dom.window.close();}
});
test('employer links and logos reject executable and credential-bearing addresses',async()=>{
 const content=structuredClone(records);content[0].data={website:'javascript:alert(1)',logo_url:'https://name:password@images.example.test/school.png'};
 const dom=await publicPage(content);
 try{assert.equal(dom.window.document.querySelector('#published-guides a'),null);assert.equal(dom.window.document.querySelector('#published-guides img'),null);assert.equal(safeLink('https://name:password@example.test/'),'');}finally{dom.window.close();}
});
