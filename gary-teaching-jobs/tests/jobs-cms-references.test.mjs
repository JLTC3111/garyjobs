import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {bindFeedbackDom} from './helpers/feedback-dom.mjs';
import {mountCms} from '../dist/cms-foundation/index.js';
import {validateEntry} from '../dist/cms-foundation/content.js';
import {validationText} from '../dist/cms-foundation/copy.js';
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const kinds=['employer','category','location'];
const fields=kinds.map(kind=>({key:kind+'_slug',label:{en:{employer:'Employer',category:'Job category',location:'Location'}[kind],vi:{employer:'Nhà tuyển dụng',category:'Danh mục việc làm',location:'Địa điểm'}[kind]},type:'reference',referenceKind:kind,required:true}));
const collection={kind:'vacancy',label:{en:'Vacancies',vi:'Tin tuyển dụng'},automaticSlug:true,publicPath:'/jobs/',publishMinimums:{title:3,summary:10,body:20},fields:[...fields,{key:'contact_email',label:{en:'Recruiter email',vi:'Email chuyên viên'},type:'email',required:true},{key:'closes_on',label:{en:'Closing date',vi:'Hạn tuyển dụng'},type:'date',required:true,minDate:'today'}]};
const record={id:'vacancy-1',kind:'vacancy',slug:'english-teacher',title_en:'English teacher',title_vi:'Giáo viên tiếng Anh',summary_en:'A complete English summary',summary_vi:'Tóm tắt tiếng Việt đầy đủ',body_en:'Detailed English information about this teaching position.',body_vi:'Thông tin tiếng Việt chi tiết về vị trí giảng dạy này.',data:{employer_slug:'school',category_slug:'public-schools',location_slug:'hanoi',contact_email:'recruiter@example.test',closes_on:'2099-12-31'},version:2,status:'review'};
const choices={employer:[{value:'school',label:{en:'ABC School',vi:'Trường ABC'},status:'published',published:true}],category:[{value:'public-schools',label:{en:'Public schools',vi:'Trường công'},status:'published',published:true}],location:[{value:'hanoi',label:{en:'Hanoi',vi:'Hà Nội'},status:'published',published:true},{value:'danang',label:{en:'Da Nang',vi:'Đà Nẵng'},status:'published',published:true}]};
function harness({language='en',entry=record,options=choices,referenceOptions,onCreate,onValidate,onTransition,onSave,publisher=true}={}){
 const dom=new JSDOM('<main id="root"></main>',{url:'https://jobs.garyhome.vn/portal.html'}),root=dom.window.document.querySelector('main'),calls={options:[],creates:[],validation:[],transitions:[],saves:[]};
  bindFeedbackDom(dom.window);

 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};dom.window.HTMLElement.prototype.scrollIntoView=function(){};dom.window.confirm=()=>true;
 const adapter={errorText:()=>language==='vi'?'Thao tác chưa hoàn tất.':'The action could not be completed.',capabilities:async()=>({read:true,edit:true,publish:publisher,media:false}),list:async()=>({records:[structuredClone(entry)],total:1}),revisions:async()=>[],referenceOptions:async kind=>{calls.options.push(kind);return referenceOptions?referenceOptions(kind):structuredClone(options[kind]||[]);},validatePublication:async value=>{calls.validation.push(structuredClone(value));return onValidate?onValidate(value):[];},transition:async(...args)=>{calls.transitions.push(args);return onTransition?onTransition(...args):{...entry,status:args[1],version:entry.version+1};},save:async(value,input)=>{calls.saves.push({value:structuredClone(value),input});return onSave?onSave(value,input):{...value,version:value.version+1};},createReference:async(kind,value)=>{calls.creates.push({kind,value:structuredClone(value)});return onCreate?onCreate(kind,value):{id:'reference-1',kind,slug:'new-school',version:3,status:'published'};}};
 const controller=mountCms(root,{appId:'jobs',collections:[collection],language,adapter});
 const input=(selector,value)=>{const el=root.querySelector(selector);assert.ok(el,selector);el.focus();el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));return el;};
 const click=async selector=>{const el=root.querySelector(selector);assert.ok(el,selector);el.click();await settle();};
 const open=async()=>{await controller.ready;await click('[data-action="edit"]');};
 return {dom,root,calls,controller,input,click,open,close(){controller.destroy({force:true});dom.window.close();}};
}

test('reference selectors display bilingual names and save the underlying selected values',async()=>{
 const h=harness();try{
  await h.open();assert.equal(h.root.querySelector('input[name="data.employer_slug"]'),null);
  assert.match(h.root.querySelector('select[name="data.employer_slug"]').textContent,/ABC School/);
  const select=h.root.querySelector('select[name="data.location_slug"]');select.value='danang';select.dispatchEvent(new h.dom.window.Event('change',{bubbles:true}));
  h.root.querySelector('form').dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();
  assert.equal(h.calls.saves[0].value.data.location_slug,'danang');
  h.controller.setLanguage('vi');assert.match(h.root.querySelector('select[name="data.location_slug"]').textContent,/Đà Nẵng/);
  assert.equal(h.root.querySelector('select[name="data.location_slug"]').value,'danang');
 }finally{h.close();}
});

test('reference searches are accent-insensitive and preserve selection and parent draft',async()=>{
 const h=harness();try{
  await h.open();h.input('[name="body_en"]','My unsaved English content is preserved through filtering.');
  h.input('[data-reference-search="data.location_slug"]','da nang');
  const select=h.root.querySelector('[name="data.location_slug"]');assert.ok([...select.options].some(option=>option.value==='danang'));
  assert.equal(select.value,'hanoi');assert.match(h.root.querySelector('[name="body_en"]').value,/unsaved/);
  assert.equal(h.dom.window.document.activeElement.dataset.referenceSearch,'data.location_slug');
 }finally{h.close();}
});

test('legacy values stay visible without silent replacement and publication shows the exact blocked field',async()=>{
 const h=harness({entry:{...record,data:{...record.data,employer_slug:'Typed school name'}}});try{
  await h.open();assert.equal(h.root.querySelector('[name="data.employer_slug"]').value,'Typed school name');
  assert.match(h.root.querySelector('[data-reference-field="data.employer_slug"]').textContent,/Previously entered: Typed school name/);
  await h.click('[data-action="publish"]');
  assert.equal(h.calls.transitions.length,0);assert.equal(h.root.querySelector('[name="data.employer_slug"]').getAttribute('aria-invalid'),'true');
  assert.match(h.root.querySelector('[data-editor-errors]').textContent,/Employer/);
  assert.equal(h.dom.window.document.activeElement.name,'data.employer_slug');
 }finally{h.close();}
});

test('unpublished references are shown as disabled choices and never pass publication',async()=>{
 const options=structuredClone(choices);options.employer[0].published=false;options.employer[0].status='draft';
 const h=harness({options});try{await h.open();const select=h.root.querySelector('[name="data.employer_slug"]');assert.equal(select.selectedOptions[0].disabled,true);assert.match(select.textContent,/Draft/);await h.click('[data-action="publish"]');assert.equal(h.calls.transitions.length,0);assert.match(h.root.querySelector('[data-error-for="data.employer_slug"]').textContent,/Publish the selected employer/);}finally{h.close();}
});

test('empty reference choices offer explicit bilingual create-and-publish without discarding the vacancy',async()=>{
 const options={employer:[],category:choices.category,location:choices.location};let created=false;
 const h=harness({options,referenceOptions:async kind=>kind==='employer'?(created?[{value:'new-school',label:{en:'New school',vi:'Trường mới'},published:true,status:'published'}]:[]):choices[kind],onCreate:async()=>{created=true;return{id:'new-1',slug:'new-school',status:'published',version:3};}});try{
  await h.open();const field='[data-reference-field="data.employer_slug"]';assert.equal(h.root.querySelector(field+' details').open,false,'Create panels stay compact until opened');h.root.querySelector(field+' details').open=true;
  assert.equal(h.root.querySelectorAll('form').length,1,'Inline creation never nests forms');
  h.input('[name="body_vi"]','Nội dung bản nháp vẫn được giữ trong quá trình tạo nhà tuyển dụng.');
  for(const [key,value]of Object.entries({title_en:'New school',title_vi:'Trường mới',summary_en:'A complete school introduction',summary_vi:'Giới thiệu nhà trường đầy đủ'}))h.input(`${field} [data-reference-create-field="${key}"]`,value);
  await h.click(`${field} [data-action="reference-create"]`);
  assert.equal(h.calls.creates.length,1);assert.equal(h.calls.creates[0].kind,'employer');assert.equal(h.root.querySelector('[name="data.employer_slug"]').value,'new-school');
  assert.match(h.root.querySelector('[name="body_vi"]').value,/bản nháp vẫn được giữ/);assert.equal(h.calls.transitions.length,0,'Creating a profile never publishes the vacancy');
 }finally{h.close();}
});

test('inline reference failure retains content and resumes partial records without creating duplicates',async()=>{
 let attempt=0,created=false;const h=harness({referenceOptions:async kind=>kind==='employer'?(created?[{value:'new-school',label:'New school',published:true}]:[]):choices[kind],onCreate:async()=>{if(++attempt===1)throw{partialRecord:{id:'partial-1',version:2,status:'review'}};created=true;return{id:'partial-1',slug:'new-school',version:3,status:'published'};}});try{
  await h.open();const field='[data-reference-field="data.employer_slug"]';
  for(const [key,value]of Object.entries({title_en:'New school',title_vi:'Trường mới',summary_en:'A complete school introduction',summary_vi:'Giới thiệu nhà trường đầy đủ'}))h.input(`${field} [data-reference-create-field="${key}"]`,value);
  await h.click(`${field} [data-action="reference-create"]`);assert.match(h.root.querySelector(field).textContent,/saved, but publication did not finish/);
  assert.equal(h.root.querySelector(`${field} [data-reference-create-field="title_en"]`).value,'New school');
  h.controller.setLanguage('vi');assert.equal(h.root.querySelector(`${field} [data-reference-create-field="title_en"]`).value,'New school');
  await h.click(`${field} [data-action="reference-create"]`);assert.equal(h.calls.creates[1].value.id,'partial-1');assert.equal(h.calls.creates[1].value.version,2);assert.equal(h.root.querySelector('[name="data.employer_slug"]').value,'new-school');
 }finally{h.close();}
});

test('editors receive clear empty guidance without an unauthorized publish action',async()=>{
 const h=harness({options:{},publisher:false});try{await h.open();assert.equal(h.root.querySelector('[data-action="reference-create"]'),null);assert.match(h.root.textContent,/ask a publisher/);}finally{h.close();}
});

test('loading failures and retries leave parent inputs unchanged',async()=>{
 let fail=true;const h=harness({referenceOptions:async kind=>{if(kind==='employer'&&fail)throw new Error('offline');return choices[kind];}});try{
  await h.open();h.input('[name="title_en"]','An unsaved edited vacancy title');assert.match(h.root.querySelector('[data-reference-field="data.employer_slug"]').textContent,/Choices could not be loaded/);
  fail=false;await h.click('[data-reference-field="data.employer_slug"] [data-action="reference-refresh"]');
  assert.match(h.root.querySelector('[name="data.employer_slug"]').textContent,/ABC School/);assert.equal(h.root.querySelector('[name="title_en"]').value,'An unsaved edited vacancy title');
 }finally{h.close();}
});

test('fresh publication checks catch archived references and focus fields after controls are re-enabled',async()=>{
 let stale=false;const h=harness({referenceOptions:async kind=>kind==='employer'&&stale?[]:choices[kind]});try{
  await h.open();stale=true;await h.click('[data-action="publish"]');assert.equal(h.calls.transitions.length,0);
  const control=h.root.querySelector('[name="data.employer_slug"]');assert.equal(control.disabled,false);assert.equal(h.dom.window.document.activeElement,control);assert.match(h.root.querySelector('[data-editor-errors]').textContent,/Employer/);
 }finally{h.close();}
});

test('server issue details become linked field errors while the full parent draft remains',async()=>{
 const issue={code:'jobs-reference-selection-required',field:'data.location_slug',params:{kind:'location',value:'Hà Nội',resolvedValue:'hanoi'},severity:'critical'};
 const h=harness({onTransition:async()=>{throw {code:'23514',issues:[issue]};}});try{
  await h.open();await h.click('[data-action="publish"]');assert.equal(h.calls.transitions.length,1);
  assert.match(h.root.querySelector('[data-error-for="data.location_slug"]').textContent,/Choose this item from the list and save/);
  assert.equal(h.root.querySelector('[name="title_vi"]').value,record.title_vi);assert.equal(h.dom.window.document.activeElement.name,'data.location_slug');
  h.controller.setLanguage('vi');assert.match(h.root.querySelector('[data-editor-errors]').textContent,/Chọn mục này trong danh sách/);
  h.root.querySelector('[data-action="focus-issue"]').click();assert.equal(h.dom.window.document.activeElement.name,'data.location_slug');
 }finally{h.close();}
});

test('preflight issues stop transition and preserve error summary until the field is edited',async()=>{
 const issue={code:'jobs-reference-ambiguous',field:'data.category_slug',params:{kind:'category'},severity:'critical'};
 const h=harness({onValidate:async()=>[issue]});try{await h.open();await h.click('[data-action="publish"]');assert.equal(h.calls.transitions.length,0);assert.match(h.root.querySelector('[data-editor-errors]').textContent,/More than one job category/);const control=h.root.querySelector('[name="data.category_slug"]');control.dispatchEvent(new h.dom.window.Event('change',{bubbles:true}));assert.equal(h.root.querySelector('[data-editor-errors]').textContent,'');}finally{h.close();}
});

test('publication minimums, email, real calendar dates and closing date checks match the declared constraints',()=>{
 const bad={...record,title_en:'Ab',summary_vi:'Short',body_en:'Too short',data:{...record.data,contact_email:'not-an-email',closes_on:'2000-01-01'}};
 const issues=validateEntry(bad,collection,true);for(const field of ['title_en','summary_vi','body_en','data.contact_email','data.closes_on'])assert.ok(issues.some(issue=>issue.field===field),field);
 assert.match(validationText(issues.find(issue=>issue.field==='title_en'),'en'),/at least 3 characters/);assert.match(validationText(issues.find(issue=>issue.field==='title_en'),'vi'),/ít nhất 3 ký tự/);
 assert.ok(validateEntry({...record,data:{...record.data,closes_on:'2026-02-30'}},collection,true).some(issue=>issue.code==='cms-date-invalid'));
 assert.equal(validateEntry({...record,data:{...record.data,closes_on:'2096-02-29'}},collection,true).some(issue=>issue.field==='data.closes_on'),false);
 assert.equal(validateEntry({...record,title_en:'A',summary_en:'',body_en:''},collection,false).some(issue=>['title_en','summary_en','body_en'].includes(issue.field)),false,'Incomplete text remains saveable as draft');
});

test('lookup failures focus a usable retry instead of a disabled select',async()=>{
 const h=harness({referenceOptions:async kind=>{if(kind==='employer')throw Error('offline');return choices[kind];}});try{
  await h.open();await h.click('[data-action="publish"]');assert.equal(h.calls.transitions.length,0);
  assert.equal(h.root.querySelector('[name="data.employer_slug"]').disabled,true);
  const active=h.dom.window.document.activeElement;assert.ok(['reference-refresh',undefined].includes(active.dataset.action));assert.equal(active.disabled,false);assert.ok(active.closest('[data-reference-field="data.employer_slug"]'));
 }finally{h.close();}
});

test('duplicate option values prefer a published snapshot over an unpublished working entry',async()=>{
 const options=structuredClone(choices);options.employer.unshift({value:'school',label:{en:'Unpublished renamed draft',vi:'Bản nháp đổi tên'},status:'draft',published:false});
 const h=harness({options});try{
  await h.open();const select=h.root.querySelector('[name="data.employer_slug"]');assert.equal([...select.options].filter(option=>option.value==='school').length,1);assert.match(select.selectedOptions[0].textContent,/ABC School/);assert.equal(select.selectedOptions[0].disabled,false);
  await h.click('[data-action="publish"]');assert.equal(h.calls.transitions.length,1);
 }finally{h.close();}
});

test('typed inline creation values participate in the draft leave guard',async()=>{
 const h=harness();try{
  await h.open();const details=h.root.querySelector('[data-reference-create="data.employer_slug"]');details.open=true;await settle();assert.equal(h.controller.isDirty(),false,'Opening an empty panel does not dirty the vacancy');
  h.input('[data-reference-create-key="data.employer_slug"][data-reference-create-field="title_en"]','A new employer');assert.equal(h.controller.isDirty(),true);
  h.dom.window.confirm=()=>false;assert.equal(h.controller.canLeave(),false);assert.equal(h.controller.destroy(),false);assert.equal(h.root.querySelector('[name="title_en"]').value,record.title_en);
 }finally{h.close();}
});

test('publication minimums count Unicode code points like Postgres rather than UTF-16 units',()=>{
 const issues=validateEntry({...record,title_en:'😀😀'},collection,true);const issue=issues.find(item=>item.field==='title_en');assert.equal(issue.code,'cms-text-too-short');assert.equal(issue.params.count,2);
});

test('changing language during a failed save restores the current editable form',async()=>{
 let rejectSave;const pending=new Promise((_,reject)=>{rejectSave=reject;});
 const h=harness({onSave:()=>pending});try{
  await h.open();h.input('[name="body_en"]','My current draft must survive a locale change and failed save.');
  h.root.querySelector('form').dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();
  h.controller.setLanguage('vi');rejectSave(new Error('offline'));await settle();
  for(const selector of ['[name="title_en"]','[name="body_en"]','button[type="submit"]'])assert.equal(h.root.querySelector(selector).disabled,false,selector);
  assert.match(h.root.querySelector('[name="body_en"]').value,/must survive/);
 }finally{h.close();}
});
test('changing language during failed publication preflight retains editable fields and field errors',async()=>{
 let rejectCheck;const pending=new Promise((_,reject)=>{rejectCheck=reject;});
 const h=harness({onValidate:()=>pending});try{
  await h.open();h.root.querySelector('[data-action="publish"]').click();await settle();h.controller.setLanguage('vi');
  rejectCheck(Object.assign(new Error('Lookup failed'),{issues:[{code:'jobs-reference-lookup-failed',field:'data.employer_slug',params:{kind:'employer'},severity:'critical'}]}));await settle();
  assert.equal(h.root.querySelector('[name="title_en"]').disabled,false);
  assert.equal(h.root.querySelector('button[type="submit"]').disabled,false);
  assert.equal(h.root.querySelector('[name="data.employer_slug"]').getAttribute('aria-invalid'),'true');
  assert.equal(h.calls.transitions.length,0);
 }finally{h.close();}
});
