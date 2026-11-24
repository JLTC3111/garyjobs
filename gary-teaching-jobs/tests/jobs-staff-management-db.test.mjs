import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const migrations=['20261116043122_teaching_jobs_cms_and_recruitment.sql','20261117102706_simplify_vacancy_publication.sql','20261117195500_jobs_staff_role_management.sql'];
const eligibility='20261117202945_staff_eligibility_assignment.sql';
const sql=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const bootstrap=()=>readFile(new URL('../supabase/setup-jobs-staff.sql',import.meta.url),'utf8');
const ids={owner:'30000000-0000-4000-8000-000000000001',admin:'30000000-0000-4000-8000-000000000002',editor:'30000000-0000-4000-8000-000000000003',publisher:'30000000-0000-4000-8000-000000000004',recruiter:'30000000-0000-4000-8000-000000000005',candidate:'30000000-0000-4000-8000-000000000006',unverified:'30000000-0000-4000-8000-000000000007',outsider:'30000000-0000-4000-8000-000000000008'};

async function setup({upgrade=true}={}){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;`);
 for(const [name,id]of Object.entries(ids))await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[id,name+'@example.test',name==='unverified'?null:new Date().toISOString()]);
 for(const name of migrations.slice(0,2))await db.exec(await sql(name));
 for(const [name,role]of [['owner','admin'],['admin','admin'],['editor','editor'],['publisher','publisher'],['recruiter','recruiter']])await db.query('insert into jobs_private.staff_members(user_id,role) values($1,$2)',[ids[name],role]);
 const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);if(id!==undefined)await db.exec('set role '+(id?'authenticated':'anon'));};
 const operator=()=>as(undefined);
 const one=async(statement,params=[])=>(await db.query(statement,params)).rows[0];
 const h={db,as,operator,one,
  upgrade:async()=>{await operator();await db.exec(await sql(migrations[2]));await db.exec(await sql(eligibility));await h.bootstrap(ids.owner,'admin',true);},
  async bootstrap(userId,role,protect){
   const script=await bootstrap();
   const placeholders={'v_user_id uuid := null':`v_user_id uuid := '${userId}'`,'v_role text := null':`v_role text := '${role}'`,'v_protected boolean := null':`v_protected boolean := ${protect}`};
   for(const placeholder of Object.keys(placeholders))assert.ok(script.includes(placeholder),placeholder);
   await operator();await db.exec(Object.entries(placeholders).reduce((text,[from,to])=>text.replace(from,to),script));
  },
  overview:async()=>(await one('select public.jobs_staff_overview() as v')).v,
  assign:async(email,role,name='')=>(await one('select public.jobs_staff_assign($1,$2,$3) as v',[email,role,name])).v,
  update:async(user,role,active,version,name=null)=>(await one('select public.jobs_staff_update($1,$2,$3,$4,$5) as v',[user,role,active,version,name])).v,
  caps:async()=>(await one('select public.jobs_capabilities() as c')).c,
  version:async user=>(await h.overview()).members.find(member=>member.user_id===user).version,
 };
 if(upgrade)await h.upgrade();
 return h;
}

test('upgrade preserves memberships and assignments; only current verified Jobs admins reach staff management',async()=>{
 const h=await setup({upgrade:false});try{
  await h.operator();
  await h.db.query("insert into public.jobs_candidates(id,full_name,email) values($1,'Outside Candidate','outsider@example.test')",[ids.outsider]);
  const app=await h.one("insert into public.jobs_applications(candidate_id,vacancy_title,client_request_id,assigned_staff_id) values($1,'General introduction',gen_random_uuid(),$2) returning id",[ids.outsider,ids.recruiter]);
  const roster='select user_id,role,active,created_at from jobs_private.staff_members order by user_id';
  const before=(await h.db.query(roster)).rows;
  await h.db.exec(await sql(migrations[2]));
  assert.deepEqual((await h.db.query(roster)).rows,before);
  assert.deepEqual((await h.db.query('select distinct display_name,version,protected from jobs_private.staff_members')).rows,[{display_name:'',version:1,protected:false}]);
  assert.equal((await h.one('select assigned_staff_id from public.jobs_applications where id=$1',[app.id])).assigned_staff_id,ids.recruiter);
  await h.db.query('update jobs_private.staff_members set protected=true where user_id=$1',[ids.owner]);

  await h.as(ids.editor);
  assert.deepEqual(await h.caps(),{role:'editor',read:true,edit:true,publish:false,media:true,recruit:false,manage_staff:false,manage_admins:false});
  await h.as(ids.publisher);
  assert.deepEqual(await h.caps(),{role:'publisher',read:true,edit:true,publish:true,media:true,recruit:false,manage_staff:false,manage_admins:false});
  for(const [name,staff,admins]of [['owner',true,true],['admin',true,false],['publisher',false,false],['recruiter',false,false],['outsider',false,false],['unverified',false,false]]){
   await h.as(ids[name]);const caps=await h.caps();assert.equal(caps.manage_staff,staff,name);assert.equal(caps.manage_admins,admins,name);
  }
  for(const name of ['editor','publisher','recruiter','outsider','unverified']){
   await h.as(ids[name]);
   await assert.rejects(h.overview,/jobs\.forbidden/,name);
   await assert.rejects(()=>h.assign('candidate@example.test','editor'),/jobs\.forbidden/,name);
   await assert.rejects(()=>h.update(ids[name],'admin',true,1),/jobs\.forbidden/,name+' cannot promote itself');
  }
  await h.as(null);
  await assert.rejects(h.overview,/permission denied/);
  await assert.rejects(()=>h.assign('candidate@example.test','editor'),/permission denied/);
  await h.as(ids.admin);
  for(const statement of ['select * from jobs_private.staff_members','select * from jobs_private.staff_audit_events',"update jobs_private.staff_members set protected=true",`insert into jobs_private.staff_members(user_id,role) values('${ids.candidate}','admin')`,'delete from jobs_private.staff_audit_events','select jobs_private.lock_staff_admin()'])
   await assert.rejects(()=>h.db.query(statement),/permission denied/,statement);

  // Authority is read from current database state, not from a previously loaded role.
  assert.equal((await h.overview()).viewer.user_id,ids.admin);
  await h.operator();await h.db.query('update jobs_private.staff_members set active=false where user_id=$1',[ids.admin]);
  await h.as(ids.admin);
  await assert.rejects(h.overview,/jobs\.forbidden/);
  await assert.rejects(()=>h.assign('candidate@example.test','editor'),/jobs\.forbidden/);
  assert.equal((await h.caps()).manage_staff,false);
 }finally{await h.db.close();}
});

test('admins assign, change, suspend and restore verified accounts with an audit trail and preserved assignments',async()=>{
 const h=await setup();try{
  await h.as(ids.admin);
  const granted=await h.assign('  CANDIDATE@Example.TEST ','recruiter','Casey Recruiter');
  assert.deepEqual(granted,{user_id:ids.candidate,role:'recruiter',active:true,version:1});
  await assert.rejects(()=>h.assign('unverified@example.test','editor'),/jobs\.account_unavailable/);
  await assert.rejects(()=>h.assign('nobody@example.test','editor'),/jobs\.account_unavailable/);
  await assert.rejects(()=>h.assign('candidate@example.test','editor'),/jobs\.staff_exists/);
  await assert.rejects(()=>h.assign('outsider@example.test','owner'),/jobs\.role_invalid/);
  await assert.rejects(()=>h.assign('outsider@example.test','editor','x'.repeat(121)),/jobs\.name_invalid/);
  await h.as(ids.candidate);assert.equal((await h.caps()).recruit,true);

  await h.operator();
  await h.db.query("insert into public.jobs_candidates(id,full_name,email) values($1,'Outside Candidate','outsider@example.test')",[ids.outsider]);
  const app=await h.one("insert into public.jobs_applications(candidate_id,vacancy_title,client_request_id,assigned_staff_id) values($1,'General introduction',gen_random_uuid(),$2) returning id,version",[ids.outsider,ids.candidate]);

  await h.as(ids.admin);
  const listed=(await h.overview()).members.find(member=>member.user_id===ids.candidate);
  assert.equal(listed.name,'Casey Recruiter');assert.equal(listed.email,'candidate@example.test');assert.equal(listed.role,'recruiter');assert.equal(listed.active,true);assert.equal(listed.can_manage,true);
  const suspended=await h.update(ids.candidate,'recruiter',false,listed.version);
  assert.equal(suspended.active,false);assert.equal(suspended.version,listed.version+1);
  await assert.rejects(()=>h.update(ids.candidate,'editor',true,listed.version),/jobs\.version_conflict/);

  await h.as(ids.candidate);
  assert.deepEqual(await h.caps(),{role:null,read:false,edit:false,publish:false,media:false,recruit:false,manage_staff:false,manage_admins:false});
  assert.equal((await h.one('select count(*)::int n from public.jobs_applications')).n,0,'revoked recruiter no longer reads recruitment');
  await h.as(ids.recruiter);
  assert.equal((await h.db.query('select * from public.jobs_staff_directory()')).rows.some(row=>row.user_id===ids.candidate),false,'suspended staff are not offered for new assignments');
  await assert.rejects(()=>h.one('select public.jobs_transition_application($1,$2,$3,$4)',[app.id,'screening',ids.candidate,app.version]),/assignee_invalid/);
  await h.operator();
  assert.equal((await h.one('select assigned_staff_id from public.jobs_applications where id=$1',[app.id])).assigned_staff_id,ids.candidate,'historical assignment is preserved');
  assert.deepEqual(await h.one('select role,active from jobs_private.staff_members where user_id=$1',[ids.candidate]),{role:'recruiter',active:false});

  await h.as(ids.admin);
  const restored=await h.update(ids.candidate,'publisher',true,suspended.version);
  const changed=await h.update(ids.candidate,'editor',true,restored.version,'Casey Editor');
  assert.equal(changed.role,'editor');
  assert.deepEqual(await h.update(ids.candidate,'editor',true,changed.version,'Casey Editor'),changed,'an unchanged save does not consume a version');
  await h.as(ids.candidate);const caps=await h.caps();assert.equal(caps.edit,true);assert.equal(caps.publish,false);assert.equal(caps.recruit,false);

  await h.as(ids.admin);const {events,members}=await h.overview();
  assert.equal(members.find(member=>member.user_id===ids.candidate).name,'Casey Editor');
  const history=events.filter(event=>event.target_user_id===ids.candidate).reverse().map(event=>[event.action,event.previous_role,event.new_role,event.previous_active,event.new_active,event.actor_email,event.target_email]);
  assert.deepEqual(history,[
   ['granted',null,'recruiter',null,true,'admin@example.test','candidate@example.test'],
   ['suspended','recruiter','recruiter',true,false,'admin@example.test','candidate@example.test'],
   ['restored','recruiter','publisher',false,true,'admin@example.test','candidate@example.test'],
   ['role_changed','publisher','editor',true,true,'admin@example.test','candidate@example.test'],
  ]);
  const operatorEvent=events.find(event=>event.target_user_id===ids.owner);
  assert.deepEqual([operatorEvent.action,operatorEvent.actor_user_id,operatorEvent.new_protected],['protected',null,true],'operator changes are audited with no actor');

  await h.operator();
  await assert.rejects(()=>h.db.query("update jobs_private.staff_audit_events set action='granted'"),/jobs\.audit_immutable/);
  await assert.rejects(()=>h.db.query('delete from jobs_private.staff_audit_events'),/jobs\.audit_immutable/);
  await h.db.query('delete from jobs_private.staff_members where user_id=$1',[ids.publisher]);
  assert.deepEqual(await h.one("select action,previous_role,target_email from jobs_private.staff_audit_events where target_user_id=$1",[ids.publisher]),{action:'removed',previous_role:'publisher',target_email:'publisher@example.test'});
 }finally{await h.db.close();}
});

test('self-changes, protected accounts, administrator grants and the last active administrator are guarded',async()=>{
 const h=await setup();try{
  await h.as(ids.admin);
  const {viewer,members}=await h.overview(),row=id=>members.find(member=>member.user_id===id);
  assert.equal(viewer.can_manage_admins,false);
  assert.deepEqual([row(ids.admin).is_self,row(ids.admin).can_manage,row(ids.owner).protected,row(ids.owner).can_manage,row(ids.editor).can_manage],[true,false,true,false,true]);
  await assert.rejects(async()=>h.update(ids.admin,'editor',true,await h.version(ids.admin)),/jobs\.self_change_forbidden/);
  await assert.rejects(async()=>h.update(ids.admin,'admin',false,await h.version(ids.admin)),/jobs\.self_change_forbidden/);
  await assert.rejects(()=>h.assign('admin@example.test','editor'),/jobs\.self_change_forbidden/);
  await assert.rejects(async()=>h.update(ids.owner,'editor',false,await h.version(ids.owner)),/jobs\.protected_account/);
  await assert.rejects(async()=>h.update(ids.editor,'admin',true,await h.version(ids.editor)),/jobs\.owner_required/);
  await assert.rejects(()=>h.assign('candidate@example.test','admin'),/jobs\.owner_required/);
  assert.equal((await h.update(ids.editor,'publisher',true,await h.version(ids.editor))).role,'publisher','ordinary admins manage non-admin roles');

  await h.as(ids.owner);
  assert.equal((await h.overview()).viewer.can_manage_admins,true);
  await h.assign('candidate@example.test','admin','Second Admin');
  await h.as(ids.candidate);assert.equal((await h.caps()).manage_staff,true);
  await h.as(ids.owner);
  assert.equal((await h.update(ids.admin,'editor',true,await h.version(ids.admin))).role,'editor','a protected owner can demote an administrator');
  await assert.rejects(async()=>h.update(ids.owner,'editor',true,await h.version(ids.owner)),/jobs\.self_change_forbidden/);
  await h.bootstrap(ids.candidate,'admin',true);
  await h.as(ids.owner);
  await assert.rejects(async()=>h.update(ids.candidate,'editor',true,await h.version(ids.candidate)),/jobs\.protected_account/,'protected owners cannot change each other in the app');

  // The database keeps one active verified administrator on every update path.
  await h.operator();
  await h.db.query('update jobs_private.staff_members set active=false where user_id=$1',[ids.candidate]);
  await h.db.query("insert into jobs_private.staff_members(user_id,role) values($1,'admin')",[ids.unverified]);
  for(const statement of ['update jobs_private.staff_members set active=false where user_id=$1',"update jobs_private.staff_members set role='editor' where user_id=$1","update jobs_private.staff_members set active=false where role='admin' or user_id=$1"])
   await assert.rejects(()=>h.db.query(statement,[ids.owner]),/jobs\.last_admin_required/,statement);
  assert.deepEqual(await h.one('select role,active from jobs_private.staff_members where user_id=$1',[ids.owner]),{role:'admin',active:true});
  await h.db.query('update jobs_private.staff_members set active=true where user_id=$1',[ids.candidate]);
  await h.db.query('update jobs_private.staff_members set active=false where user_id=$1',[ids.owner]);
  await assert.rejects(()=>h.db.query('update jobs_private.staff_members set active=false where user_id=$1',[ids.candidate]),/jobs\.last_admin_required/);

  // Re-running the operator script restores an owner without dropping protection unless asked to.
  await h.bootstrap(ids.owner,'admin',null);
  assert.deepEqual(await h.one('select role,active,protected from jobs_private.staff_members where user_id=$1',[ids.owner]),{role:'admin',active:true,protected:true});
  await assert.rejects(async()=>h.db.exec(await bootstrap()),e=>e.code==='22023');await h.db.exec('rollback');
  for(const [id,role,protect]of [[ids.editor,'editor',true],[ids.unverified,'editor',null]]){
   await assert.rejects(()=>h.bootstrap(id,role,protect),e=>e.code==='23514');await h.db.exec('rollback');
  }
  assert.deepEqual(await h.one('select role,protected from jobs_private.staff_members where user_id=$1',[ids.editor]),{role:'publisher',protected:false});
 }finally{await h.db.close();}
});
