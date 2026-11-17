import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {vacancyCard,vacancySlug,escapeText,safeLink} from '../dist/jobs-public-content.js';
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
async function page(){
 const rows=[{id:'category',kind:'category',slug:'schools',title_en:'Schools',title_vi:'Trường học'},{id:'location',kind:'location',slug:'hanoi',title_en:'Hanoi',title_vi:'Hà Nội'},{id:'job',kind:'vacancy',slug:'english-teacher',title_en:'English Teacher',title_vi:'Giáo viên tiếng Anh',summary_en:'A teaching role',summary_vi:'Công việc giảng dạy',published_at:'2026-11-16T00:00:00Z',data:{category_slug:'schools',location_slug:'hanoi',requirements_en:'Degree',requirements_vi:'Bằng cấp'}}];
 const dom=new JSDOM(await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),{url:'https://jobs.garyhome.vn/',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 w.IntersectionObserver=class{observe(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 Object.assign(w,{mountGaryApps:()=>({unmount(){}}),mountPhotoGallery:()=>({unmount(){}}),mountGlassHero:()=>({unmount(){},update(){}}),vacancyCard,vacancySlug,escapeText,safeLink,publicContent:async()=>rows});
 w.eval(await readFile(new URL('../dist/jobs-theme-init.js',import.meta.url),'utf8'));
 const source=(await readFile(new URL('../dist/app.js',import.meta.url),'utf8')).split('\n').filter(line=>!line.startsWith('import ')).join('\n');vm.runInContext(source,dom.getInternalVMContext());await settle();return dom;
}
test('career discovery keeps one working search form in the hero through language changes',async()=>{
 const dom=await page();try{
  const d=dom.window.document;assert.equal(d.querySelectorAll('#job-search').length,1);assert.ok(d.querySelector('.career-hero #job-search'));
  d.querySelector('#keyword').value='unmatched subject';d.querySelector('#job-search').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(d.querySelectorAll('#job-grid .job-card').length,0);assert.match(d.querySelector('#job-grid').textContent,/No roles match/);
  d.querySelector('[data-language="vi"]').click();
  assert.equal(d.querySelectorAll('#job-search').length,1);assert.equal(d.querySelector('#keyword').value,'unmatched subject');
  assert.match(d.querySelector('#hero-title').textContent,/Dạy tiếng Anh/);assert.match(d.querySelector('.search-button').textContent,/Tìm việc giảng dạy/);
  d.querySelector('[data-action="reset-jobs"]').click();assert.equal(d.querySelectorAll('#job-grid .job-card').length,1);
 }finally{dom.window.close();}
});

test('English and Vietnamese hero phrases balance independently in both themes without forced line breaks',async()=>{
 const dom=await page();try{
  const d=dom.window.document;
  const paths=['styles.css','jobs-public-theme.css','jobs-hero-layout.css'];
  for(const path of paths){const style=d.createElement('style');style.textContent=await readFile(new URL(`../dist/${path}`,import.meta.url),'utf8');d.head.append(style);}
  const sheet=d.querySelector('style:last-of-type').sheet;
  const rules=[...sheet.cssRules];
  const phraseRule=rules.find(rule=>rule.selectorText?.includes('#hero-title :is(.hero-title-line,em)'));
  assert.ok(phraseRule,'the actual hero stylesheet styles both phrase blocks');
  assert.equal(phraseRule.style.getPropertyValue('white-space'),'normal');
  assert.equal(phraseRule.style.getPropertyValue('text-wrap'),'balance');
  assert.equal(phraseRule.style.getPropertyValue('display'),'block');
  const vietnameseRule=rules.find(rule=>rule.selectorText==='html:lang(vi) .jobs-public .jobs-final-hero #hero-title');
  assert.match(vietnameseRule.style.getPropertyValue('font-size'),/clamp\([^)]*cqi/,'Vietnamese size follows its actual text column');
  assert.ok(d.querySelector('link[href="jobs-hero-layout.css"]'));
  const keyword=d.querySelector('#keyword');keyword.value='science';
  const phrases={
   en:{light:['Teach English.','Live the adventure.'],dark:['Build your career.','Explore a new culture.']},
   vi:{light:['Dạy tiếng Anh.','Khám phá hành trình mới.'],dark:['Phát triển sự nghiệp.','Khám phá nền văn hóa mới.']}
  };
  for(const locale of ['en','vi'])for(const theme of ['light','dark']){
   d.querySelector(`[data-language="${locale}"]`).click();
   d.querySelector(`[data-jobs-theme-choice="${theme}"]`).click();
   const title=d.querySelector('#hero-title'),main=title.querySelector('.hero-title-line'),accent=title.querySelector('em');
   assert.deepEqual([...title.children].map(node=>node.tagName),['SPAN','EM']);
   assert.equal(title.querySelector('br'),null);
   assert.equal(main.textContent,phrases[locale][theme][0]);assert.equal(accent.textContent,phrases[locale][theme][1]);
   assert.equal(dom.window.getComputedStyle(main).whiteSpace,'normal');assert.equal(dom.window.getComputedStyle(accent).whiteSpace,'normal');
   assert.equal(d.querySelector('#keyword').value,'science');assert.equal(d.querySelectorAll('#job-search').length,1);
  }
 }finally{dom.window.close();}
});
