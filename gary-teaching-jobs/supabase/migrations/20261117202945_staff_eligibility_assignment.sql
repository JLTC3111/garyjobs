-- PENDING APPROVAL: local follow-up only; do not apply without owner approval.
-- Existing identities, memberships, roles and historical records are unchanged.
begin;
create function jobs_private.staff_identity_eligible(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=p_user and u.email_confirmed_at is not null
  and u.deleted_at is null and not coalesce(u.is_anonymous,false)
  and (u.banned_until is null or u.banned_until<=now()));
$$;
revoke all on function jobs_private.staff_identity_eligible(uuid) from public,anon,authenticated;

create or replace function jobs_private.role() returns text
language sql stable security definer set search_path='' as $$
 select s.role from jobs_private.staff_members s where s.user_id=auth.uid() and s.active and jobs_private.staff_identity_eligible(s.user_id);
$$;
create function jobs_private.is_assignable(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select jobs_private.staff_identity_eligible(p_user) and exists(select 1 from jobs_private.staff_members s where s.user_id=p_user and s.active and s.role in('recruiter','admin'));
$$;
revoke all on function jobs_private.is_assignable(uuid) from public,anon,authenticated;
create or replace function jobs_private.staff_directory() returns table(user_id uuid,full_name text,role text)
language sql stable security definer set search_path='' as $$
 select s.user_id,coalesce(p.full_name,u.email),s.role from jobs_private.staff_members s
 join auth.users u on u.id=s.user_id left join public.jobs_candidates p on p.id=s.user_id
 where jobs_private.can_recruit() and jobs_private.is_assignable(s.user_id);
$$;
create or replace function jobs_private.transition_application(p_id uuid,p_stage text,p_assignee uuid,p_expected_version integer) returns public.jobs_applications language plpgsql security definer set search_path='' as $$
declare r public.jobs_applications;allowed text[];
begin
 if not jobs_private.can_recruit() then raise exception 'jobs.forbidden' using errcode='42501';end if;
 select * into r from public.jobs_applications where id=p_id for update;
 if not found then raise exception 'jobs.not_found' using errcode='P0002';end if;
 if r.version is distinct from p_expected_version then raise exception 'jobs.version_conflict' using errcode='40001';end if;
 if p_assignee is not null and not jobs_private.is_assignable(p_assignee) then raise exception 'jobs.assignee_invalid' using errcode='23514';end if;
 allowed:=case r.stage when 'submitted' then array['submitted','screening','rejected','withdrawn'] when 'screening' then array['screening','shortlisted','rejected','withdrawn'] when 'shortlisted' then array['shortlisted','interview','rejected','withdrawn'] when 'interview' then array['interview','offer','rejected','withdrawn'] when 'offer' then array['offer','hired','rejected','withdrawn'] else array[r.stage] end;
 if p_stage is null or not p_stage=any(allowed) then raise exception 'jobs.stage_invalid' using errcode='23514';end if;
 update public.jobs_applications set stage=p_stage,assigned_staff_id=p_assignee,version=version+1,updated_at=clock_timestamp() where id=p_id returning * into r;
 insert into public.jobs_application_events(application_id,stage,actor_id) values(r.id,r.stage,auth.uid());return r;
end;$$;
revoke all on function jobs_private.role(),jobs_private.staff_directory(),jobs_private.transition_application(uuid,text,uuid,integer) from public,anon;
grant execute on function jobs_private.role(),jobs_private.staff_directory(),jobs_private.transition_application(uuid,text,uuid,integer) to authenticated;
create or replace function jobs_private.lock_staff_admin() returns jobs_private.staff_members language plpgsql security definer set search_path='' as $$
declare actor jobs_private.staff_members;
begin
 perform pg_advisory_xact_lock(hashtextextended('jobs.staff_access',0));
 select s.* into actor from jobs_private.staff_members s join auth.users u on u.id=s.user_id
  where s.user_id=(select auth.uid()) and s.active and s.role='admin' and jobs_private.staff_identity_eligible(s.user_id)
  for update of s;
 if not found then raise exception 'jobs.forbidden' using errcode='42501';end if;
 return actor;
end;$$;
revoke all on function jobs_private.lock_staff_admin() from public,anon,authenticated;
create or replace function jobs_private.staff_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare viewer jobs_private.staff_members;
begin
 select s.* into viewer from jobs_private.staff_members s join auth.users u on u.id=s.user_id
  where s.user_id=(select auth.uid()) and s.active and s.role='admin' and jobs_private.staff_identity_eligible(s.user_id);
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
revoke all on function jobs_private.staff_overview() from public,anon;
grant execute on function jobs_private.staff_overview() to authenticated;
commit;
