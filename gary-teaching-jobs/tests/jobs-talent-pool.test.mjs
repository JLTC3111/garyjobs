import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createTalentAdapter, filterCandidates} from '../dist/jobs-talent-data.js';
import {mountTalentPool} from '../dist/jobs-talent-pool.js';
import {mountTeacherShowcase, publicTeacherProfiles} from '../dist/jobs-teacher-showcase.js';
import {staffPortal} from './helpers/jobs-staff-portal.mjs';

const settle = async () => { await new Promise(resolve=>setImmediate(resolve)); };
const backend = 'https://jobs-fixture.supabase.co';
const portraitUrl = (bucket='jobs-showcase-portraits') =>
  `${backend}/storage/v1/object/sign/${bucket}/profile/portrait.webp?token=fixture`;
const candidate = {
  id:'candidate-1', source:'talent', version:2, full_name:'Đặng Minh', email:'minh@example.test',
  location:'Hà Nội', specialty:'primary', experience_years:3.5, availability:'now', stage:'interview',
  internal_note:'Recruiter note <private>', portrait_url:portraitUrl('jobs-talent-portraits'),
  applications:[{id:'app-1',vacancy_title:'Primary teacher',receipt_code:'GJ-TEST',stage:'interview'}]
};
const profile = {
  public_name:'Minh Đặng', specialty_en:'Primary teaching', specialty_vi:'Giảng dạy tiểu học',
  story_en:'My first week teaching in Hanoi.', story_vi:'Tuần đầu giảng dạy tại Hà Nội.'
};
const publishable = {...profile,status:'draft',version:3,placement_confirmed:true,consent_confirmed:true,portrait_ready:true};

function workspace({rows=[candidate], writable=true, canPublish=false, options={}, allowed=()=>true}={}) {
  const dom = new JSDOM('<main></main>',{pretendToBeVisual:true});
  const w=dom.window, root=w.document.querySelector('main');
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.confirm=()=>true;
  const calls={list:[],save:[],visibility:[],notify:[],application:[]};
  const adapter={
    async list({filters,language}){calls.list.push(filters);const records=filterCandidates(rows,filters,language);return {records,total:records.length,writable};},
    async profile(row){return row;},
    async save(values,row){
      calls.save.push({values,row});
      const result={...row,id:row?.id||'created-profile',source:'talent',...values,version:(row?.version||0)+1};
      const index=rows.findIndex(item=>item.id===result.id);
      if(index<0)rows.push(result);else rows[index]=result;
      return result;
    },
    async setShowcaseVisibility(record,publish){
      calls.visibility.push({record,publish});return {...record.showcase,status:publish?'published':'draft',version:record.showcase.version+1};
    },
    ...options
  };
  const controller=mountTalentPool(root,{adapter,canPublish,allowed,notify:message=>calls.notify.push(message),openApplication:id=>calls.application.push(id)});
  const get = selector => root.querySelector(selector);
  const click = async key => {get(`[data-talent-action="${key}"]`).click();await settle();};
  const update = (form,name,value) => {
    const node=get(`${form} [name="${name}"]`);
    node.value=value;
    node.dispatchEvent(new w.Event('input',{bubbles:true}));
  };
  const submit=async form=>{get(form).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle();};
  return {w,root,get,click,update,submit,calls,controller,close(){controller.destroy();w.close();}};
}

test('directory and photo cards share records and filters, and open a translated recruiter profile',async()=>{
  const h=workspace({rows:[candidate,{...candidate,id:'other',full_name:'Taylor Green',email:'taylor@example.test',location:'Da Nang',experience_years:null}]});
  try {
    await h.controller.ready;
    const filters='[data-talent-filters]';
    for(const [name,value] of Object.entries({query:'Dang',location:'ha noi',stage:'interview',specialty:'primary',min_experience:'3',availability:'now'})) h.update(filters,name,value);
    await h.submit(filters);
    assert.equal(h.get('tbody').rows.length,1);
    assert.match(h.get('tbody').textContent,/Đặng Minh/);
    assert.doesNotMatch(h.root.textContent,/Recruiter note/);
    const previousReads=h.calls.list.length;
    h.get('[data-talent-view=cards]').click();
    assert.equal(h.calls.list.length,previousReads);
    assert.equal(h.get('[data-talent-view=cards]').getAttribute('aria-pressed'),'true');
    assert.equal(h.get('.talent-card h2').textContent,candidate.full_name);
    assert.equal(h.get('.talent-card img').src,candidate.portrait_url);
    await h.click('open');
    assert.equal(h.get('dialog').open,true);
    assert.match(h.get('dialog').textContent,/Recruiter note <private>/);
    assert.equal(h.get('dialog private'),null);
    assert.match(h.get('dialog').textContent,/GJ-TEST/);
    await h.click('application');
    assert.deepEqual(h.calls.application,['app-1']);
    h.controller.setLanguage('vi');
    assert.match(h.get('dialog').textContent,/Phỏng vấn/);
    await h.click('close');
    assert.equal(h.get('dialog').open,false);
    assert.equal(h.w.document.activeElement.id,'talent-title');
  } finally { h.close(); }
});

test('creation normalizes email, rejects a visible duplicate, and editing saves the existing version',async()=>{
  const h=workspace();
  const editor='[data-talent-editor]';
  try {
    await h.controller.ready;
    await h.click('new');
    h.update(editor,'full_name','Alternative');
    h.update(editor,'email','MINH@Example.Test');
    await h.submit(editor);
    assert.equal(h.calls.save.length,0);
    assert.match(h.get('[role=alert]').textContent,/already exists/);
    h.update(editor,'email',' New@Example.Test ');
    h.update(editor,'experience_years','0');
    h.controller.setLanguage('vi');
    assert.equal(h.get(`${editor} [name=full_name]`).value,'Alternative');
    await h.submit(editor);
    assert.equal(h.calls.save[0].values.email,'new@example.test');
    assert.equal(h.calls.save[0].values.stage,'new');
    assert.equal(h.calls.save[0].values.experience_years,0);
    assert.equal(h.calls.save[0].row,null);
    assert.equal(h.calls.notify[0],'Đã lưu ứng viên.');
    await h.click('edit');
    h.update(editor,'stage','placed');
    await h.submit(editor);
    assert.equal(h.calls.save[1].row.version,1);
    assert.equal(h.calls.save[1].values.stage,'placed');
    assert.match(h.get('dialog [data-stage=placed]').textContent,/Đã bố trí việc làm/);
  } finally { h.close(); }
});

test('a server-side duplicate keeps unsaved edits and emits no success',async()=>{
  const h=workspace({rows:[],options:{async save(){throw {code:'23505'};}}});
  try {
    await h.controller.ready;
    await h.click('new');
    h.update('[data-talent-editor]','full_name','On another page');
    h.update('[data-talent-editor]','email','elsewhere@example.test');
    await h.submit('[data-talent-editor]');
    assert.equal(h.get('dialog').open,true);
    assert.equal(h.get('input[name=full_name]').value,'On another page');
    assert.match(h.get('[role=alert]').textContent,/already exists/);
    assert.equal(h.calls.notify.length,0);
    h.w.confirm=()=>false;
    assert.equal(h.controller.canLeave(),false);
  } finally { h.close(); }
});

test('placement and revision-specific consent gate publishing in the recruiter workspace',async()=>{
  for(const [canPublish,consent] of [[true,false],[false,true],[true,true]]) {
    const h=workspace({canPublish,rows:[{...candidate,stage:'placed',showcase:{...publishable,consent_confirmed:consent}}]});
    try {
      await h.controller.ready;
      await h.click('open');
      const button=h.get('[data-talent-action=publish]');
      if(!canPublish){assert.equal(button,null);continue;}
      assert.equal(button.disabled,!consent);
      button.click();
      await settle();
      assert.equal(h.calls.visibility.length,consent?1:0);
      if(consent)assert.equal(h.calls.visibility[0].record.showcase.version,3);
    } finally { h.close(); }
  }
});

test('saving a bilingual story draft sends only the approved public field types',async()=>{
  let sent;
  const h=workspace({canPublish:true,options:{async saveShowcase(record,fields){
    sent={record,fields};
    return {...fields,status:'draft',version:1,placement_confirmed:true,consent_confirmed:false,portrait_ready:true};
  }}});
  try{
    await h.controller.ready;
    await h.click('open');
    await h.click('draft');
    for(const [field,value] of Object.entries(profile)) h.update('[data-talent-editor]',field,value);
    await h.submit('[data-talent-editor]');
    assert.equal(sent.record.id,candidate.id);
    assert.deepEqual(sent.fields,profile);
    assert.equal(h.get('[data-talent-action=publish]').disabled,true);
    assert.deepEqual(h.calls.notify,['Story draft saved.']);
  }finally{h.close();}
});

test('the existing-applicant adapter falls back only for a missing directory RPC',async()=>{
  const guard = {code:'42501'};
  const filters={};
  for(const error of [{code:'PGRST202'}, guard]){
    const tables=[];
    const existing={id:'applicant-1',full_name:'A Teacher',email:'a@example.test',current_location:'Hanoi',jobs_applications:[{stage:'hired'}]};
    const query=data=>({
      select(){return this;},order(){return this;},eq(){return this;},limit(){return this;},range(){return this;},
      maybeSingle(){return {...this,abortSignal:()=>Promise.resolve({data:data[0]})};},
      abortSignal:()=>Promise.resolve({data})
    });
    const db={rpc:()=>({abortSignal:()=>Promise.resolve({error})}),from(table){tables.push(table);return query([existing]);}};
    const adapter=createTalentAdapter({db,unwrap:result=>{if(result.error)throw result.error;return result.data;},deadline:promise=>promise,backend});
    const signal=new AbortController().signal;
    if(error===guard){
      await assert.rejects(adapter.list({filters,page:0,language:'en',signal}),e=>e===guard);
      assert.deepEqual(tables,[]);
    }else{
      const result=await adapter.list({filters,page:0,language:'en',signal});
      assert.equal(result.writable,false);
      assert.equal(result.records[0].stage,'placed');
      const detail=await adapter.profile(result.records[0],{writable:false,signal});
      assert.equal(detail.source,'applicant');
      assert.deepEqual(tables,['jobs_candidates','jobs_candidates']);
      const h=workspace({writable:false,rows:result.records});
      try {
        await h.controller.ready; assert.equal(h.get('[data-talent-action=new]').disabled,true);
        await h.click('open'); assert.equal(h.get('[data-talent-action=edit]'),null);
      } finally { h.close(); }
    }
  }
});

test('destroying a Talent Pool aborts pending reads and clears the recruiter view',async()=>{
  let finish, signal;
  const pending=new Promise(resolve=>{finish=resolve;});
  const h=workspace({options:{list:request=>{signal=request.signal;return pending;}}});
  h.controller.destroy();
  assert.equal(signal.aborted,true);
  finish({records:[candidate],total:1,writable:true});
  await h.controller.ready;
  assert.equal(h.root.childElementCount,0);
  h.w.close();
});

test('staff and candidate portal entry points keep Talent Pool behind confirmed recruitment permission',async()=>{
  for(const [access,caps,expected] of [
    ['staff',{recruit:true},true], ['staff',{read:true,publish:true},false], ['candidate',{recruit:true},false]
  ]){
    let reads=0;
    const h=await staffPortal({access,caps,view:'talent',talent:{async list(){
      reads++;return {records:[candidate],total:1,writable:true};
    }}});
    try{
      assert.equal(!!h.doc.querySelector('[data-jobs-nav-group=recruitment] [data-view=talent]'),expected);
      assert.equal(!!h.doc.querySelector('#talent-title'),expected);
      assert.equal(reads,expected?1:0);
      if(expected){
        await h.click('#portal-language');
        assert.equal(h.doc.querySelector('#talent-title').textContent,'Nguồn ứng viên');
        assert.equal(reads,1);
        await h.click('[data-view=applications]');
        assert.equal(h.doc.querySelector('#talent-title'),null);
      }
    }finally{await h.close();}
  }
});

test('public showcase renders only approved and consented profiles with dedicated portraits',async()=>{
  const valid={...profile,public_id:'teacher-1',status:'published',placement_confirmed:true,consent_confirmed:true,
    approval_confirmed:true,portrait_url:portraitUrl(),internal_note:'private note',candidate_id:'secret-candidate',email:'hidden@example.test',
    cv_url:'private-cv',story_en:'Approved story with <script text>.'};
  const rows=[{...valid,public_id:'draft',status:'draft'},{...valid,public_id:'no-consent',consent_confirmed:false},
    {...valid,public_id:'no-approval',approval_confirmed:false},{...valid,public_id:'no-placement',placement_confirmed:false},
    {...valid,public_id:'private-photo',portrait_url:portraitUrl('jobs-talent-portraits')},valid,{...valid}];
  const output=publicTeacherProfiles(rows,backend);
  assert.equal(output.length,1);
  assert.deepEqual(Object.keys(output[0]),['portrait','public_name','specialty_en','specialty_vi','story_en','story_vi']);
  const dom=new JSDOM('<section id="teacher-showcase" hidden></section>'),doc=dom.window.document;
  const expires_at=new Date(Date.now()+60_000).toISOString();
  const display=mountTeacherShowcase(doc,{backend,read:async()=>({profiles:rows,expires_at})});
  try{
    await display.ready;
    assert.equal(doc.querySelectorAll('.teacher-card').length,1);
    assert.match(doc.querySelector('.teacher-card-story').textContent,/<script text>/);
    assert.equal(doc.querySelector('script'),null);
    assert.doesNotMatch(doc.body.innerHTML,/private note|hidden@example.test|secret-candidate|private-cv/);
    doc.documentElement.lang='vi';
    doc.dispatchEvent(new dom.window.Event('jobs:public-render'));
    assert.equal(doc.querySelector('.teacher-card-story').textContent,profile.story_vi);
    assert.equal(doc.querySelector('#teacher-showcase').hidden,false);
  }finally{ display.destroy();dom.window.close(); }
});

test('the showcase stays hidden when the public read is unavailable or expired',async()=>{
  const dom=new JSDOM('<section id="teacher-showcase" hidden></section>'),doc=dom.window.document;
  const otherwiseEligible={...profile,public_id:'teacher-1',status:'published',placement_confirmed:true,consent_confirmed:true,
    approval_confirmed:true,portrait_url:portraitUrl()};
  for(const read of [async()=>{throw new Error('Unavailable');},async()=>({profiles:[otherwiseEligible],expires_at:'2020-01-01T00:00:00Z'})]){
    const display=mountTeacherShowcase(doc,{backend,read});
    try{
      await display.ready;
      assert.equal(doc.getElementById('teacher-showcase').hidden,true);
      assert.equal(doc.querySelector('.teacher-card'),null);
    }finally{display.destroy();}
  }
  dom.window.close();
});
