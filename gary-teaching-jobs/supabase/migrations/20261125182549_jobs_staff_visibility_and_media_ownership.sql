-- Apply in Teaching Jobs after the current staff management and vacancy image migrations.
begin;

create function jobs_private.can_view_staff_account(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select jobs_private.role() is not null and exists(
    select 1 from jobs_private.staff_members s
    where s.user_id=p_user and (
      s.user_id=(select auth.uid()) or jobs_private.can_manage_admins() or (
        not s.protected and case jobs_private.role()
          when 'admin' then s.role in ('recruiter','publisher','editor')
          when 'publisher' then s.role='editor'
          else false end
      )
    )
  );
$$;

-- Recruitment access still covers candidates. A staff member's candidate row
-- also has to satisfy the account hierarchy if another person requests it.
create function jobs_private.staff_profile_visible(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from jobs_private.staff_members where user_id=p_user)
    or jobs_private.can_view_staff_account(p_user);
$$;
create policy jobs_candidates_staff_visibility on public.jobs_candidates
  as restrictive for select to authenticated
  using(id=(select auth.uid()) or jobs_private.staff_profile_visible(id));

revoke all on function jobs_private.can_view_staff_account(uuid),jobs_private.staff_profile_visible(uuid)
  from public,anon,authenticated;
grant execute on function jobs_private.staff_profile_visible(uuid) to authenticated;

-- The recruitment picker discloses only names and IDs of selectable staff.
-- The third column remains for compatibility with existing callers.
create or replace function jobs_private.staff_directory() returns table(user_id uuid,full_name text,role text)
language sql stable security definer set search_path='' as $$
  select s.user_id,coalesce(nullif(btrim(s.display_name),''),nullif(btrim(p.full_name),''),'Recruitment team'),null::text
  from jobs_private.staff_members s left join public.jobs_candidates p on p.id=s.user_id
  where jobs_private.can_recruit() and jobs_private.is_assignable(s.user_id)
  order by 2,s.user_id;
$$;

create or replace function jobs_private.staff_overview() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare viewer jobs_private.staff_members; manages boolean; owner boolean;
begin
  select * into viewer from jobs_private.staff_members s
    where s.user_id=(select auth.uid()) and s.active and jobs_private.staff_identity_eligible(s.user_id);
  if not found then raise exception 'jobs.forbidden' using errcode='42501'; end if;
  manages:=viewer.role='admin';
  owner:=manages and viewer.protected;
  return jsonb_build_object(
    'viewer',jsonb_build_object('user_id',viewer.user_id,'protected',viewer.protected,
      'can_manage_staff',manages,'can_manage_admins',owner),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'user_id',s.user_id,'email',u.email,'display_name',s.display_name,
      'name',coalesce(nullif(s.display_name,''),nullif(trim(p.full_name),'')),
      'role',s.role,'active',s.active,'protected',s.protected,'email_confirmed',u.email_confirmed_at is not null,
      'version',s.version,'created_at',s.created_at,'updated_at',s.updated_at,
      'is_self',s.user_id=viewer.user_id,
      'can_manage',manages and s.user_id<>viewer.user_id and not s.protected and (s.role<>'admin' or owner)
    ) order by s.active desc,lower(coalesce(nullif(s.display_name,''),u.email)),s.user_id)
    from jobs_private.staff_members s join auth.users u on u.id=s.user_id
    left join public.jobs_candidates p on p.id=s.user_id
    where jobs_private.can_view_staff_account(s.user_id)),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(
      case when owner then to_jsonb(e)
        when jobs_private.can_view_staff_account(e.actor_user_id) or e.actor_user_id is null then to_jsonb(e)-'id'
        else (to_jsonb(e)-array['id','actor_user_id','actor_email'])||jsonb_build_object('actor_hidden',true)
      end order by e.created_at desc,e.id desc)
      from (
        select * from jobs_private.staff_audit_events
        where manages and (owner or (
          jobs_private.can_view_staff_account(target_user_id)
          and (target_user_id=viewer.user_id or (
            not coalesce(previous_protected,false) and not coalesce(new_protected,false)
            and previous_role is distinct from 'admin' and new_role is distinct from 'admin'
          ))
        ))
        order by created_at desc,id desc limit 50
      ) e),'[]'::jsonb)
  );
end;
$$;

-- Protected and verified Jobs admins are the existing site Owners.
create or replace function public.jobs_capabilities() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('role',jobs_private.role(),'read',jobs_private.can_edit(),'edit',jobs_private.can_edit(),
    'publish',jobs_private.can_publish(),'media',jobs_private.can_manage_admins(),'recruit',jobs_private.can_recruit(),
    'view_staff',jobs_private.role() is not null,
    'manage_staff',jobs_private.can_manage_staff(),'manage_admins',jobs_private.can_manage_admins());
$$;

alter policy jobs_media_read on public.jobs_cms_media using((select jobs_private.can_manage_admins()));
alter policy jobs_media_insert on public.jobs_cms_media with check(
  (select jobs_private.can_manage_admins()) and created_by=(select auth.uid()) and object_path like (select auth.uid())::text||'/%');
drop policy jobs_media_object_read on storage.objects;
create policy jobs_media_object_read on storage.objects for select to authenticated
  using(bucket_id='jobs-media' and (select jobs_private.can_manage_admins()));
alter policy jobs_storage_read_guard on storage.objects using(
  (bucket_id<>'jobs-cv' or jobs_private.can_read_cv(name))
  and (bucket_id<>'jobs-media' or (select jobs_private.can_manage_admins())));
alter policy jobs_storage_anon_guard on storage.objects
  using(bucket_id not in('jobs-cv','jobs-media')) with check(bucket_id not in('jobs-cv','jobs-media'));
alter policy jobs_media_object_insert on storage.objects with check(
  bucket_id='jobs-media' and (select jobs_private.can_manage_admins()) and name like (select auth.uid())::text||'/%');
alter policy jobs_storage_write_guard on storage.objects with check(
  (bucket_id<>'jobs-cv' or jobs_private.can_upload_cv(name))
  and (bucket_id<>'jobs-media' or ((select jobs_private.can_manage_admins()) and name like (select auth.uid())::text||'/%')));

create or replace function jobs_private.assign_staff(p_email text,p_role text,p_display_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor jobs_private.staff_members;r jobs_private.staff_members;v_email text:=lower(trim(coalesce(p_email,'')));v_name text:=trim(coalesce(p_display_name,''));v_ids uuid[];
begin
 actor:=jobs_private.lock_staff_admin();
 if p_role is null or p_role not in('editor','publisher','recruiter','admin') then raise exception 'jobs.role_invalid' using errcode='22023';end if;
 if char_length(v_name)>120 then raise exception 'jobs.name_invalid' using errcode='22023';end if;
 if p_role='admin' and not actor.protected then raise exception 'jobs.owner_required' using errcode='42501';end if;
 -- Unknown, unverified and ambiguous addresses share one answer.
 if v_email<>'' and char_length(v_email)<=254 then
  select array_agg(id) into v_ids from auth.users where lower(email)=v_email and jobs_private.staff_identity_eligible(id);
 end if;
 if coalesce(array_length(v_ids,1),0)<>1 then raise exception 'jobs.account_unavailable' using errcode='P0002';end if;
 if v_ids[1]=actor.user_id then raise exception 'jobs.self_change_forbidden' using errcode='42501';end if;
 if exists(select 1 from jobs_private.staff_members where user_id=v_ids[1]) then
  if not jobs_private.can_view_staff_account(v_ids[1]) then
   raise exception 'jobs.account_unavailable' using errcode='P0002';
  end if;
  raise exception 'jobs.staff_exists' using errcode='23505';
 end if;
 insert into jobs_private.staff_members(user_id,role,active,display_name,updated_by) values(v_ids[1],p_role,true,v_name,actor.user_id) returning * into r;
 return jsonb_build_object('user_id',r.user_id,'role',r.role,'active',r.active,'version',r.version);
end;$$;

create or replace function jobs_private.update_staff(p_user_id uuid, p_role text, p_active boolean, p_display_name text, p_expected_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor jobs_private.staff_members;r jobs_private.staff_members;v_name text;
begin
 actor:=jobs_private.lock_staff_admin();
 if p_role is null or p_role not in('editor','publisher','recruiter','admin') then raise exception 'jobs.role_invalid' using errcode='22023';end if;
 if p_user_id is null or p_active is null or p_expected_version is null then raise exception 'jobs.staff_request_invalid' using errcode='22023';end if;
 if p_user_id=actor.user_id then raise exception 'jobs.self_change_forbidden' using errcode='42501';end if;
 select * into r from jobs_private.staff_members where user_id=p_user_id for update;
 if not found or not jobs_private.can_view_staff_account(p_user_id) then
  raise exception 'jobs.staff_not_found' using errcode='P0002';
 end if;
 if r.protected then raise exception 'jobs.protected_account' using errcode='42501';end if;
 if (r.role='admin' or p_role='admin') and not actor.protected then raise exception 'jobs.owner_required' using errcode='42501';end if;
 if r.version<>p_expected_version then raise exception 'jobs.version_conflict' using errcode='PT409';end if;
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
end;$function$;

create or replace function jobs_private.forget_vacancy_image(p_image_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare image jobs_private.vacancy_images; draft jsonb; live jsonb;
begin
 if not jobs_private.can_manage_admins() then raise exception 'jobs.forbidden' using errcode='42501'; end if;
 select * into image from jobs_private.vacancy_images
  where id=p_image_id and state in ('ready','discarding') and vacancy_id is not null for update;
 if not found then raise exception 'jobs.vacancy_image_invalid' using errcode='23514'; end if;
 select data into draft from public.jobs_cms_entries where id=image.vacancy_id and kind='vacancy';
 if not found then raise exception 'jobs.vacancy_image_invalid' using errcode='23514'; end if;
 select data into live from public.jobs_public_content where id=image.vacancy_id and kind='vacancy';
 if jobs_private.vacancy_gallery_has(draft, p_image_id) or jobs_private.vacancy_gallery_has(live, p_image_id) then
  raise exception 'jobs.vacancy_image_in_use' using errcode='23514';
 end if;
 update jobs_private.vacancy_images set state='discarding' where id=p_image_id;
 return p_image_id;
end;$$;

notify pgrst,'reload schema';
commit;
