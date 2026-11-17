import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {attachEditorWorkspace} from '../dist/editor-workspace/index.js';

const markup='<dialog id="editor" open><header><h2>Listing</h2><div class="gw-editor-controls"><button id="language" type="button">VI</button><button id="close" type="button">Close</button></div></header><form><div data-gw-body><input name="title" required><textarea name="body"></textarea><input name="file" type="file"><p role="alert">Existing field error</p></div><footer data-gw-actions><button type="submit">Save</button><button type="button">Cancel</button></footer></form></dialog>';
function harness({key='jobs:cms:vacancy',width=1440,height=960}={}){
 const dom=new JSDOM(markup,{url:'https://jobs.garyhome.vn/portal.html',pretendToBeVisual:true}),win=dom.window,doc=win.document,dialog=doc.querySelector('dialog');
 Object.defineProperty(win,'innerWidth',{value:width,writable:true});Object.defineProperty(win,'innerHeight',{value:height,writable:true});
 let language='en';const options={key,language:()=>language,header:dialog.querySelector('header'),body:dialog.querySelector('[data-gw-body]'),actions:dialog.querySelector('footer')};
 const controller=attachEditorWorkspace(dialog,options);
 const pointer=(target,type,x,y)=>{const event=new win.MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true,cancelable:true});Object.defineProperty(event,'pointerId',{value:1});target.dispatchEvent(event);};
 const keyboard=(edge,key,shiftKey=false)=>dialog.querySelector(`[data-gw-edge="${edge}"]`).dispatchEvent(new win.KeyboardEvent('keydown',{key,shiftKey,bubbles:true,cancelable:true}));
 return {dom,win,doc,dialog,controller,options,pointer,keyboard,setLanguage(value){language=value;controller.refresh();},close(){controller.destroy();dom.window.close();}};
}

test('shared workspace resizes eight edges/corners within viewport and offers keyboard controls',()=>{
 const h=harness();try{
  assert.equal(h.dialog.querySelectorAll('[data-gw-edge]').length,8);assert.equal(h.dialog.querySelectorAll('[data-gw-toggle]').length,1);
  const start=h.controller.getState().box,handle=h.dialog.querySelector('[data-gw-edge="nw"]');
  h.pointer(handle,'pointerdown',start.left,start.top);h.pointer(h.win,'pointermove',-10000,-10000);h.pointer(h.win,'pointerup',-10000,-10000);
  const box=h.controller.getState().box;assert.equal(box.left,12);assert.equal(box.top,12);assert.equal(box.left+box.width,start.left+start.width);assert.equal(box.top+box.height,start.top+start.height);assert.equal(h.doc.body.style.userSelect,'');
  h.keyboard('se','Home');assert.equal(h.controller.getState().box.width,640);assert.equal(h.controller.getState().box.height,400);
  h.keyboard('se','ArrowRight',true);assert.equal(h.controller.getState().box.width,704);
  h.keyboard('se','End');assert.equal(h.controller.getState().box.width,1416);assert.equal(h.controller.getState().box.height,936);
 }finally{h.close();}
});

test('maximize/restore preserves form values, files, errors, listeners and node identity',()=>{
 const h=harness();try{
  const form=h.dialog.querySelector('form'),input=form.elements.title,textarea=form.elements.body,file=form.elements.file,error=form.querySelector('[role=alert]');
  input.value='Unsaved teacher vacancy';textarea.value='Detailed unsaved text';const selectedFile=new h.win.File(['cv'],'cv.pdf',{type:'application/pdf'});Object.defineProperty(file,'files',{value:[selectedFile]});
  let submissions=0;form.addEventListener('submit',event=>{event.preventDefault();submissions++;});
  h.keyboard('se','Home');const before=h.controller.getState().box;
  h.dialog.querySelector('[data-gw-toggle]').click();assert.ok(h.dialog.classList.contains('gw-maximized'));assert.equal(h.controller.getState().box.height,936);assert.equal(h.dialog.querySelector('[data-gw-toggle]').getAttribute('aria-label'),'Restore editor');
  h.dialog.querySelector('[data-gw-toggle]').click();assert.deepEqual(h.controller.getState().box,before);
  for(const node of [form,input,textarea,file,error])assert.ok(h.dialog.contains(node));assert.equal(input.value,'Unsaved teacher vacancy');assert.equal(textarea.value,'Detailed unsaved text');assert.equal(file.files[0],selectedFile);assert.equal(error.textContent,'Existing field error');
  form.requestSubmit();assert.equal(submissions,1);assert.equal(input.required,true);
 }finally{h.close();}
});

test('workspace preferences survive next editor and remain separate by workflow',()=>{
 const h=harness();try{
  h.keyboard('se','Home');h.dialog.querySelector('[data-gw-toggle]').click();const stored=h.win.localStorage.getItem('gary-editor-workspace:v1:jobs:cms:vacancy');assert.deepEqual(JSON.parse(stored),{schema:1,width:640,height:400,maximized:true});
  h.controller.destroy();const next=attachEditorWorkspace(h.dialog,h.options);assert.equal(next.getState().maximized,true);next.destroy();
  const other=attachEditorWorkspace(h.dialog,{...h.options,key:'jobs:cms:guide'});assert.equal(other.getState().maximized,false);assert.equal(other.getState().width,1120);other.destroy();
 }finally{h.dom.window.close();}
});

test('mobile opens fullscreen without erasing desktop preference and viewport shrink stays bounded',()=>{
 const h=harness();try{
  h.keyboard('se','Home');const stored=h.win.localStorage.getItem('gary-editor-workspace:v1:jobs:cms:vacancy');
  h.win.innerWidth=390;h.win.innerHeight=700;h.win.dispatchEvent(new h.win.Event('resize'));assert.equal(h.controller.getState().mobile,true);assert.deepEqual(h.controller.getState().box,{width:390,height:700,left:0,top:0});assert.equal(h.dialog.querySelector('[data-gw-toggle]').disabled,true);assert.ok([...h.dialog.querySelectorAll('[data-gw-edge]')].every(node=>node.hidden));
  assert.equal(h.win.localStorage.getItem('gary-editor-workspace:v1:jobs:cms:vacancy'),stored);
  h.win.innerWidth=900;h.win.innerHeight=600;h.win.dispatchEvent(new h.win.Event('resize'));assert.equal(h.controller.getState().maximized,false);assert.equal(h.controller.getState().box.width,640);assert.equal(h.controller.getState().box.height,400);
  h.dialog.querySelector('[data-gw-toggle]').click();assert.deepEqual(h.controller.getState().box,{width:876,height:576,left:12,top:12});
 }finally{h.close();}
});

test('localization and rebuilt headers retain one control and never remove application controls',async()=>{
 const h=harness();try{
  h.setLanguage('vi');assert.equal(h.dialog.querySelector('[data-gw-toggle]').getAttribute('aria-label'),'Phóng to trình biên tập');assert.match(h.dialog.querySelector('[data-gw-edge="se"]').getAttribute('aria-label'),/góc dưới phải/);
  h.dialog.querySelector('header').outerHTML='<header><h2>Updated title</h2><button id="new-close" type="button">Close</button></header>';h.controller.refresh();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.dialog.querySelectorAll('[data-gw-toggle]').length,1);assert.ok(h.dialog.querySelector('#new-close'));
  h.controller.destroy();assert.ok(h.dialog.querySelector('#new-close'));assert.equal(h.dialog.querySelectorAll('[data-gw-toggle],[data-gw-edge]').length,0);
 }finally{h.dom.window.close();}
});

test('unmount cancels pointer capture styles and preserves original header controls',()=>{
 const h=harness();const language=h.doc.querySelector('#language'),close=h.doc.querySelector('#close');
 h.pointer(h.dialog.querySelector('[data-gw-edge="w"]'),'pointerdown',100,100);assert.equal(h.doc.body.style.userSelect,'none');h.controller.destroy();assert.equal(h.doc.body.style.userSelect,'');assert.equal(h.doc.querySelector('#language'),language);assert.equal(h.doc.querySelector('#close'),close);h.dom.window.close();
});

test('real CMS retains field errors, dirty guard and submission through maximize/resize and remembers the next vacancy',async()=>{
 const {mountCms}=await import('../dist/cms-foundation/index.js');
 const dom=new JSDOM('<main></main>',{url:'https://jobs.garyhome.vn/portal.html',pretendToBeVisual:true}),win=dom.window,root=win.document.querySelector('main');
 Object.defineProperty(win,'innerWidth',{value:1440,writable:true});Object.defineProperty(win,'innerHeight',{value:960,writable:true});
 win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};win.HTMLDialogElement.prototype.close=function(){this.open=false;};win.HTMLElement.prototype.scrollIntoView=function(){};win.confirm=()=>false;
 const saved=[],collection={kind:'vacancy',label:{en:'Vacancies',vi:'Tin tuyển dụng'},automaticSlug:true,directPublish:true,publishTextFields:['title_en','body_en']};
 const cms=mountCms(root,{appId:'jobs',collections:[collection],adapter:{capabilities:async()=>({read:true,edit:true,publish:true}),list:async()=>({records:[],total:0}),revisions:async()=>[],save:async record=>{saved.push(structuredClone(record));return{...record,id:'one-vacancy',version:record.version+1};}}});
 const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
 try{
  await cms.ready;root.querySelector('[data-action=new]').click();await settle();
  const input=root.querySelector('[name=title_en]');input.value='An unsaved vacancy';input.dispatchEvent(new win.Event('input',{bubbles:true}));assert.equal(cms.isDirty(),true);
  root.querySelector('[data-action=publish]').click();await settle();const error=root.querySelector('[data-error-for=body_en]');assert.ok(error.textContent);assert.equal(root.querySelector('[name=body_en]').getAttribute('aria-invalid'),'true');
  const form=root.querySelector('form'),toggle=root.querySelector('[data-gw-toggle]');toggle.click();assert.equal(root.querySelector('form'),form);assert.equal(root.querySelector('[name=title_en]'),input);assert.ok(error.textContent);assert.equal(cms.isDirty(),true);
  root.querySelector('[data-action=close]').click();await settle();assert.ok(root.querySelector('dialog').open,'declining the leave warning keeps the editor open');assert.equal(input.value,'An unsaved vacancy');
  toggle.click();root.querySelector('[data-gw-edge=e]').dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));toggle.click();
  cms.setLanguage('vi');assert.equal(root.querySelector('[name=title_en]').value,'An unsaved vacancy');assert.ok(root.querySelector('[data-error-for=body_en]').textContent);assert.ok(root.querySelector('dialog').classList.contains('gw-maximized'));
  const body=root.querySelector('[name=body_en]');body.value='Vacancy details';body.dispatchEvent(new win.Event('input',{bubbles:true}));root.querySelector('form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));await settle();assert.equal(saved.length,1);assert.equal(saved[0].title_en,'An unsaved vacancy');assert.equal(saved[0].body_en,'Vacancy details');assert.equal(cms.isDirty(),false);
  root.querySelector('[data-action=close]').click();await settle();assert.equal(win.document.activeElement,root.querySelector('[data-action=new]'),'closing restores keyboard focus to the workspace');root.querySelector('[data-action=new]').click();await settle();assert.ok(root.querySelector('dialog').classList.contains('gw-maximized'),'the next vacancy uses the remembered maximized state');assert.equal(root.querySelector('[name=title_en]').value,'');
 }finally{cms.destroy({force:true});dom.window.close();}
});
