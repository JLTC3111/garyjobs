import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const ids={a:'10000000-0000-4000-8000-000000000001',b:'10000000-0000-4000-8000-000000000002',admin:'10000000-0000-4000-8000-000000000003',editor:'10000000-0000-4000-8000-000000000004',recruiter:'10000000-0000-4000-8000-000000000005',agency:'10000000-0000-4000-8000-000000000006',unverified:'10000000-0000-4000-8000-000000000007'};
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;
 create policy unrelated_permissive_policy on storage.objects for all to anon,authenticated using(true) with check(true);`);
 for(const [name,id]of Object.entries(ids))await db.query('insert into auth.users values($1,$2,$3)',[id,name+'@example.test',name==='unverified'?null:new Date().toISOString()]);
 await db.exec(await readFile(new URL('../supabase/migrations/20261116043122_teaching_jobs_cms_and_recruitment.sql',import.meta.url),'utf8'));
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
  await assert.rejects(()=>h.save({...r,title_en:'Stale title',version:1}),/version_conflict/);
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
  const vacancy=await h.publish(h.record('vacancy','teacher-hanoi',{employer_slug:'employer-one',category_slug:'category-one',location_slug:'location-one',closes_on:'2099-12-31',contact_email:'jobs@example.test'}));
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
  await assert.rejects(()=>h.one('select public.jobs_transition_application($1,$2,$3,$4)',[a.id,'shortlisted',ids.recruiter,1]),/version_conflict/);
  await h.q('insert into public.jobs_recruitment_notes(application_id,body) values($1,$2)',[a.id,'Private recruiter context']);
  await h.as(ids.a);assert.equal((await h.one('select count(*)::int n from public.jobs_recruitment_notes')).n,0);assert.equal((await h.one('select count(*)::int n from public.jobs_application_events')).n,2);
  await h.q("insert into storage.objects(bucket_id,name) values('jobs-cv',$1)",[`${ids.a}/${a.id}/cv.pdf`]);
  await h.as(ids.b);assert.equal((await h.one("select count(*)::int n from storage.objects where bucket_id='jobs-cv'")).n,0);
  await assert.rejects(()=>h.q("insert into storage.objects(bucket_id,name) values('jobs-cv',$1)",[`${ids.a}/${a.id}/stolen.pdf`]),/policy/);
  await h.as(null);assert.equal((await h.one("select count(*)::int n from storage.objects where bucket_id='jobs-cv'")).n,0);
 }finally{await h.db.close();}
});
test('vacancy expiry/references and bilingual media metadata are enforced below the UI',async()=>{
 const h=await setup();try{
  await h.as(ids.admin);const employers={};for(const kind of ['employer','category','location'])employers[kind]=await h.publish(h.record(kind,kind+'-one'));
  let r=await h.save(h.record('vacancy','missing-reference',{closes_on:'2099-12-31',contact_email:'jobs@example.test'}));r=await h.transition(r,'review');await assert.rejects(()=>h.transition(r,'published'),/references_required/);
  const vacancy=await h.publish(h.record('vacancy','active-role',{employer_slug:'employer-one',category_slug:'category-one',location_slug:'location-one',closes_on:'2099-12-31',contact_email:'jobs@example.test'}));
  await assert.rejects(()=>h.transition(employers.employer,'archived'),/reference_in_use/);
  let renamed=await h.save({...employers.employer,slug:'new-employer'});renamed=await h.transition(renamed,'review');await assert.rejects(()=>h.transition(renamed,'published'),/reference_in_use/);
  await assert.rejects(()=>h.q("insert into public.jobs_cms_media(object_path,file_name,mime_type,size_bytes,alt_en,alt_vi) values($1,'photo.png','image/png',100,'Photo','')",[ids.admin+'/photo.png']),/check constraint/);
  await h.q("insert into public.jobs_cms_media(object_path,file_name,mime_type,size_bytes,alt_en,alt_vi) values($1,'photo.png','image/png',100,'A classroom','Một lớp học')",[ids.admin+'/photo.png']);
  await h.db.exec('reset role');await h.q("update public.jobs_public_content set expires_on='2000-01-01' where id=$1",[vacancy.id]);await h.as(null);
  assert.equal((await h.one("select count(*)::int n from public.jobs_public_content where kind='vacancy'")).n,0);
 }finally{await h.db.close();}
});
test('archiving renamed taxonomy drafts cannot orphan current published vacancy references',async()=>{
 const h=await setup();try{
  await h.as(ids.admin);const profiles={};
  for(const kind of ['employer','category','location'])profiles[kind]=await h.publish(h.record(kind,kind+'-original'));
  const vacancy=await h.publish(h.record('vacancy','referenced-role',{employer_slug:'employer-original',category_slug:'category-original',location_slug:'location-original',closes_on:'2099-12-31',contact_email:'jobs@example.test'}));
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
