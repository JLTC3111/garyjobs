begin;

-- Jobs-local staff administration. Authority is read from current Jobs membership
-- rows only; Home/Visa roles, Auth metadata and email labels grant nothing here.
-- Memberships are suspended, never deleted, so recruitment assignments
-- (jobs_applications.assigned_staff_id) and audit history keep their references.
alter table jobs_private.staff_members
 add column display_name text not null default '' check(char_length(display_name)<=120),
 add column protected boolean not null default false,
 add column version integer not null default 1 check(version>0),
 add column updated_at timestamptz not null default now(),
 add column updated_by uuid;
comment on column jobs_private.staff_members.protected is 'Set only by a reviewed operator procedure. Staff-management RPCs never change protected memberships.';

-- Every write path, including operator SQL, invalidates stale admin screens.
create function jobs_private.stamp_staff_change() returns trigger language plpgsql set search_path='' as $$
begin
 new.version:=old.version+1;new.updated_at:=clock_timestamp();new.updated_by:=auth.uid();
 return new;
end;$$;
create trigger jobs_staff_stamp before update on jobs_private.staff_members for each row
 when(old.* is distinct from new.*) execute function jobs_private.stamp_staff_change();

-- No foreign keys: history must outlive memberships and Auth identities.
-- A null actor is a database operator acting without an end-user session.
create table jobs_private.staff_audit_events(
 id bigint generated always as identity primary key,
 target_user_id uuid not null,
 target_email text,
 actor_user_id uuid,
 actor_email text,
 action text not null check(action in('granted','role_changed','suspended','restored','protected','unprotected','removed')),
 previous_role text,new_role text,
 previous_active boolean,new_active boolean,
 previous_protected boolean,new_protected boolean,
 created_at timestamptz not null default clock_timestamp()
);
create index jobs_staff_audit_recent on jobs_private.staff_audit_events(created_at desc,id desc);
alter table jobs_private.staff_audit_events enable row level security;
revoke all on jobs_private.staff_audit_events from public,anon,authenticated;
revoke all on sequence jobs_private.staff_audit_events_id_seq from public,anon,authenticated;

create function jobs_private.reject_audit_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'jobs.audit_immutable' using errcode='42501';end;$$;
create trigger jobs_staff_audit_append_only before update or delete on jobs_private.staff_audit_events
 for each row execute function jobs_private.reject_audit_change();
create trigger jobs_staff_audit_no_truncate before truncate on jobs_private.staff_audit_events
 for each statement execute function jobs_private.reject_audit_change();

create function jobs_private.record_staff_change() returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_action text;v_target uuid;
begin
 if tg_op='INSERT' then v_action:='granted';
 elsif tg_op='DELETE' then v_action:='removed';
 elsif old.active and not new.active then v_action:='suspended';
 elsif new.active and not old.active then v_action:='restored';
 elsif new.role<>old.role then v_action:='role_changed';
 elsif new.protected<>old.protected then v_action:=case when new.protected then 'protected' else 'unprotected' end;
 else return null;
 end if;
 v_target:=case when tg_op='DELETE' then old.user_id else new.user_id end;
 insert into jobs_private.staff_audit_events(target_user_id,target_email,actor_user_id,actor_email,action,previous_role,new_role,previous_active,new_active,previous_protected,new_protected)
 values(v_target,(select email from auth.users where id=v_target),v_actor,(select email from auth.users where id=v_actor),v_action,
  case when tg_op<>'INSERT' then old.role end,case when tg_op<>'DELETE' then new.role end,
  case when tg_op<>'INSERT' then old.active end,case when tg_op<>'DELETE' then new.active end,
  case when tg_op<>'INSERT' then old.protected end,case when tg_op<>'DELETE' then new.protected end);
 return null;
end;$$;
create trigger jobs_staff_audit_trail after insert or update or delete on jobs_private.staff_members
 for each row execute function jobs_private.record_staff_change();

-- Applies to RPC and operator updates alike. Row AFTER triggers run once the whole
-- statement is applied, and the shared lock serializes concurrent removals.
create function jobs_private.require_remaining_admin() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('jobs.staff_access',0));
 if exists(select 1 from auth.users where id=old.user_id and email_confirmed_at is not null)
  and not exists(select 1 from jobs_private.staff_members s join auth.users u on u.id=s.user_id
   where s.active and s.role='admin' and u.email_confirmed_at is not null) then
  raise exception 'jobs.last_admin_required' using errcode='23514';
 end if;
 return null;
end;$$;
create trigger jobs_staff_keep_admin after update on jobs_private.staff_members for each row
 when(old.role='admin' and old.active and (new.role<>'admin' or not new.active or new.user_id<>old.user_id))
 execute function jobs_private.require_remaining_admin();

create function jobs_private.can_manage_staff() returns boolean language sql stable security definer set search_path='' as $$select coalesce(jobs_private.role()='admin',false)$$;
create function jobs_private.can_manage_admins() returns boolean language sql stable security definer set search_path='' as $$
 select jobs_private.can_manage_staff() and exists(select 1 from jobs_private.staff_members s where s.user_id=(select auth.uid()) and s.protected)
$$;

-- Takes the shared lock before reading the caller, so a concurrently suspended
-- admin is rejected using the committed state rather than a stale snapshot.
create function jobs_private.lock_staff_admin() returns jobs_private.staff_members language plpgsql security definer set search_path='' as $$
declare actor jobs_private.staff_members;
begin
 perform pg_advisory_xact_lock(hashtextextended('jobs.staff_access',0));
 select s.* into actor from jobs_private.staff_members s join auth.users u on u.id=s.user_id
  where s.user_id=(select auth.uid()) and s.active and s.role='admin' and u.email_confirmed_at is not null
  for update of s;
 if not found then raise exception 'jobs.forbidden' using errcode='42501';end if;
 return actor;
end;$$;

create function jobs_private.staff_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer jobs_private.staff_members;
begin
 select s.* into viewer from jobs_private.staff_members s join auth.users u on u.id=s.user_id
  where s.user_id=(select auth.uid()) and s.active and s.role='admin' and u.email_confirmed_at is not null;
 if not found then raise exception 'jobs.forbidden' using errcode='42501';end if;
 return jsonb_build_object(
  'viewer',jsonb_build_object('user_id',viewer.user_id,'protected',viewer.protected,'can_manage_admins',viewer.protected),
  'members',coalesce((select jsonb_agg(jsonb_build_object(
    'user_id',s.user_id,'email',u.email,'display_name',s.display_name,
    'name',coalesce(nullif(s.display_name,''),nullif(trim(p.full_name),'')),
    'role',s.role,'active',s.active,'protected',s.protected,'email_confirmed',u.email_confirmed_at is not null,
    'version',s.version,'created_at',s.created_at,'updated_at',s.updated_at,
    'is_self',s.user_id=viewer.user_id,
    'can_manage',s.user_id<>viewer.user_id and not s.protected and (s.role<>'admin' or viewer.protected)
   ) order by s.active desc,lower(coalesce(nullif(s.display_name,''),u.email)),s.user_id)
   from jobs_private.staff_members s join auth.users u on u.id=s.user_id left join public.jobs_candidates p on p.id=s.user_id),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc)
   from (select * from jobs_private.staff_audit_events order by created_at desc,id desc limit 50) e),'[]'::jsonb)
 );
end;$$;

create function jobs_private.assign_staff(p_email text,p_role text,p_display_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor jobs_private.staff_members;r jobs_private.staff_members;v_email text:=lower(trim(coalesce(p_email,'')));v_name text:=trim(coalesce(p_display_name,''));v_ids uuid[];
begin
 actor:=jobs_private.lock_staff_admin();
 if p_role is null or p_role not in('editor','publisher','recruiter','admin') then raise exception 'jobs.role_invalid' using errcode='22023';end if;
 if char_length(v_name)>120 then raise exception 'jobs.name_invalid' using errcode='22023';end if;
 if p_role='admin' and not actor.protected then raise exception 'jobs.owner_required' using errcode='42501';end if;
 -- Unknown, unverified and ambiguous addresses share one answer.
 if v_email<>'' and char_length(v_email)<=254 then
  select array_agg(id) into v_ids from auth.users where lower(email)=v_email and email_confirmed_at is not null;
 end if;
 if coalesce(array_length(v_ids,1),0)<>1 then raise exception 'jobs.account_unavailable' using errcode='P0002';end if;
 if v_ids[1]=actor.user_id then raise exception 'jobs.self_change_forbidden' using errcode='42501';end if;
 if exists(select 1 from jobs_private.staff_members where user_id=v_ids[1]) then raise exception 'jobs.staff_exists' using errcode='23505';end if;
 insert into jobs_private.staff_members(user_id,role,active,display_name,updated_by) values(v_ids[1],p_role,true,v_name,actor.user_id) returning * into r;
 return jsonb_build_object('user_id',r.user_id,'role',r.role,'active',r.active,'version',r.version);
end;$$;

create function jobs_private.update_staff(p_user_id uuid,p_role text,p_active boolean,p_display_name text,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor jobs_private.staff_members;r jobs_private.staff_members;v_name text;
begin
 actor:=jobs_private.lock_staff_admin();
 if p_role is null or p_role not in('editor','publisher','recruiter','admin') then raise exception 'jobs.role_invalid' using errcode='22023';end if;
 if p_user_id is null or p_active is null or p_expected_version is null then raise exception 'jobs.staff_request_invalid' using errcode='22023';end if;
 if p_user_id=actor.user_id then raise exception 'jobs.self_change_forbidden' using errcode='42501';end if;
 select * into r from jobs_private.staff_members where user_id=p_user_id for update;
 if not found then raise exception 'jobs.staff_not_found' using errcode='P0002';end if;
 if r.protected then raise exception 'jobs.protected_account' using errcode='42501';end if;
 if (r.role='admin' or p_role='admin') and not actor.protected then raise exception 'jobs.owner_required' using errcode='42501';end if;
 if r.version<>p_expected_version then raise exception 'jobs.version_conflict' using errcode='40001';end if;
 v_name:=coalesce(trim(p_display_name),r.display_name);
 if char_length(v_name)>120 then raise exception 'jobs.name_invalid' using errcode='22023';end if;
 if r.role=p_role and r.active=p_active and r.display_name=v_name then
  return jsonb_build_object('user_id',r.user_id,'role',r.role,'active',r.active,'version',r.version);
 end if;
 if p_active and (not r.active or r.role<>p_role) and not exists(select 1 from auth.users where id=r.user_id and email_confirmed_at is not null) then
  raise exception 'jobs.account_unavailable' using errcode='P0002';
 end if;
 if r.role='admin' and r.active and (p_role<>'admin' or not p_active) and not exists(
  select 1 from jobs_private.staff_members s join auth.users u on u.id=s.user_id
  where s.user_id<>r.user_id and s.active and s.role='admin' and u.email_confirmed_at is not null) then
  raise exception 'jobs.last_admin_required' using errcode='23514';
 end if;
 update jobs_private.staff_members set role=p_role,active=p_active,display_name=v_name where user_id=r.user_id returning * into r;
 return jsonb_build_object('user_id',r.user_id,'role',r.role,'active',r.active,'version',r.version);
end;$$;

create function public.jobs_staff_overview() returns jsonb language sql stable security invoker set search_path='' as $$select jobs_private.staff_overview()$$;
create function public.jobs_staff_assign(p_email text,p_role text,p_display_name text default '') returns jsonb language sql security invoker set search_path='' as $$select jobs_private.assign_staff(p_email,p_role,p_display_name)$$;
create function public.jobs_staff_update(p_user_id uuid,p_role text,p_active boolean,p_expected_version integer,p_display_name text default null) returns jsonb language sql security invoker set search_path='' as $$select jobs_private.update_staff(p_user_id,p_role,p_active,p_display_name,p_expected_version)$$;

-- Replacing keeps the existing ACL; the new keys only describe the caller.
create or replace function public.jobs_capabilities() returns jsonb language sql security invoker set search_path='' as $$select jsonb_build_object('role',jobs_private.role(),'read',jobs_private.can_edit(),'edit',jobs_private.can_edit(),'publish',jobs_private.can_publish(),'media',jobs_private.can_edit(),'recruit',jobs_private.can_recruit(),'manage_staff',jobs_private.can_manage_staff(),'manage_admins',jobs_private.can_manage_admins())$$;

revoke all on function jobs_private.stamp_staff_change(),jobs_private.reject_audit_change(),jobs_private.record_staff_change(),jobs_private.require_remaining_admin(),jobs_private.lock_staff_admin() from public,anon,authenticated;
revoke all on function jobs_private.can_manage_staff(),jobs_private.can_manage_admins(),jobs_private.staff_overview(),jobs_private.assign_staff(text,text,text),jobs_private.update_staff(uuid,text,boolean,text,integer) from public,anon;
grant execute on function jobs_private.can_manage_staff(),jobs_private.can_manage_admins(),jobs_private.staff_overview(),jobs_private.assign_staff(text,text,text),jobs_private.update_staff(uuid,text,boolean,text,integer) to authenticated;
revoke all on function public.jobs_staff_overview(),public.jobs_staff_assign(text,text,text),public.jobs_staff_update(uuid,text,boolean,integer,text) from public,anon;
grant execute on function public.jobs_staff_overview(),public.jobs_staff_assign(text,text,text),public.jobs_staff_update(uuid,text,boolean,integer,text) to authenticated;

notify pgrst,'reload schema';
commit;
