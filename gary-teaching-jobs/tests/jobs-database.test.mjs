import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {categoryOptions,locationOptions} from '../dist/jobs-vacancy-options.js';
const ids={a:'10000000-0000-4000-8000-000000000001',b:'10000000-0000-4000-8000-000000000002',admin:'10000000-0000-4000-8000-000000000003',editor:'10000000-0000-4000-8000-000000000004',recruiter:'10000000-0000-4000-8000-000000000005',agency:'10000000-0000-4000-8000-000000000006',unverified:'10000000-0000-4000-8000-000000000007'};
const migration = new URL('../supabase/migrations/20261117102706_simplify_vacancy_publication.sql',import.meta.url);
const cvMigration = new URL('../supabase/migrations/20261124162809_jobs_cv_upload_recovery.sql',import.meta.url);
const conflictMigration = new URL('../supabase/migrations/20261124202611_jobs_postgrest_conflict_sqlstates.sql',import.meta.url);
const versionConflict = error => error.code==='PT409'&&error.message==='jobs.version_conflict';
test('database publication choices match all curated editor category and location values',async()=>{
 const sql=await readFile(migration,'utf8');
 for(const [kind,options,count]of [['category',categoryOptions,8],['location',locationOptions,34]]){
  const clause=sql.match(new RegExp("r\\.data->>'"+kind+"_slug'=any\\(array\\[([^\\]]+)\\]\\)"));
  assert.ok(clause,kind+' canonical choices exist in the migration');
  const values=[...clause[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
  assert.equal(options.length,count);assert.equal(values.length,count);
  assert.deepEqual(values.sort(),options.map(option=>option.value).sort());
 }
});
async function setup({latest=true}={}){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb not null default '{}');
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;
 create policy unrelated_permissive_policy on storage.objects for all to anon,authenticated using(true) with check(true);`);
 for(const [name,id]of Object.entries(ids))await db.query('insert into auth.users values($1,$2,$3)',[id,name+'@example.test',name==='unverified'?null:new Date().toISOString()]);
 await db.exec(await readFile(new URL('../supabase/migrations/20261116043122_teaching_jobs_cms_and_recruitment.sql',import.meta.url),'utf8'));
 if(latest)await db.exec(await readFile(migration,'utf8'));
 if(latest)await db.exec(await readFile(conflictMigration,'utf8'));
 for(const role of ['admin','editor','recruiter'])await db.query('insert into jobs_private.staff_members(user_id,role) values($1,$2)',[ids[role],role]);
 const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+(id?'authenticated':'anon'));};
 const q=(s,p=[])=>db.query(s,p),one=async(s,p=[])=>(await q(s,p)).rows[0];
 const save=async r=>(await one('select * from public.jobs_cms_save($1,$2)',[r,r.version||null]));
 const transition=async(r,status)=>(await one('select * from public.jobs_cms_transition($1,$2,$3)',[r.id,status,r.version]));
 const record=(kind,slug,data={})=>({kind,slug,title_en:'Published '+slug,title_vi:'Nội dung '+slug,summary_en:'Detailed English summary for '+slug,summary_vi:'Tóm tắt tiếng Việt cho '+slug,body_en:'Complete primary English content with required details.',body_vi:'Nội dung chính tiếng Việt đầy đủ thông tin cần thiết.',data});
 const publish=async r=>transition(await transition(await save(r),'review'),'published');
 return {db,as,q,one,save,transition,record,publish};
}
test('Jobs CMS isolates roles, enforces review/versioning and retains published snapshots',async()=>{
 const h=await setup();try{
  await h.as(ids.agency);assert.equal((await h.one('select public.jobs_capabilities() as caps')).caps.read,false);
  await assert.rejects(()=>h.save(h.record('guide','not-authorized')),/jobs.forbidden/);
  await h.as(ids.editor);let r=await h.save(h.record('guide','teaching-guide'));
  await assert.rejects(()=>h.transition(r,'published'),/publisher_required/);
  const reviewed=await h.transition(r,'review');await h.as(ids.admin);r=await h.transition(reviewed,'published');
  await assert.rejects(()=>h.save({...r,title_en:'Stale title',version:1}),versionConflict);
  await assert.rejects(()=>h.transition({...r,version:1},'archived'),versionConflict);
  await assert.rejects(()=>h.save({...h.record('guide','not-created'),version:5}),versionConflict);
  const saved=await h.save({...r,title_en:'Private working draft'});
  assert.equal(saved.status,'draft');await h.as(null);
  assert.equal((await h.one('select title_en from public.jobs_public_content where id=$1',[r.id])).title_en,'Published teaching-guide');
  await assert.rejects(()=>h.q('select * from public.jobs_cms_entries'),/permission/);
  await h.as(ids.b);assert.equal((await h.one('select count(*)::int n from public.jobs_cms_entries')).n,0);
  await h.as(ids.admin);const rev=(await h.q('select * from public.jobs_cms_revisions where entry_id=$1 order by version',[r.id])).rows;
  assert.equal(rev.length,4);const restored=await h.one('select * from public.jobs_cms_restore($1,$2,$3)',[r.id,rev[0].id,saved.version]);
  assert.equal(restored.title_en,r.title_en);assert.equal(restored.status,'draft');assert.equal(restored.version,5);
  await h.transition(restored,'archived');await h.as(null);assert.equal((await h.one('select count(*)::int n from public.jobs_public_content')).n,0);
 }finally{await h.db.close();}
});
test('Jobs applications are durable/idempotent/owned; stages and assignees are independently authorized',async()=>{
 const h=await setup();try{
  await h.as(ids.admin);
  for(const kind of ['employer','category','location'])await h.publish(h.record(kind,kind+'-one'));
  const vacancy=await h.publish(h.record('vacancy','teacher-hanoi',{employer_slug:'employer-one',category_slug:'public',location_slug:'hanoi',closes_on:'2099-12-31',contact_email:'jobs@example.test'}));
  const request='20000000-0000-4000-8000-000000000001',profile={full_name:'Candidate A',phone:'123',consent:true};
  const submit=()=>h.one('select * from public.jobs_submit_application($1,$2,$3,$4)',[vacancy.id,profile,'I would like to apply.',request]);
  await h.as(ids.unverified);await assert.rejects(submit,/email_verification_required/);
  await h.as(ids.a);const a=await submit(),again=await submit();assert.equal(a.id,again.id);assert.match(a.receipt_code,/^GJ-/);assert.equal((await h.one('select count(*)::int n from public.jobs_applications')).n,1);
  await assert.rejects(()=>h.q("update public.jobs_applications set stage='hired' where id=$1",[a.id]),/permission/);
  await h.as(ids.b);assert.equal((await h.one('select count(*)::int n from public.jobs_applications')).n,0);
  await assert.rejects(()=>h.q("insert into public.jobs_application_documents(application_id,candidate_id,object_path,file_name,mime_type,size_bytes) values($1,$2,$3,'CV.pdf','application/pdf',123)",[a.id,ids.a,`${ids.a}/${a.id}/cv.pdf`]),/policy/);
  await h.as(ids.agency);await assert.rejects(()=>h.one('select public.jobs_transition_application($1,$2,$3,$4)',[a.id,'screening',ids.agency,1]),/forbidden/);
  await h.as(ids.recruiter);await assert.rejects(()=>h.one('select public.jobs_transition_application($1,$2,$3,$4)',[a.id,'hired',ids.recruiter,1]),/stage_invalid/);
  const next=await h.one('select * from public.jobs_transition_application($1,$2,$3,$4)',[a.id,'screening',ids.recruiter,1]);assert.equal(next.version,2);assert.equal(next.assigned_staff_id,ids.recruiter);
  await assert.rejects(()=>h.one('select public.jobs_transition_application($1,$2,$3,$4)',[a.id,'shortlisted',ids.recruiter,1]),versionConflict);
  await h.q('insert into public.jobs_recruitment_notes(application_id,body) values($1,$2)',[a.id,'Private recruiter context']);
  await h.as(ids.a);assert.equal((await h.one('select count(*)::int n from public.jobs_recruitment_notes')).n,0);assert.equal((await h.one('select count(*)::int n from public.jobs_application_events')).n,2);
  await h.q("insert into storage.objects(bucket_id,name) values('jobs-cv',$1)",[`${ids.a}/${a.id}/cv.pdf`]);
  await h.as(ids.b);assert.equal((await h.one("select count(*)::int n from storage.objects where bucket_id='jobs-cv'")).n,0);
  await assert.rejects(()=>h.q("insert into storage.objects(bucket_id,name) values('jobs-cv',$1)",[`${ids.a}/${a.id}/stolen.pdf`]),/policy/);
  await h.as(null);assert.equal((await h.one("select count(*)::int n from storage.objects where bucket_id='jobs-cv'")).n,0);
 }finally{await h.db.close();}
});
test('two Jobs editors with the same version cannot overwrite the first committed edit', {timeout:15000}, async()=>{
 const h=await setup();
 try{
  await h.as(ids.editor);
  const initial=await h.save(h.record('guide','concurrent-edit'));
  await h.as(ids.admin);
  const first=await h.save({...initial,title_en:'First committed change'});
  await h.as(ids.editor);
  await assert.rejects(()=>h.save({...initial,title_en:'Stale editor change'}),versionConflict);
  const stored=await h.one('select title_en,version from public.jobs_cms_entries where id=$1',[initial.id]);
  assert.deepEqual(stored,{title_en:first.title_en,version:first.version});
  assert.equal((await h.q('select version from public.jobs_cms_revisions where entry_id=$1',[initial.id])).rowCount,2);
 }finally{await h.db.close();}
});
test('CV reservations recover one verified attachment without disturbing existing CVs',async()=>{
 const h=await setup();try{
  await h.as(ids.a);
  const app=await h.one("select * from public.jobs_submit_application(null,$1,'Application',gen_random_uuid())",[{full_name:'Candidate A',consent:true}]);
  const original=await h.one("insert into public.jobs_application_documents(application_id,candidate_id,object_path,file_name,mime_type,size_bytes) values($1,$2,$3,'original.pdf','application/pdf',3) returning id",[app.id,ids.a,`${ids.a}/${app.id}/original.pdf`]);
  await h.db.exec('reset role');
  await h.db.exec(await readFile(cvMigration,'utf8'));
  const reserve=async(hash='a'.repeat(64))=>(await h.one("select public.jobs_reserve_cv_upload($1,$2,'cv.pdf','application/pdf',24) r",[app.id,hash])).r;
  const complete=id=>h.one('select * from public.jobs_complete_cv_upload($1)',[id]);
  const store=(path,size)=>h.q("insert into storage.objects(bucket_id,name,metadata) values('jobs-cv',$1,$2::jsonb)",[path,{mimetype:'application/pdf',size}]);
  const documents=() => h.q('select id from public.jobs_application_documents where application_id=$1',[app.id]);
  await h.as(ids.a);
  const first=await reserve();assert.deepEqual(await reserve(),first);
  assert.equal(first.stored,false);assert.equal(first.document,null);
  await assert.rejects(()=>complete(first.id),/jobs.cv_upload_missing/);
  assert.deepEqual((await documents()).rows,[original]);
  await h.as(ids.b);
  await assert.rejects(reserve,/jobs.forbidden/);await assert.rejects(()=>complete(first.id),/jobs.forbidden/);
  await h.as(ids.a);await store(first.object_path,24);
  assert.deepEqual(await reserve(),{...first,stored:true});
  const attached=await complete(first.id);
  assert.equal(attached.object_path,first.object_path);
  assert.equal((await reserve()).document.id,attached.id);
  assert.equal((await complete(first.id)).id,attached.id);
  assert.equal((await documents()).rows.length,2);
  const mismatch=await reserve('b'.repeat(64));await store(mismatch.object_path,23);
  await assert.rejects(()=>complete(mismatch.id),/jobs.cv_invalid/);
  assert.equal((await documents()).rows.length,2);
 }finally{await h.db.close();}
});
test('vacancy required fields, expiry and bilingual media metadata are enforced below the UI',async()=>{
 const h=await setup();try{
  await h.as(ids.admin);const employers={};for(const kind of ['employer','category','location'])employers[kind]=await h.publish(h.record(kind,kind+'-one'));
  let r=await h.save(h.record('vacancy','missing-reference',{closes_on:'2099-12-31',contact_email:'jobs@example.test'}));r=await h.transition(r,'review');await assert.rejects(()=>h.transition(r,'published'),error=>{const issues=JSON.parse(error.detail).issues;assert.deepEqual(issues.map(issue=>issue.field),['data.employer_name_en','data.category_slug','data.location_slug']);return true;});
  const vacancy=await h.publish(h.record('vacancy','active-role',{employer_slug:'employer-one',category_slug:'public',location_slug:'hanoi',closes_on:'2099-12-31',contact_email:'jobs@example.test'}));
  await assert.rejects(()=>h.transition(employers.employer,'archived'),/reference_in_use/);
  let renamed=await h.save({...employers.employer,slug:'new-employer'});renamed=await h.transition(renamed,'review');await assert.rejects(()=>h.transition(renamed,'published'),/reference_in_use/);
  await assert.rejects(()=>h.q("insert into public.jobs_cms_media(object_path,file_name,mime_type,size_bytes,alt_en,alt_vi) values($1,'photo.png','image/png',100,'Photo','')",[ids.admin+'/photo.png']),/check constraint/);
  await h.q("insert into public.jobs_cms_media(object_path,file_name,mime_type,size_bytes,alt_en,alt_vi) values($1,'photo.png','image/png',100,'A classroom','Một lớp học')",[ids.admin+'/photo.png']);
  await h.db.exec('reset role');await h.q("update public.jobs_public_content set expires_on='2000-01-01' where id=$1",[vacancy.id]);await h.as(null);
  assert.equal((await h.one("select count(*)::int n from public.jobs_public_content where kind='vacancy'")).n,0);
 }finally{await h.db.close();}
});
test('archiving renamed taxonomy drafts cannot orphan current published vacancy references',async()=>{
 const h=await setup({latest:false});try{
  await h.as(ids.admin);const profiles={};
  for(const kind of ['employer','category','location'])profiles[kind]=await h.publish(h.record(kind,kind+'-original'));
  const vacancy=await h.publish(h.record('vacancy','referenced-role',{employer_slug:'employer-original',category_slug:'category-original',location_slug:'location-original',closes_on:'2099-12-31',contact_email:'jobs@example.test'}));
  await h.db.exec('reset role');await h.db.exec(await readFile(migration,'utf8'));await h.as(ids.admin);
  for(const kind of ['employer','category','location']){
   const original=profiles[kind],draft=await h.save({...original,slug:kind+'-renamed'});
   await assert.rejects(()=>h.transition(draft,'archived'),/reference_in_use/,kind+' snapshot is still in use under its published slug');
   const published=await h.one('select slug from public.jobs_public_content where id=$1',[original.id]);
   assert.equal(published.slug,kind+'-original');
   const saved=await h.one('select status,version from public.jobs_cms_entries where id=$1',[original.id]);
   assert.equal(saved.status,'draft');assert.equal(saved.version,draft.version,'rejected archive does not consume a revision');
   const currentVacancy=await h.one('select data from public.jobs_public_content where id=$1',[vacancy.id]);
   assert.equal(currentVacancy.data[kind+'_slug'],published.slug);
  }
 }finally{await h.db.close();}
});

const vacancyData = {employer_name_en:'A new school',category_slug:'public',location_slug:'hanoi',closes_on:'2099-12-31',contact_email:'jobs@example.test'};
test('one complete English vacancy publishes directly from draft with no employer, category or location records',async()=>{
 const h=await setup();try{
  await h.as(ids.admin);
  const draft=await h.save({...h.record('vacancy','independent-vacancy',vacancyData),title_vi:'',summary_en:'',summary_vi:'',body_en:'Teach English.',body_vi:''});
  assert.equal(draft.status,'draft');
  const published=await h.transition(draft,'published');
  assert.equal(published.status,'published');assert.equal(published.version,draft.version+1);
  assert.equal((await h.one("select count(*)::int n from public.jobs_cms_entries where kind in('employer','category','location')")).n,0);
  await h.as(null);
  const live=await h.one('select * from public.jobs_public_content where id=$1',[published.id]);
  assert.equal(live.data.employer_name_en,'A new school');assert.equal(live.summary_en,'');assert.equal(live.title_vi,'');assert.equal(live.body_vi,'');
 }finally{await h.db.close();}
});
test('publication failures return every missing field and valid calendar date errors without consuming a revision',async()=>{
 const h=await setup();try{
  await h.as(ids.admin);
  const draft=await h.save({...h.record('vacancy','incomplete-vacancy',{}),title_en:'',body_en:''});
  await assert.rejects(()=>h.transition(draft,'published'),error=>{
   assert.equal(error.code,'23514');const issues=JSON.parse(error.detail).issues;
   assert.deepEqual(new Set(issues.map(issue=>issue.field)),new Set(['title_en','body_en','data.employer_name_en','data.category_slug','data.location_slug','data.closes_on','data.contact_email']));return true;
  });
  assert.equal((await h.one('select version from public.jobs_cms_entries where id=$1',[draft.id])).version,draft.version);
  for(const [closes_on,code]of [['2026-02-30','cms-date-invalid'],['not-a-date','cms-date-invalid'],['2000-01-01','cms-date-past']]){
   const invalid=await h.save({...draft,data:{...vacancyData,closes_on,contact_email:'invalid'}});
   await assert.rejects(()=>h.transition(invalid,'published'),error=>{
    const issues=JSON.parse(error.detail).issues;assert.ok(issues.some(issue=>issue.field==='data.closes_on'&&issue.code===code));assert.ok(issues.some(issue=>issue.field==='data.contact_email'&&issue.code==='cms-email-invalid'));return true;
   });
   Object.assign(draft,invalid);
  }
 }finally{await h.db.close();}
});
test('British Council and arbitrary taxonomy names cannot become categories for new vacancies',async()=>{
 const h=await setup();try{
  await h.as(ids.admin);
  for(const category_slug of ['british-council','a-new-school']){
   const draft=await h.save(h.record('vacancy','invalid-'+category_slug,{...vacancyData,category_slug}));
   await assert.rejects(()=>h.transition(draft,'published'),error=>JSON.parse(error.detail).issues.some(issue=>issue.field==='data.category_slug'&&issue.code==='cms-option-invalid'));
  }
  for(const category_slug of ['public','centers','international-schools','private-schools','kindergarten','universities','online','other']){
   const published=await h.publish(h.record('vacancy','category-'+category_slug,{...vacancyData,category_slug}));assert.equal(published.status,'published');
  }
 }finally{await h.db.close();}
});
test('unknown locations stay saveable as drafts and return field errors if a raw RPC tries to publish them',async()=>{
 const h=await setup();try{
  await h.as(ids.admin);
  const draft=await h.save(h.record('vacancy','unknown-city',{...vacancyData,location_slug:'unknown-city'}));
  assert.equal(draft.status,'draft');assert.equal(draft.data.location_slug,'unknown-city');
  await assert.rejects(()=>h.transition(draft,'published'),error=>{
   assert.equal(error.code,'23514');
   assert.deepEqual(JSON.parse(error.detail).issues.map(issue=>[issue.field,issue.code]),[['data.location_slug','cms-option-invalid']]);return true;
  });
  assert.equal((await h.one('select version from public.jobs_cms_entries where id=$1',[draft.id])).version,draft.version);
 }finally{await h.db.close();}
});
test('function-only upgrade preserves published vacancies, revisions and legacy category/location values',async()=>{
 const h=await setup({latest:false});try{
  await h.as(ids.admin);
  for(const kind of ['employer','category','location'])await h.publish(h.record(kind,kind+'-legacy'));
  const legacy=await h.publish(h.record('vacancy','legacy-vacancy',{employer_slug:'employer-legacy',category_slug:'category-legacy',location_slug:'location-legacy',closes_on:'2099-12-31',contact_email:'jobs@example.test'}));
  const before=await h.one('select to_jsonb(p) as row from public.jobs_public_content p where id=$1',[legacy.id]);
  const revisionCount=(await h.one('select count(*)::int n from public.jobs_cms_revisions')).n;
  await h.db.exec('reset role');await h.db.exec(await readFile(migration,'utf8'));await h.as(ids.admin);
  assert.deepEqual(await h.one('select to_jsonb(p) as row from public.jobs_public_content p where id=$1',[legacy.id]),before);
  assert.equal((await h.one('select count(*)::int n from public.jobs_cms_revisions')).n,revisionCount);
  const edited=await h.save({...legacy,title_en:'Updated legacy vacancy',title_vi:'',summary_en:'',summary_vi:'',body_vi:''});
  const republished=await h.transition(edited,'published');assert.equal(republished.status,'published');assert.equal(republished.data.category_slug,'category-legacy');assert.equal(republished.data.location_slug,'location-legacy');
  // A new vacancy cannot borrow another vacancy's grandfathered category.
  const bad=await h.save(h.record('vacancy','new-legacy-category',{...vacancyData,category_slug:'category-legacy'}));
  await assert.rejects(()=>h.transition(bad,'published'),error=>JSON.parse(error.detail).issues.some(issue=>issue.field==='data.category_slug'));
  const badLocation=await h.save(h.record('vacancy','new-legacy-location',{...vacancyData,location_slug:'location-legacy'}));
  await assert.rejects(()=>h.transition(badLocation,'published'),error=>JSON.parse(error.detail).issues.some(issue=>issue.field==='data.location_slug'&&issue.code==='cms-option-invalid'));
  await h.as(ids.editor);await assert.rejects(()=>h.transition(edited,'published'),/publisher_required/);
  await h.as(null);await assert.rejects(()=>h.q('select jobs_private.check_publication(null::public.jobs_cms_entries)'),/permission/);
 }finally{await h.db.close();}
});
