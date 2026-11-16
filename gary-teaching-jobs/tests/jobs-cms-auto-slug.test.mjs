import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountCms} from '../dist/cms-foundation/index.js';
import {emptyEntry, titleSlug, validateEntry} from '../dist/cms-foundation/content.js';

const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
const vacancy={kind:'vacancy',label:{en:'Vacancies',vi:'Tin tuyển dụng'},automaticSlug:true,publicPath:'/jobs/'};
const record={...emptyEntry('vacancy'),id:'existing-vacancy',slug:'original-job-title',title_en:'Original job title',title_vi:'Vị trí ban đầu',status:'draft',version:1};
function harness({collection=vacancy,records=[],language='en',savedSlug}={}){
 const dom=new JSDOM('<main id="root"></main>',{url:'https://jobs.garyhome.vn/portal.html'}),root=dom.window.document.querySelector('main'),calls=[];
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 dom.window.confirm=()=>true;
 const adapter={capabilities:async()=>({read:true,edit:true,publish:true,media:false}),list:async()=>({records:structuredClone(records),total:records.length}),revisions:async()=>[],save:async(entry,options)=>{calls.push({entry:structuredClone(entry),options});return {...entry,id:entry.id||'saved-vacancy',slug:savedSlug||entry.slug,version:entry.version+1};}};
 const controller=mountCms(root,{appId:'jobs',collections:[collection],language,adapter});
 const input=(name,value)=>{const control=root.querySelector(`[name="${name}"]`);assert.ok(control,name);control.value=value;control.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
 const submit=async()=>{root.querySelector('[data-cms-editor]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();};
 return {dom,root,calls,controller,input,submit,close(){controller.destroy({force:true});dom.window.close();}};
}

test('title-based URL names normalize English and Vietnamese without requiring a manual address',()=>{
 assert.equal(titleSlug({kind:'vacancy',title_en:'  English Teacher: Hanoi / Full-time! ',title_vi:'Giáo viên'}),'english-teacher-hanoi-full-time');
 assert.equal(titleSlug({kind:'vacancy',title_vi:'Đào tạo tiếng Anh tại Đà Nẵng — 2026!'}),'dao-tao-tieng-anh-tai-da-nang-2026');
 assert.equal(titleSlug({kind:'vacancy',title_en:'',title_vi:'Giáo viên Tiếng Anh, Hà Nội'}),'giao-vien-tieng-anh-ha-noi');
 assert.equal(titleSlug({kind:'vacancy',title_en:'👩‍🏫',title_vi:''}),'vacancy');
 assert.equal(titleSlug({kind:'vacancy',title_en:'  ',title_vi:''}),'');
 const long=titleSlug({kind:'vacancy',title_en:'Teaching - '.repeat(100)});
 assert.ok(long.length<=150);assert.match(long,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test('automatic URL validation reports a missing visible title without a hidden address error',()=>{
 const blank=emptyEntry('vacancy'),issues=validateEntry(blank,vacancy);
 assert.equal(issues.some(issue=>issue.code==='cms-slug'),false);
 assert.ok(issues.some(issue=>issue.code==='cms-title-missing'&&issue.field==='title_en'));
 assert.deepEqual(validateEntry({...blank,title_en:'Teacher in Hanoi'},vacancy),[]);
 assert.ok(validateEntry({...blank,title_en:'Teacher in Hanoi'},{kind:'vacancy'}).some(issue=>issue.code==='cms-slug'));
});

test('new vacancy editor removes Page Address in both languages and updates its generated URL as titles change',async()=>{
 for(const language of ['en','vi']){
  const h=harness({language});
  try{
   await h.controller.ready;h.root.querySelector('[data-action="new"]').click();await settle();
   assert.equal(h.root.querySelector('[name="slug"]'),null);
   assert.doesNotMatch(h.root.querySelector('form').textContent,/Page address|Đường dẫn trang/);
   assert.equal(h.dom.window.document.activeElement.name,'title_en');
   h.input('title_vi','Giáo viên tại Đà Nẵng');
   assert.match(h.root.querySelector('[data-cms-auto-url]').textContent,/\/jobs\/giao-vien-tai-da-nang/);
   h.input('title_en','English Teacher in Hanoi');
   assert.match(h.root.querySelector('[data-cms-auto-url]').textContent,/\/jobs\/english-teacher-in-hanoi/);
   h.input('title_en','Senior English Teacher');
   assert.match(h.root.querySelector('[data-cms-auto-url]').textContent,/\/jobs\/senior-english-teacher/);
   h.controller.setLanguage(language==='en'?'vi':'en');
   assert.equal(h.root.querySelector('[name="slug"]'),null);
   assert.match(h.root.querySelector('[data-cms-auto-url]').textContent,/\/jobs\/senior-english-teacher/);
  }finally{h.close();}
 }
});

test('a vacancy saves using its title and keeps the backend-resolved URL after the first save',async()=>{
 const h=harness({savedSlug:'english-teacher-hanoi-2'});
 try{
  await h.controller.ready;h.root.querySelector('[data-action="new"]').click();await settle();
  h.input('title_en','English Teacher, Hanoi!');await h.submit();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].entry.slug,'english-teacher-hanoi');assert.equal(h.calls[0].options.expectedVersion,0);
  assert.match(h.root.querySelector('[data-cms-auto-url]').textContent,/\/jobs\/english-teacher-hanoi-2/);
  assert.equal(h.root.querySelector('[name="slug"]'),null);
  h.input('title_en','A replacement title');await h.submit();
  assert.equal(h.calls[1].entry.slug,'english-teacher-hanoi-2');
  assert.equal(h.calls[1].options.expectedVersion,1);
 }finally{h.close();}
});

test('saved vacancy URLs remain stable when titles change in draft, review or published records',async()=>{
 for(const status of ['draft','review','published']){
  const h=harness({records:[{...record,status}]});
  try{
   await h.controller.ready;h.root.querySelector('[data-action="edit"]').click();await settle();
   assert.equal(h.root.querySelector('[name="slug"]'),null);
   h.input('title_en','Completely changed English title');h.input('title_vi','Tiêu đề tiếng Việt đã thay đổi');await h.submit();
   assert.equal(h.calls[0].entry.slug,'original-job-title',status);
   assert.match(h.root.querySelector('[data-cms-auto-url]').textContent,/\/jobs\/original-job-title/);
  }finally{h.close();}
 }
});

test('blank new vacancy submission focuses its title and makes no save request',async()=>{
 const h=harness();
 try{
  await h.controller.ready;h.root.querySelector('[data-action="new"]').click();await settle();await h.submit();
  assert.equal(h.calls.length,0);
  assert.equal(h.root.querySelector('[name="title_en"]').getAttribute('aria-invalid'),'true');
  assert.equal(h.dom.window.document.activeElement.name,'title_en');
  assert.equal(h.root.querySelector('[data-error-for="slug"]'),null);
 }finally{h.close();}
});

test('collections without the automatic URL policy retain their manual address field',async()=>{
 const h=harness({collection:{kind:'category',label:{en:'Categories',vi:'Danh mục'}}});
 try{
  await h.controller.ready;h.root.querySelector('[data-action="new"]').click();await settle();
  assert.ok(h.root.querySelector('[name="slug"]'));
  h.input('title_en','Public schools');h.input('slug','public-schools');await h.submit();
  assert.equal(h.calls[0].entry.slug,'public-schools');
 }finally{h.close();}
});
