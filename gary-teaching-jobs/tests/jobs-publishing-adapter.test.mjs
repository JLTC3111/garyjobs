import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import * as vacancyOptions from '../dist/jobs-vacancy-options.js';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {createJobsPublishingAdapter} from '../dist/jobs-publishing-adapter.js';
import {emptyEntry} from '../dist/cms-foundation/content.js';

const ids = {admin:'40000000-0000-4000-8000-000000000001',publisher:'40000000-0000-4000-8000-000000000002',editor:'40000000-0000-4000-8000-000000000003'};
const source = (await readFile(new URL('../dist/jobs-backend.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/^export /gm,'');
const context = vm.createContext({createClient:()=>({}),jobsConfig:{},...vacancyOptions});
vm.runInContext(source+'\nglobalThis.testCollections = collections;',context);
const collections = context.testCollections;

function supabaseShape(pg, calls, intercept, interceptRead) {
  const allowedTables = new Set(['jobs_cms_entries','jobs_public_content']);
  const errorResult = error => ({error:{code:error.code,message:error.message,details:error.detail}});
  return {
    from(table) {
      assert.ok(allowedTables.has(table),table);
      let columns='*',filters=[],orders=[],offset=0,limit=null;
      const identifier = field => { assert.match(field,/^[a-z_]+$/);return '"'+field+'"'; };
      async function run(single=false) {
        const intercepted=interceptRead?.(table,filters);if(intercepted)return intercepted;
        const values=[];
        const where=filters.map(([field,operator,value])=>{values.push(value);return `${identifier(field)} ${operator} $${values.length}`;});
        const selection=columns==='*'?'*':columns.split(',').map(identifier).join(',');
        let sql=`select ${selection} from public.${table}`;
        if(where.length)sql+=' where '+where.join(' and ');
        if(orders.length)sql+=' order by '+orders.map(identifier).join(',');
        if(limit!==null){values.push(limit);sql+=' limit $'+values.length;}
        if(offset){values.push(offset);sql+=' offset $'+values.length;}
        try{
          const result=await pg.query(sql,values);
          if(single&&result.rows.length!==1)return {error:{code:'PGRST116',message:'Expected exactly one row'}};
          return {data:single?result.rows[0]:result.rows};
        }catch(error){return errorResult(error);}
      }
      const builder={
        select(value='*'){columns=value;return builder;},
        eq(field,value){filters.push([field,'=',value]);return builder;},
        like(field,value){filters.push([field,'like',value]);return builder;},
        order(field){orders.push(field);return builder;},
        range(from,to){offset=from;limit=to-from+1;return builder;},
        single(){return run(true);},
        then(resolve,reject){return run().then(resolve,reject);},
      };
      return builder;
    },
    async rpc(name,args={}){
      calls.push({name,args:structuredClone(args)});
      const intercepted=intercept?.(name,args);if(intercepted)return intercepted;
      try{
        if(name==='jobs_capabilities')return {data:(await pg.query('select public.jobs_capabilities() as caps')).rows[0].caps};
        if(name==='jobs_cms_save')return {data:(await pg.query('select * from public.jobs_cms_save($1,$2)',[args.p_record,args.p_expected_version])).rows[0]};
        if(name==='jobs_cms_transition')return {data:(await pg.query('select * from public.jobs_cms_transition($1,$2,$3)',[args.p_id,args.p_status,args.p_expected_version])).rows[0]};
        throw new Error('Unexpected RPC '+name);
      }catch(error){return errorResult(error);}
    },
  };
}

async function setup({intercept,interceptRead}={}) {
  const pg=new PGlite();
  await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,
      deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
  for(const [role,id]of Object.entries(ids))await pg.query('insert into auth.users values($1,$2,now())',[id,role+'@example.test']);
  for(const filename of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')).sort())await pg.exec(await readFile(new URL('../supabase/migrations/'+filename,import.meta.url),'utf8'));
  for(const [role,id]of Object.entries(ids))await pg.query('insert into jobs_private.staff_members(user_id,role) values($1,$2)',[id,role]);
  const as=async role=>{await pg.exec('reset role');await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[role]||'']);await pg.exec('set role '+(role?'authenticated':'anon'));};
  await as('admin');
  const calls=[],db=supabaseShape(pg,calls,intercept,interceptRead),adapter=createJobsPublishingAdapter(db,{collections});
  const q=(sql,params=[])=>pg.query(sql,params),one=async(sql,params=[])=>(await q(sql,params)).rows[0];
  return {pg,db,adapter,calls,as,q,one,async close(){await pg.close();}};
}

const referenceInput=kind=>({...emptyEntry(kind),title_en:kind==='employer'?'ABC School':kind==='category'?'Public schools':'Hanoi',title_vi:kind==='employer'?'Trường ABC':kind==='category'?'Trường công lập':'Hà Nội',summary_en:'A complete description for this recruitment reference.',summary_vi:'Mô tả đầy đủ cho thông tin tuyển dụng này.'});
const vacancyInput=(refs={})=>({...emptyEntry('vacancy'),title_en:'English Teacher in Hanoi',title_vi:'Tuyển giáo viên tiếng Anh tại Hà Nội',summary_en:'A full-time teaching opportunity with a supportive school.',summary_vi:'Cơ hội giảng dạy toàn thời gian tại trường với nhiều hỗ trợ.',body_en:'Complete details about teaching duties, requirements and application support.',body_vi:'Thông tin đầy đủ về công việc giảng dạy, yêu cầu và hỗ trợ ứng tuyển.',data:{employer_name_en:'Independent School',category_slug:'public',location_slug:'hanoi',closes_on:'2099-12-31',contact_email:'recruiter@example.test',...refs}});
async function publishedReferences(h){const records={};for(const kind of ['employer','category','location'])records[kind]=await h.adapter.createReference(kind,referenceInput(kind));return records;}
async function publishVacancy(h,input){let record=await h.adapter.save(input,{expectedVersion:0});record=await h.adapter.transition(record.id,'review',{expectedVersion:record.version});return h.adapter.transition(record.id,'published',{expectedVersion:record.version});}

test('real database: a vacancy publishes directly without independent reference records',async()=>{
  const h=await setup();try{
    const input=vacancyInput(),saved=await h.adapter.save(input,{expectedVersion:0});
    const published=await h.adapter.transition(saved.id,'published',{expectedVersion:saved.version});
    assert.equal(published.status,'published');assert.equal(published.slug,'english-teacher-in-hanoi');assert.equal(input.slug,'');
    const live=await h.one('select * from public.jobs_public_content where id=$1',[published.id]);
    assert.equal(live.title_en,input.title_en);assert.deepEqual(live.data,input.data);
    assert.equal((await h.one("select count(*)::int n from public.jobs_cms_entries where kind<>'vacancy'")).n,0);
  }finally{await h.close();}
});

test('real database: English-only text publishes without bilingual summaries or minimum length padding',async()=>{
  const h=await setup();try{
    const input={...vacancyInput(),title_en:'T',title_vi:'',summary_en:'',summary_vi:'',body_en:'D',body_vi:''};
    assert.deepEqual(await h.adapter.validatePublication(input),[]);
    const published=await publishVacancy(h,input);assert.equal(published.status,'published');
    const live=await h.one('select * from public.jobs_public_content where id=$1',[published.id]);
    assert.equal(live.body_en,'D');assert.equal(live.summary_vi,'');assert.equal(live.title_vi,'');
  }finally{await h.close();}
});

test('real database: optional reference API retains live snapshot names for legacy data',async()=>{
  const h=await setup();try{
    const refs=await publishedReferences(h),original=refs.employer;
    const result=await h.db.rpc('jobs_cms_save',{p_record:{...original,slug:'renamed-private-school',title_en:'A changed private school title'},p_expected_version:original.version});
    assert.equal(result.error,undefined);assert.equal(result.data.status,'draft');
    const options=await h.adapter.referenceOptions('employer'),option=options.find(item=>item.id===original.id);
    assert.equal(option.value,original.slug);assert.equal(option.label.en,original.title_en);assert.equal(option.published,true);
  }finally{await h.close();}
});

test('real database: invalid required vacancy fields fail with exact fields and preserve saved content',async()=>{
  const h=await setup();try{
    const input=vacancyInput({employer_name_en:'',category_slug:'british-council',location_slug:'A typed location',contact_email:'invalid',closes_on:'2000-01-01'}),saved=await h.adapter.save(input,{expectedVersion:0});
    const issues=await h.adapter.validatePublication(saved);
    for(const field of ['data.employer_name_en','data.category_slug','data.location_slug','data.contact_email','data.closes_on'])assert.ok(issues.some(issue=>issue.field===field),field);
    const transitionsBefore=h.calls.filter(call=>call.name==='jobs_cms_transition').length;
    await assert.rejects(()=>h.adapter.transition(saved.id,'published',{expectedVersion:saved.version}),error=>error.code==='JOBS_VALIDATION'&&error.issues.length>=5);
    assert.equal(h.calls.filter(call=>call.name==='jobs_cms_transition').length,transitionsBefore);
    const unchanged=await h.one('select * from public.jobs_cms_entries where id=$1',[saved.id]);
    assert.equal(unchanged.version,saved.version);assert.equal(unchanged.body_vi,input.body_vi);assert.deepEqual(unchanged.data,input.data);
  }finally{await h.close();}
});

test('real database: editors can save vacancies while publisher authorization remains enforced',async()=>{
  const h=await setup();try{
    await h.as('editor');
    await assert.rejects(()=>h.adapter.createReference('employer',referenceInput('employer')),error=>error.code==='42501');
    let record=await h.adapter.save(vacancyInput(),{expectedVersion:0});
    await assert.rejects(()=>h.adapter.transition(record.id,'published',{expectedVersion:record.version}),error=>error.code==='42501');
    assert.equal((await h.one("select count(*)::int n from public.jobs_public_content where kind='vacancy'")).n,0);
    await h.as('publisher');record=await h.adapter.transition(record.id,'published',{expectedVersion:record.version});assert.equal(record.status,'published');
  }finally{await h.close();}
});

test('real database: a stale version cannot publish or overwrite a newer draft',async()=>{
  const h=await setup();try{
    const saved=await h.adapter.save(vacancyInput(),{expectedVersion:0});
    const updated=await h.adapter.save({...saved,body_en:'A changed and newer set of teaching details.'},{expectedVersion:saved.version});
    const transitionsBefore=h.calls.filter(call=>call.name==='jobs_cms_transition').length;
    await assert.rejects(()=>h.adapter.transition(saved.id,'published',{expectedVersion:saved.version}),error=>error.code==='40001');
    assert.equal(h.calls.filter(call=>call.name==='jobs_cms_transition').length,transitionsBefore);
    assert.equal((await h.one('select version from public.jobs_cms_entries where id=$1',[saved.id])).version,updated.version);
  }finally{await h.close();}
});

test('real database: independent profile lookup failures cannot block a complete vacancy',async()=>{
  let taxonomyReads=0;
  const h=await setup({interceptRead(table,filters){
    if(filters.some(([field,,value])=>field==='kind'&&['employer','category','location'].includes(value))){taxonomyReads++;return {error:{code:'503',message:'Reference lookup temporarily unavailable'}};}
  }});
  try{
    const input=vacancyInput(),saved=await h.adapter.save(input,{expectedVersion:0});
    assert.deepEqual(await h.adapter.validatePublication(saved),[]);
    const published=await h.adapter.transition(saved.id,'published',{expectedVersion:saved.version});
    assert.equal(published.status,'published');assert.equal(taxonomyReads,0);
    assert.deepEqual((await h.one('select data from public.jobs_public_content where id=$1',[published.id])).data,input.data);
  }finally{await h.close();}
});

test('real database: optional legacy reference publish retry preserves its saved identity',async()=>{
  let failOnce=true;
  const h=await setup({intercept(name,args){if(failOnce&&name==='jobs_cms_transition'&&args.p_status==='published'){failOnce=false;return {error:{code:'503',message:'Temporary connection failure'}};}}});
  try{
    let failed;
    try{await h.adapter.createReference('employer',referenceInput('employer'));}catch(error){failed=error;}
    assert.ok(failed?.partialRecord?.id);assert.equal(failed.partialRecord.status,'review');
    const retried=await h.adapter.createReference('employer',failed.partialRecord);
    assert.equal(retried.id,failed.partialRecord.id);assert.equal(retried.status,'published');
    assert.equal((await h.one('select count(*)::int n from public.jobs_cms_entries')).n,1);
    assert.equal((await h.one('select count(*)::int n from public.jobs_public_content')).n,1);
  }finally{await h.close();}
});


test('real database: blank optional fields and trimmed recruiter details introduce no publication blockers',async()=>{
  const h=await setup();try{
    const input={...vacancyInput({employer_name_en:'  A school  ',employer_name_vi:'   ',source_url:'   ',workplace_name:' ',street_address:' ',contact_email:' recruiter@example.test ' }),title_vi:'   ',summary_en:' ',summary_vi:' ',body_vi:' '};
    assert.deepEqual(await h.adapter.validatePublication(input),[]);
    const published=await publishVacancy(h,input);assert.equal(published.status,'published');
    assert.equal(published.data.employer_name_en,'A school');assert.equal(published.data.contact_email,'recruiter@example.test');
  }finally{await h.close();}
});
