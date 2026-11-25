import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM,VirtualConsole} from 'jsdom';
import {vacancyCard,vacancySlug,escapeText,safeLink} from '../dist/jobs-public-content.js';
import * as jobsSeo from '../dist/jobs-seo.js';
import {mountPublicApplicationEditor} from '../dist/jobs-public-editors.js';
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
async function page({width=1280,height=900}={}){
 const dom=new JSDOM(await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),{url:'https://jobs.garyhome.vn/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
 const w=dom.window;Object.defineProperty(w,'innerWidth',{value:width,writable:true});Object.defineProperty(w,'innerHeight',{value:height,writable:true});
 w.IntersectionObserver=class{observe(){}disconnect(){}};w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};w.matchMedia=()=>({matches:false});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.mountGaryApps=()=>({unmount(){}});w.mountPhotoGallery=()=>({unmount(){}});w.mountGlassHero=()=>({unmount(){},update(){}});Object.assign(w,jobsSeo);
 Object.assign(w,{vacancyCard,vacancySlug,escapeText,safeLink,publicContent:async()=>{throw Error('offline');}});
 const source=(await readFile(new URL('../dist/app.js',import.meta.url),'utf8')).split('\n').filter(line=>!line.startsWith('import ')).join('\n');vm.runInContext(source,dom.getInternalVMContext());await settle();
 const controller=mountPublicApplicationEditor(w.document);return {dom,w,d:w.document,controller};
}
test('fallback application composer resizes, maximizes and restores without replacing its draft or submit workflow',async()=>{
 const h=await page(),{w,d}=h;
 try{
  d.querySelector('[data-action="apply"]').click();await settle();
  const dialog=d.getElementById('detail-dialog'),form=d.getElementById('application-form'),name=form.elements.name,message=form.elements.message;
  name.value='A retained candidate';form.elements.email.value='candidate@example.test';message.value='My qualifications and teaching plans';name.setCustomValidity('Preserved field error');
  const title=d.getElementById('dialog-title'),initialWidth=dialog.style.getPropertyValue('--gw-width');
  dialog.querySelector('[data-gw-edge="w"]').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
  assert.notEqual(dialog.style.getPropertyValue('--gw-width'),initialWidth);
  dialog.querySelector('[data-gw-toggle]').click();await settle();assert.equal(dialog.classList.contains('gw-maximized'),true);
  assert.equal(d.getElementById('application-form'),form);assert.equal(form.elements.name,name);assert.equal(name.value,'A retained candidate');assert.equal(name.validationMessage,'Preserved field error');assert.equal(message.value,'My qualifications and teaching plans');assert.equal(d.getElementById('dialog-title'),title);
  dialog.querySelector('[data-gw-toggle]').click();assert.equal(dialog.classList.contains('gw-maximized'),false);assert.notEqual(dialog.style.getPropertyValue('--gw-width'),initialWidth);
  name.setCustomValidity('');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle();
  assert.equal(d.getElementById('email-fallback').hidden,false);assert.match(d.querySelector('.email-copy-area').value,/A retained candidate/);assert.match(d.querySelector('.email-copy-area').value,/My qualifications and teaching plans/);
  assert.equal(form.querySelector('.gw-editor-actions .form-submit').form,form);
 }finally{h.controller.destroy();h.dom.window.close();}
});
test('composer size and maximized preference reopen automatically while read-only dialogs remain unchanged',async()=>{
 const h=await page(),{d,w}=h;
 try{
  d.querySelector('[data-action="apply"]').click();await settle();const dialog=d.getElementById('detail-dialog');dialog.querySelector('[data-gw-toggle]').click();
  assert.equal(JSON.parse(w.localStorage.getItem('gary-editor-workspace:v1:jobs.application-email')).maximized,true);
  d.querySelector('[data-action="close-dialog"]').click();d.querySelector('[data-action="contact"]').click();await settle();
  assert.equal(dialog.classList.contains('gw-editor'),false);assert.equal(dialog.querySelector('[data-gw-toggle]'),null);assert.ok(d.querySelector('.contact-options'));
  d.querySelector('[data-action="close-dialog"]').click();d.querySelector('[data-action="apply"]').click();await settle();assert.equal(dialog.classList.contains('gw-maximized'),true);
  assert.equal(d.querySelectorAll('.dialog-close').length,1);assert.equal(d.querySelectorAll('#dialog-title').length,1);
 }finally{h.controller.destroy();h.dom.window.close();}
});
test('mobile application composer uses the full viewport and keeps edits through viewport changes',async()=>{
 const h=await page({width:390,height:844}),{d,w}=h;
 try{
  d.querySelector('[data-action="apply"]').click();await settle();const dialog=d.getElementById('detail-dialog'),message=d.querySelector('#application-form textarea');message.value='A mobile draft';
  assert.equal(dialog.style.getPropertyValue('--gw-width'),'390px');assert.equal(dialog.style.getPropertyValue('--gw-height'),'844px');assert.equal(dialog.querySelector('[data-gw-toggle]').disabled,true);assert.equal(dialog.querySelectorAll('[data-gw-edge]:not([hidden])').length,0);
  w.innerWidth=1200;w.innerHeight=850;w.dispatchEvent(new w.Event('resize'));assert.equal(d.querySelector('#application-form textarea'),message);assert.equal(message.value,'A mobile draft');assert.equal(dialog.querySelector('[data-gw-toggle]').disabled,false);
 }finally{h.controller.destroy();h.dom.window.close();}
});
