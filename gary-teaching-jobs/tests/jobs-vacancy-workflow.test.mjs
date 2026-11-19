import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {bindFeedbackDom} from './helpers/feedback-dom.mjs';
import {PGlite} from '@electric-sql/pglite';
import {mountCms} from '../dist/cms-foundation/index.js';
import {createJobsPublishingAdapter} from '../dist/jobs-publishing-adapter.js';
import {emptyEntry} from '../dist/cms-foundation/content.js';
import {mountVacancyImageEditor} from '../dist/jobs-vacancy-image.js';
import {vacancyCard} from '../dist/jobs-public-content.js';
import {vacancyImageHandler} from '../supabase/functions/jobs-vacancy-image/handler.mjs';

const admin='41000000-0000-4000-8000-000000000001';
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
async function until(predicate, message) {
  for(let attempt=0;attempt<300;attempt++) {
    if(await predicate()) return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail(message);
}
async function actualCollections() {
  const options=await import('../dist/jobs-vacancy-options.js');
  const source=(await readFile(new URL('../dist/jobs-backend.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/^export /gm,'');
  const context=vm.createContext({createClient:()=>({}),jobsConfig:{},...options});
  vm.runInContext(source+'\nglobalThis.result = collections;',context);
  return context.result;
}
function supabaseShape(pg,calls,reads,{failPublication}={}) {
  const errorResult=error=>({error:{code:error.code,message:error.message,details:error.detail}});
  return {
    from(table) {
      assert.ok(['jobs_cms_entries','jobs_public_content'].includes(table),table);
      let columns='*',filters=[],orders=[],offset=0,limit=null;
      const identifier=field=>{assert.match(field,/^[a-z_]+$/);return '"'+field+'"';};
      async function run(single=false) {
        reads.push({table,filters:structuredClone(filters)});
        if(filters.some(([field,,value])=>field==='kind'&&['employer','category','location'].includes(value))) {
          return {error:{code:'503',message:'Independent profile and taxonomy services are unavailable'}};
        }
        const values=[],where=filters.map(([field,operator,value])=>{values.push(value);return `${identifier(field)} ${operator} $${values.length}`;});
        const selection=columns==='*'?'*':columns.split(',').map(identifier).join(',');
        let sql=`select ${selection} from public.${table}`;
        if(where.length)sql+=' where '+where.join(' and ');
        if(orders.length)sql+=' order by '+orders.map(identifier).join(',');
        if(limit!==null){values.push(limit);sql+=' limit $'+values.length;}
        if(offset){values.push(offset);sql+=' offset $'+values.length;}
        try {
          const result=await pg.query(sql,values);
          if(single&&result.rows.length!==1)return {error:{code:'PGRST116',message:'Expected one row'}};
          return {data:single?result.rows[0]:result.rows};
        }catch(error){return errorResult(error);}
      }
      const builder={select(value='*'){columns=value;return builder;},eq(field,value){filters.push([field,'=',value]);return builder;},like(field,value){filters.push([field,'like',value]);return builder;},order(field){orders.push(field);return builder;},range(from,to){offset=from;limit=to-from+1;return builder;},single(){return run(true);},then(resolve,reject){return run().then(resolve,reject);}};
      return builder;
    },
    async rpc(name,args={}) {
      calls.push({name,args:structuredClone(args)});
      const failed=failPublication?.(name,args);if(failed)return {error:failed};
      try {
        if(name==='jobs_capabilities')return {data:(await pg.query('select public.jobs_capabilities() as caps')).rows[0].caps};
        if(name==='jobs_cms_save')return {data:(await pg.query('select * from public.jobs_cms_save($1,$2)',[args.p_record,args.p_expected_version])).rows[0]};
        if(name==='jobs_cms_transition')return {data:(await pg.query('select * from public.jobs_cms_transition($1,$2,$3)',[args.p_id,args.p_status,args.p_expected_version])).rows[0]};
        throw Error('Unexpected RPC '+name);
      }catch(error){return errorResult(error);}
    },
  };
}
async function setup({language='en',legacy=false,failPublication,prepare,mountVacancyImage,staffEligibility=true}={}) {
  const pg=new PGlite();
  await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,
      deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
  await pg.query('insert into auth.users values($1,$2,now())',[admin,'vacancy-publisher@example.test']);
  const migrations=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')&&(staffEligibility||file!=='20261117202945_staff_eligibility_assignment.sql')).sort();
  await pg.exec(await readFile(new URL('../supabase/migrations/'+migrations[0],import.meta.url),'utf8'));
  await pg.query("insert into jobs_private.staff_members(user_id,role) values($1,'admin')",[admin]);
  const as=async (signedIn,user=admin)=>{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[signedIn?user:'']);await pg.exec('set role '+(signedIn?'authenticated':'anon'));};
  await as(true);
  const one=async(sql,params=[])=>(await pg.query(sql,params)).rows[0];
  let original;
  if(legacy) {
    const publish=async record=>{
      let result=await one('select * from public.jobs_cms_save($1,null)',[record]);
      result=await one("select * from public.jobs_cms_transition($1,'review',$2)",[result.id,result.version]);
      return one("select * from public.jobs_cms_transition($1,'published',$2)",[result.id,result.version]);
    };
    const oldRecord=(kind,slug,data={})=>({...emptyEntry(kind),slug,title_en:'Legacy '+kind,title_vi:'Nội dung '+kind,summary_en:'Original English summary.',summary_vi:'Tóm tắt tiếng Việt ban đầu.',body_en:'Original detailed English content for this legacy record.',body_vi:'Nội dung tiếng Việt đầy đủ cho bản ghi ban đầu này.',data});
    for(const kind of ['employer','category','location'])await publish(oldRecord(kind,'legacy-'+kind));
    original=await publish(oldRecord('vacancy','legacy-teacher',{employer_slug:'legacy-employer',category_slug:'legacy-category',location_slug:'legacy-location',contact_email:'legacy@example.test',closes_on:'2099-12-31'}));
  }
  await pg.exec('reset role');
  try {
    for(const filename of migrations.slice(1))await pg.exec(await readFile(new URL('../supabase/migrations/'+filename,import.meta.url),'utf8'));
  }catch(error){await pg.close();throw error;}
  await as(true);
  const collections=await actualCollections(),calls=[],reads=[],db=supabaseShape(pg,calls,reads,{failPublication});
  const publishing=createJobsPublishingAdapter(db,{collections});
  const adapter={...publishing,mountVacancyImage,...(prepare?{prepare:record=>prepare(record,publishing.prepare)}:{}),capabilities:async()=>(await db.rpc('jobs_capabilities')).data,list:async({kind})=>{const records=(await pg.query('select * from public.jobs_cms_entries where kind=$1 order by updated_at desc',[kind])).rows;return {records,total:records.length};},revisions:async()=>[]};
  const dom=new JSDOM('<main></main>',{url:'https://jobs.garyhome.vn/portal.html'}),root=dom.window.document.querySelector('main');
  bindFeedbackDom(dom.window);

  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};dom.window.HTMLElement.prototype.scrollIntoView=function(){};dom.window.confirm=()=>true;
  const controller=mountCms(root,{appId:'jobs',collections,language,adapter});
  await controller.ready;
  const input=(key,value)=>{const control=root.querySelector(`[name="${key}"]`);assert.ok(control,key);control.value=value;control.dispatchEvent(new dom.window.Event(control.tagName==='SELECT'?'change':'input',{bubbles:true}));return control;};
  const click=async action=>{const control=root.querySelector(`[data-action="${action}"]`);assert.ok(control,action);assert.equal(control.disabled,false,`${action} must be enabled`);control.click();await settle();};
  const fill=()=>{
    input('title_en','One action teacher');input('body_en','Teach English.');input('data.employer_name_en','Independent English School');
    for(const key of ['category_slug','location_slug']) {
      const select=root.querySelector(`[name="data.${key}"]`);assert.ok(select,key);
      const choice=[...select.options].find(option=>option.value&&!option.disabled);assert.ok(choice,key+' predefined choices');input('data.'+key,choice.value);
    }
    input('data.contact_email','recruiter@example.test');input('data.closes_on','2099-12-31');
  };
  return {pg,root,dom,controller,adapter,collections,calls,reads,one,as,input,click,fill,original,async close(){controller.destroy({force:true});dom.window.close();await pg.close();}};
}

for(const language of ['en','vi'])test(`end-to-end ${language}: one Publish creates a public vacancy without independent profile or taxonomy publishing`,async()=>{
  const h=await setup({language});try {
    await h.click('new');
    assert.equal(h.root.querySelector('[data-cms-editor] button[type=submit]').dataset.buttonVariant,'save-draft');
    assert.equal(h.root.querySelector('[data-cms-editor] button[data-action=publish]').dataset.buttonVariant,'publish');
    assert.equal(h.root.querySelector('[data-cms-editor] button[data-action=archive]').dataset.buttonVariant,'archive');
    assert.equal(h.root.querySelector('[data-cms-editor] button[data-action=close]').dataset.buttonVariant,'cancel');
    const dialog=h.root.querySelector('dialog');
    for(const selector of ['[data-reference-search]','[data-action="reference-refresh"]','[data-reference-create]'])assert.equal(dialog.querySelector(selector),null,selector);
    const marker=key=>dialog.querySelector(`[name="${key}"]`).closest('label').querySelector('span small')?.textContent||'';
    const requiredMark=language==='vi'?'(Bắt buộc)':'(Required)',optionalMark=language==='vi'?'(Không bắt buộc)':'(Optional)';
    for(const key of ['title_en','body_en','data.employer_name_en','data.category_slug','data.location_slug','data.contact_email','data.closes_on'])assert.equal(marker(key),requiredMark,key+' required label');
    for(const key of ['title_vi','body_vi','summary_en','summary_vi'])assert.equal(marker(key),optionalMark,key+' optional label');
    for(const key of ['data.employer_name_vi','data.workplace_name','data.street_address'])assert.equal(marker(key),'',key+' must stay optional');
    h.fill();h.input('data.workplace_name','West branch');h.input('data.street_address','123 Example Street');
    await h.click('publish');
    await until(async()=>(await h.one("select count(*)::int n from public.jobs_public_content where kind='vacancy'")).n===1,dialog.textContent);
    const live=await h.one("select * from public.jobs_public_content where kind='vacancy'");
    assert.equal(live.title_en,'One action teacher');assert.equal(live.body_en,'Teach English.');
    assert.equal(live.title_vi,'');assert.equal(live.summary_en,'');assert.equal(live.summary_vi,'');assert.equal(live.body_vi,'');
    assert.equal(live.data.employer_name_en,'Independent English School');assert.equal(live.data.workplace_name,'West branch');assert.equal(live.data.street_address,'123 Example Street');
    assert.equal((await h.one("select count(*)::int n from public.jobs_cms_entries where kind<>'vacancy'")).n,0);
    assert.equal(h.calls.filter(call=>call.name==='jobs_cms_save').length,1);
    assert.equal(h.calls.filter(call=>call.name==='jobs_cms_transition'&&call.args.p_status==='published').length,1);
    assert.equal(h.reads.some(read=>read.filters.some(([field,,kind])=>field==='kind'&&['employer','category','location'].includes(kind))),false,'Profile/taxonomy lookups must not run');
    await h.as(false);assert.equal((await h.one("select count(*)::int n from public.jobs_public_content where kind='vacancy'")).n,1,'Anonymous visitors can read the complete vacancy');
  }finally{await h.close();}
});

test('end-to-end: invalid publication focuses exact fields, keeps entered text and publishes after correction',async()=>{
  const h=await setup();try {
    await h.click('new');h.fill();h.input('data.contact_email','invalid-email');h.input('data.employer_name_en','   ');
    await h.click('publish');
    assert.equal((await h.one("select count(*)::int n from public.jobs_public_content where kind='vacancy'")).n,0);
    for(const key of ['data.contact_email','data.employer_name_en']) {
      assert.equal(h.root.querySelector(`[name="${key}"]`).getAttribute('aria-invalid'),'true',key);
      assert.ok(h.root.querySelector(`[data-error-for="${key}"]`).textContent.trim(),key+' error text');
    }
    assert.ok(['data.employer_name_en','data.contact_email'].includes(h.dom.window.document.activeElement.name));
    assert.equal(h.root.querySelector('[name="body_en"]').value,'Teach English.');
    h.input('data.employer_name_en','Independent School');h.input('data.contact_email','correct@example.test');
    await h.click('publish');
    await until(async()=>(await h.one("select count(*)::int n from public.jobs_public_content where kind='vacancy'")).n===1,h.root.querySelector('dialog').textContent);
  }finally{await h.close();}
});

test('end-to-end: editing a published vacancy preserves its public snapshot until a single republish',async()=>{
  const h=await setup();try {
    await h.click('new');h.fill();await h.click('publish');
    await until(async()=>(await h.one("select count(*)::int n from public.jobs_public_content where kind='vacancy'")).n===1,h.root.querySelector('dialog').textContent);
    const before=await h.one("select * from public.jobs_public_content where kind='vacancy'");
    await until(()=>h.dom.window.document.querySelector('[data-cms-success]')?.isConnected,'Publication should close the editor and show confirmation');
    assert.equal(h.root.querySelector('.cms-dialog').open,false);assert.equal(h.controller.isDirty(),false);
    h.dom.window.document.querySelector('[data-success-close]').click();await settle();
    await h.click('edit');
    h.input('title_en','Updated teacher title');h.input('body_en','Updated English teaching details.');
    assert.equal((await h.one('select title_en from public.jobs_public_content where id=$1',[before.id])).title_en,'One action teacher');
    await h.click('publish');
    await until(async()=>(await h.one('select title_en from public.jobs_public_content where id=$1',[before.id])).title_en==='Updated teacher title',h.root.querySelector('dialog').textContent);
    const live=await h.one('select * from public.jobs_public_content where id=$1',[before.id]);
    assert.equal(live.slug,before.slug);assert.equal(live.id,before.id);assert.equal(live.body_en,'Updated English teaching details.');
    assert.equal((await h.one("select count(*)::int n from public.jobs_cms_entries where kind='vacancy'")).n,1);
  }finally{await h.close();}
});

test('featured image migration works without the optional staff eligibility migration',async()=>{
  const h=await setup({staffEligibility:false});
  const uploader='41000000-0000-4000-8000-000000000002';
  try {
    const dependency=await h.one("select to_regprocedure('jobs_private.staff_identity_eligible(uuid)') as helper");
    assert.equal(dependency.helper,null);
    await h.pg.exec('reset role');
    await h.pg.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uploader,'vacancy-editor@example.test']);
    await h.pg.query("insert into jobs_private.staff_members(user_id,role) values($1,'editor')",[uploader]);
    await h.as(true,uploader);
    const draft=await h.one('select * from public.jobs_cms_save($1,null)',[
      {...emptyEntry('vacancy'),slug:'image-migration-fixture',title_en:'Test vacancy'},
    ]);
    const {id}=await h.one("select public.jobs_vacancy_image_reserve($1,'image/png',128,32,32) as id",[draft.id]);
    const finalize='select public.jobs_vacancy_image_ready($1) as ready';
    await assert.rejects(()=>h.one(finalize,[id]),/permission denied/);
    await h.pg.exec("reset role;select set_config('request.jwt.claim.sub','',false)");

    async function ready() {
      await h.pg.exec('set role service_role');
      try {return (await h.one(finalize,[id])).ready;}
      finally {await h.pg.exec('reset role');}
    }
    assert.equal(await ready(),false,'the Storage object must exist');
    await h.pg.query("insert into storage.objects(bucket_id,name) values('jobs-vacancy-images',$1)",[id]);

    for (const [column,blocked,eligible] of [
      ['email_confirmed_at','null','now()'],
      ['deleted_at','now()','null'],
      ['is_anonymous','true','false'],
      ['banned_until',"now()+interval '1 day'",'null'],
    ]) {
      await h.pg.query(`update auth.users set ${column}=${blocked} where id=$1`,[uploader]);
      assert.equal(await ready(),false,`${column} blocks finalization`);
      await h.pg.query(`update auth.users set ${column}=${eligible} where id=$1`,[uploader]);
    }
    await h.pg.query('update jobs_private.staff_members set active=false where user_id=$1',[uploader]);
    assert.equal(await ready(),false,'an inactive staff membership blocks finalization');
    await h.pg.query("update jobs_private.staff_members set active=true,role='recruiter' where user_id=$1",[uploader]);
    assert.equal(await ready(),false,'a recruiter cannot finalize a CMS image');
    await h.pg.query("update jobs_private.staff_members set role='editor' where user_id=$1",[uploader]);
    assert.equal(await ready(),true);
  }finally {await h.close();}
});

test('featured vacancy image survives drafts, replacement, archive, republication and removal',async()=>{
  const bucket='jobs-vacancy-images', origin='https://supabase.example.test';
  const files=new Map(), progressSeen=[];
  let h;
  const system=async(role, operation)=>{
    await h.pg.exec('reset role');
    if(role) await h.pg.exec('set role '+role);
    try {return await operation();} finally {await h.as(true);}
  };
  const handler=vacancyImageHandler({
    url:origin,publishableKey:'test-publishable',serviceKey:'test-server',cleanupKey:'test-cleanup',
    async fetcher(url,options){
      const name=url.split('/').pop(), args=options.body&&typeof options.body==='string'?JSON.parse(options.body):{};
      if(name==='jobs_vacancy_image_reserve'){
        assert.equal(options.headers.authorization,'Bearer test-staff');
        const result=await h.one('select public.jobs_vacancy_image_reserve($1,$2,$3,$4,$5) as result',Object.values(args));
        return Response.json(result.result);
      }
      assert.equal(options.headers.authorization,'Bearer test-server');
      if(url.includes('/rpc/')) {
        const query={
          jobs_vacancy_image_ready:'select public.jobs_vacancy_image_ready($1) as result',
          jobs_vacancy_image_published_mime:'select public.jobs_vacancy_image_published_mime($1) as result',
          jobs_vacancy_image_cleanup_claim:'select coalesce(array_agg(id),array[]::uuid[]) result from public.jobs_vacancy_image_cleanup_claim() id',
          jobs_vacancy_image_cleanup_finish:'select public.jobs_vacancy_image_cleanup_finish($1) as result',
        }[name];
        assert.ok(query,name);
        const {result}=await system('service_role',()=>h.one(query,Object.values(args)));
        return Response.json(result ?? null);
      }
      if(options.method==='POST'){
        assert.equal(options.headers['x-upsert'],'false');
        files.set(name,options.body);
        await system('',()=>h.pg.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,name]));
        return Response.json({Key:bucket+'/'+name});
      }
      if(options.method==='DELETE'){
        for(const id of args.prefixes)files.delete(id);
        await system('',()=>h.pg.query('delete from storage.objects where bucket_id=$1 and name=any($2::text[])',[bucket,args.prefixes]));
        return Response.json([]);
      }
      return files.has(name)?new Response(files.get(name)):new Response(null,{status:404});
    },
  });
  const call=(query,options)=>handler(new Request(origin+'/functions/v1/jobs-vacancy-image?'+query,options));
  const send=(id,file)=>call('vacancy='+id,{method:'POST',body:file,headers:{authorization:'Bearer test-staff','content-type':file.type}});
  h=await setup({mountVacancyImage:(root,options)=>mountVacancyImageEditor(root,{
    ...options,preview:async id=>origin+'/'+id,
    async upload(id,file,reportProgress){
      reportProgress(.5);progressSeen.push(root.querySelector('progress').value);
      const result=await send(id,file);
      assert.equal(result.status,201);
      return result.json();
    },
  })});
  try {
    const win=h.root.ownerDocument.defaultView;
    win.URL.createObjectURL=()=> 'blob:test-selected-image';
    win.URL.revokeObjectURL=()=>{};
    const bytes=await readFile(new URL('../dist/assets/favicon-32.png',import.meta.url));
    const file=new File([bytes],'school.png',{type:'image/png'});
    const entry=()=>h.one("select * from public.jobs_cms_entries where kind='vacancy'");
    const published=async()=>{
      await h.as(false);
      try {return await h.one("select * from public.jobs_public_content where kind='vacancy'");}
      finally {await h.as(true);}
    };
    const select=async text=>{
      const input=h.root.querySelector('[data-image-file]');
      Object.defineProperty(input,'files',{value:[file]});
      input.dispatchEvent(new win.Event('change',{bubbles:true}));
      assert.equal(h.root.querySelector('[data-image-preview]').getAttribute('src'),'blob:test-selected-image');
      const alt=h.root.querySelector('[data-image-alt="en"]');
      alt.value=text;
      alt.dispatchEvent(new win.Event('input',{bubbles:true}));
      assert.equal(h.root.querySelector('[data-image-preview]').alt,text);
      h.root.querySelector('[data-image-alt="vi"]').value='Lớp học';
      h.root.querySelector('[data-image-upload]').click();
      await until(async()=>(await entry()).data.vacancy_image?.alt_en===text,'vacancy image attached');
      await settle();
      return (await entry()).data.vacancy_image.id;
    };
    await h.click('new');
    assert.equal(h.root.querySelector('[data-image-file]'),null,'image upload awaits saved draft');
    h.fill();h.root.querySelector('button[type=submit]').click();
    await until(async()=>Boolean(await entry()),'vacancy draft saved');
    await settle();
    const first=await select('First classroom');
    assert.equal(await published(),undefined);
    assert.equal((await call('image='+first)).status,404,'draft image is private');
    await h.click('publish');
    await until(async()=>Boolean(await published()),'vacancy published');
    await settle();
    const card=vacancyCard(await published(),0,[],'vi');
    assert.match(card.image.url,new RegExp(first+'$'));
    assert.equal(card.image.alt[1],'Lớp học');
    const delivered=await call('image='+first);
    assert.equal(delivered.status,200);
    assert.equal(delivered.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await delivered.arrayBuffer()),bytes);
    assert.equal((await call('image='+first,{headers:{'if-none-match':delivered.headers.get('etag')}})).status,304);
    await h.click('edit');
    const second=await select('Replacement classroom');
    assert.notEqual(first,second);
    assert.equal((await published()).data.vacancy_image.id,first,'live snapshot keeps previous image');
    await h.click('archive');
    await until(async()=>!await published(),'vacancy unpublished');
    await settle();
    assert.equal((await call('image='+first,{headers:{'if-none-match':delivered.headers.get('etag')}})).status,404);
    assert.equal((await entry()).data.vacancy_image.id,second);
    await h.click('publish');
    await until(async()=>Boolean(await published()),'vacancy republished');
    await settle();
    assert.equal((await published()).data.vacancy_image.id,second);
    assert.equal((await call('image='+second)).status,200);
    assert.equal((await call('image='+first)).status,404);
    await h.click('edit');h.root.querySelector('[data-image-remove]').click();
    await until(async()=>!(await entry()).data.vacancy_image,'draft image removed');
    await settle();
    await h.click('publish');
    await until(async()=>!(await published()).data.vacancy_image,'public image removed');
    await settle();
    assert.equal((await call('image='+second)).status,404);
    assert.deepEqual(progressSeen,[.5,.5]);

    const saved=await entry();
    await assert.rejects(()=>h.one('select public.jobs_vacancy_image_ready($1)',[first]),/permission/);
    await assert.rejects(()=>h.pg.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,'arbitrary']),/policy/);
    await assert.rejects(()=>h.one('select * from public.jobs_cms_save($1,$2)',[
      {...saved,data:{...saved.data,vacancy_image:{id:first,width:1,height:1,alt_en:'Forged dimensions',alt_vi:''}}},saved.version,
    ]),/vacancy_image_invalid/);
    await assert.rejects(()=>h.one('select * from public.jobs_cms_save($1,0)',[
      {...emptyEntry('vacancy'),slug:'another-draft',title_en:'Another vacancy',data:{vacancy_image:{
        id:first,width:32,height:32,alt_en:'Image from another vacancy',alt_vi:'',
      }}},
    ]),/vacancy_image_invalid/);
    const abandoned=await (await send(saved.id,file)).json();
    await system('',()=>h.pg.query("update jobs_private.vacancy_images set created_at=now()-interval '2 days'"));
    assert.equal((await call('cleanup=1',{method:'POST'})).status,403);
    assert.deepEqual(await (await call('cleanup=1',{method:'POST',headers:{'x-jobs-cleanup-key':'test-cleanup'}})).json(),{processed:1});
    assert.equal(files.has(abandoned.id),false);
    assert.equal(files.has(first)&&files.has(second),true,'referenced revisions retain their files');
  }finally {await h.close();}
});

test('end-to-end: old published vacancies survive migration and remain editable with preserved legacy values',async()=>{
  const h=await setup({legacy:true});try {
    const original=await h.one('select * from public.jobs_public_content where id=$1',[h.original.id]);
    assert.deepEqual(original.data,h.original.data,'Migration must not rewrite the old published snapshot');
    await h.click('edit');h.input('title_en','Edited legacy teaching vacancy');h.input('data.employer_name_en','Legacy School');
    // Legacy values remain stored until an editor deliberately chooses a replacement.
    assert.equal(h.root.querySelector('[name="data.category_slug"]').value,'legacy-category');
    assert.equal(h.root.querySelector('[name="data.location_slug"]').value,'legacy-location');
    h.root.querySelector('form').dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();
    await until(async()=>(await h.one('select title_en from public.jobs_cms_entries where id=$1',[h.original.id])).title_en==='Edited legacy teaching vacancy',h.root.querySelector('dialog').textContent);
    assert.deepEqual((await h.one('select data from public.jobs_public_content where id=$1',[h.original.id])).data,original.data,'Saving an edit must preserve the live snapshot');
    await until(()=>h.root.querySelector('[data-action="publish"]')?.disabled===false,'Legacy publication action should be available');
    await h.click('publish');
    await until(async()=>(await h.one('select title_en from public.jobs_public_content where id=$1',[h.original.id])).title_en==='Edited legacy teaching vacancy',h.root.querySelector('dialog').textContent);
    const live=await h.one('select * from public.jobs_public_content where id=$1',[h.original.id]);
    assert.equal(live.slug,'legacy-teacher');assert.equal(live.data.employer_name_en,'Legacy School');
    assert.equal(live.data.category_slug,'legacy-category');assert.equal(live.data.location_slug,'legacy-location');
    assert.equal((await h.one("select count(*)::int n from public.jobs_cms_entries where kind='vacancy'")).n,1);
  }finally{await h.close();}
});

test('end-to-end: server field errors retain the saved draft identity and retry publishes without duplicates',async()=>{
  let failOnce=true;
  const issue={code:'cms-field-required',field:'data.employer_name_en',params:{field:'Employer name (English)'},severity:'critical'};
  const h=await setup({failPublication(name,args){
    if(failOnce&&name==='jobs_cms_transition'&&args.p_status==='published') {
      failOnce=false;
      return {code:'23514',message:'jobs.publication_invalid',details:JSON.stringify({issues:[issue]})};
    }
  }});
  try {
    await h.click('new');h.fill();await h.click('publish');
    await until(()=>h.root.querySelector('[name="data.employer_name_en"]')?.getAttribute('aria-invalid')==='true',h.root.querySelector('dialog').textContent);
    assert.equal(h.dom.window.document.activeElement.name,'data.employer_name_en');
    assert.ok(h.root.querySelector('[data-error-for="data.employer_name_en"]').textContent.trim());
    assert.equal(h.root.querySelector('[name="body_en"]').value,'Teach English.');
    assert.equal((await h.one("select count(*)::int n from public.jobs_cms_entries where kind='vacancy'")).n,1);
    const draft=await h.one("select * from public.jobs_cms_entries where kind='vacancy'");
    h.controller.setLanguage('vi');
    assert.equal(h.root.querySelector('[name="data.employer_name_en"]').getAttribute('aria-invalid'),'true');
    h.input('data.employer_name_en','Independent School corrected');await h.click('publish');
    await until(async()=>(await h.one("select count(*)::int n from public.jobs_public_content where kind='vacancy'")).n===1,h.root.querySelector('dialog').textContent);
    assert.equal((await h.one("select count(*)::int n from public.jobs_cms_entries where kind='vacancy'")).n,1,'Retry must reuse the saved draft');
    const live=await h.one("select * from public.jobs_public_content where kind='vacancy'");
    assert.equal(live.id,draft.id);assert.equal(live.data.employer_name_en,'Independent School corrected');
  }finally{await h.close();}
});


test('end-to-end: delayed legacy preparation cannot replace a newer draft after a collection switch',async()=>{
  let finishLegacy,started=false;
  const delayed=new Promise(resolve=>{finishLegacy=resolve;});
  const h=await setup({legacy:true,prepare:async(record,defaultPrepare)=>{
    if(record.id&&record.kind==='vacancy'){started=true;await delayed;}
    return defaultPrepare(record);
  }});
  try {
    await h.click('edit');assert.equal(started,true,'Legacy preparation should be pending');
    const guides=h.root.querySelector('[data-action="collection"][data-kind="guide"]');assert.ok(guides);guides.click();await settle();
    await h.click('new');h.input('title_en','A new guide draft must stay selected');h.input('body_en','Current guide details.');
    finishLegacy();await settle();
    assert.equal(h.root.querySelector('[data-action="collection"][data-kind="guide"]').getAttribute('aria-pressed'),'true');
    assert.equal(h.root.querySelector('dialog').open,true);
    assert.equal(h.root.querySelector('[name="title_en"]').value,'A new guide draft must stay selected');
    assert.equal(h.root.querySelector('[name="body_en"]').value,'Current guide details.');
    assert.equal(h.root.querySelector('[name="data.employer_name_en"]'),null,'Stale vacancy must not reopen over the guide');
    assert.equal(h.controller.isDirty(),true);
  }finally{finishLegacy();await settle();await h.close();}
});

test('end-to-end: an invalid existing category remains saveable as draft but Publish requires its correction',async()=>{
  const h=await setup();try {
    const input={...emptyEntry('vacancy'),title_en:'A vacancy needing category correction',body_en:'Teach English.',data:{employer_name_en:'British Council',category_slug:'british-council',location_slug:'hanoi',contact_email:'recruiter@example.test',closes_on:'2099-12-31'}};
    const saved=await h.adapter.save(input,{expectedVersion:0});
    await h.controller.refresh();await h.click('edit');h.input('body_en','The draft can keep its category until it is corrected.');
    h.root.querySelector('form').dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();
    await until(async()=>(await h.one('select body_en from public.jobs_cms_entries where id=$1',[saved.id])).body_en==='The draft can keep its category until it is corrected.',h.root.querySelector('dialog').textContent);
    const draft=await h.one('select * from public.jobs_cms_entries where id=$1',[saved.id]);
    assert.equal(draft.status,'draft');assert.equal(draft.data.category_slug,'british-council');
    await until(()=>h.root.querySelector('[data-action="publish"]')?.disabled===false,'Draft save should finish');
    const before=h.calls.filter(call=>call.name==='jobs_cms_transition').length;await h.click('publish');
    assert.equal(h.root.querySelector('[name="data.category_slug"]').getAttribute('aria-invalid'),'true');
    assert.equal(h.dom.window.document.activeElement.name,'data.category_slug');
    assert.ok(h.root.querySelector('[data-error-for="data.category_slug"]').textContent.trim());
    assert.equal(h.calls.filter(call=>call.name==='jobs_cms_transition').length,before,'Invalid category must stop before publication');
    assert.equal((await h.one('select count(*)::int n from public.jobs_public_content where id=$1',[saved.id])).n,0);
    h.input('data.category_slug','centers');await h.click('publish');
    await until(async()=>(await h.one('select count(*)::int n from public.jobs_public_content where id=$1',[saved.id])).n===1,h.root.querySelector('dialog').textContent);
    assert.equal((await h.one('select data from public.jobs_public_content where id=$1',[saved.id])).data.category_slug,'centers');
    assert.equal((await h.one("select count(*)::int n from public.jobs_cms_entries where kind='vacancy'")).n,1);
  }finally{await h.close();}
});
