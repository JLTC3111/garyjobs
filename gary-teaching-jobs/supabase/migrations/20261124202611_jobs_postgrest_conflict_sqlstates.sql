-- Deterministic application conflicts must reach the caller as HTTP 409.
-- PostgreSQL's own serialization failures and deadlocks retain their SQLSTATEs.
begin;
set local search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION jobs_private.save_content(p_record jsonb, p_expected_version integer)
 RETURNS jobs_cms_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.jobs_cms_entries; v_id uuid; v_existing boolean;
begin
 if not jobs_private.can_edit() then raise exception 'jobs.forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_record)<>'object' or octet_length(p_record::text)>131072 then raise exception 'jobs.invalid_content' using errcode='22023';end if;
 v_id:=coalesce(nullif(p_record->>'id','')::uuid,gen_random_uuid());
 select * into r from public.jobs_cms_entries where id=v_id for update;v_existing:=found;
 if v_existing then
  if p_expected_version is distinct from r.version then raise exception 'jobs.version_conflict' using errcode='PT409';end if;
  if p_record->>'kind' is distinct from r.kind then raise exception 'jobs.kind_immutable' using errcode='23514';end if;
 else
  if p_expected_version is not null and p_expected_version<>0 then raise exception 'jobs.version_conflict' using errcode='PT409';end if;
  r.id:=v_id;r.kind:=p_record->>'kind';r.version:=0;r.created_at:=now();r.created_by:=auth.uid();
 end if;
 r.slug:=trim(p_record->>'slug');r.title_en:=coalesce(p_record->>'title_en','');r.title_vi:=coalesce(p_record->>'title_vi','');
 r.summary_en:=coalesce(p_record->>'summary_en','');r.summary_vi:=coalesce(p_record->>'summary_vi','');
 r.body_en:=coalesce(p_record->>'body_en','');r.body_vi:=coalesce(p_record->>'body_vi','');
 r.seo_title_en:=coalesce(p_record->>'seo_title_en','');r.seo_title_vi:=coalesce(p_record->>'seo_title_vi','');
 r.seo_description_en:=coalesce(p_record->>'seo_description_en','');r.seo_description_vi:=coalesce(p_record->>'seo_description_vi','');
 r.data:=coalesce(p_record->'data','{}');r.status:='draft';r.version:=r.version+1;r.updated_at:=clock_timestamp();r.updated_by:=auth.uid();
 if v_existing then update public.jobs_cms_entries set slug=r.slug,title_en=r.title_en,title_vi=r.title_vi,summary_en=r.summary_en,summary_vi=r.summary_vi,body_en=r.body_en,body_vi=r.body_vi,seo_title_en=r.seo_title_en,seo_title_vi=r.seo_title_vi,seo_description_en=r.seo_description_en,seo_description_vi=r.seo_description_vi,data=r.data,status=r.status,version=r.version,updated_at=r.updated_at,updated_by=r.updated_by where id=r.id;
 else insert into public.jobs_cms_entries select r.*;end if;
 insert into public.jobs_cms_revisions(entry_id,version,status,snapshot,actor_id) values(r.id,r.version,r.status,to_jsonb(r),auth.uid());return r;
end;$function$;

CREATE OR REPLACE FUNCTION jobs_private.transition_application(p_id uuid, p_stage text, p_assignee uuid, p_expected_version integer)
 RETURNS jobs_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.jobs_applications;allowed text[];
begin
 if not jobs_private.can_recruit() then raise exception 'jobs.forbidden' using errcode='42501';end if;
 select * into r from public.jobs_applications where id=p_id for update;
 if not found then raise exception 'jobs.not_found' using errcode='P0002';end if;
 if r.version is distinct from p_expected_version then raise exception 'jobs.version_conflict' using errcode='PT409';end if;
 if p_assignee is not null and not exists(select 1 from jobs_private.staff_members where user_id=p_assignee and active and role in('recruiter','admin')) then raise exception 'jobs.assignee_invalid' using errcode='23514';end if;
 allowed:=case r.stage when 'submitted' then array['submitted','screening','rejected','withdrawn'] when 'screening' then array['screening','shortlisted','rejected','withdrawn'] when 'shortlisted' then array['shortlisted','interview','rejected','withdrawn'] when 'interview' then array['interview','offer','rejected','withdrawn'] when 'offer' then array['offer','hired','rejected','withdrawn'] else array[r.stage] end;
 if p_stage is null or not p_stage=any(allowed) then raise exception 'jobs.stage_invalid' using errcode='23514';end if;
 update public.jobs_applications set stage=p_stage,assigned_staff_id=p_assignee,version=version+1,updated_at=clock_timestamp() where id=p_id returning * into r;
 insert into public.jobs_application_events(application_id,stage,actor_id) values(r.id,r.stage,auth.uid());return r;
end;$function$;

CREATE OR REPLACE FUNCTION jobs_private.transition_content(p_id uuid, p_status text, p_expected_version integer)
 RETURNS jobs_cms_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.jobs_cms_entries;exp date;previous_slug text;
begin
 if not jobs_private.can_edit() then raise exception 'jobs.forbidden' using errcode='42501';end if;
 if p_status not in('draft','review','published','archived') then raise exception 'jobs.invalid_status' using errcode='22023';end if;
 if p_status in('published','archived') and not jobs_private.can_publish() then raise exception 'jobs.publisher_required' using errcode='42501';end if;
 select * into r from public.jobs_cms_entries where id=p_id for update;
 if not found then raise exception 'jobs.not_found' using errcode='P0002';end if;
 if r.version is distinct from p_expected_version then raise exception 'jobs.version_conflict' using errcode='PT409';end if;
 if p_status='published' then
  if r.kind<>'vacancy' and r.status<>'review' then raise exception 'jobs.review_required' using errcode='23514';end if;
  perform jobs_private.check_publication(r);
  if r.kind in('employer','category','location') then
   select slug into previous_slug from public.jobs_public_content where id=r.id;
   if previous_slug is not null and previous_slug<>r.slug and exists(select 1 from public.jobs_public_content p where p.kind='vacancy' and (p.expires_on is null or p.expires_on>=current_date) and p.data->>(case r.kind when 'employer' then 'employer_slug' when 'category' then 'category_slug' else 'location_slug' end)=previous_slug) then raise exception 'jobs.reference_in_use' using errcode='23514';end if;
  end if;
  r.published_at:=clock_timestamp();
  if r.kind='vacancy' then exp:=(r.data->>'closes_on')::date;end if;
 end if;
 r.status:=p_status;r.version:=r.version+1;r.updated_at:=clock_timestamp();r.updated_by:=auth.uid();
 update public.jobs_cms_entries set status=r.status,version=r.version,updated_at=r.updated_at,updated_by=r.updated_by,published_at=r.published_at where id=r.id;
 if p_status='published' then
  insert into public.jobs_public_content(id,kind,slug,title_en,title_vi,summary_en,summary_vi,body_en,body_vi,seo_title_en,seo_title_vi,seo_description_en,seo_description_vi,data,version,published_at,updated_at,expires_on)
  values(r.id,r.kind,r.slug,r.title_en,r.title_vi,r.summary_en,r.summary_vi,r.body_en,r.body_vi,r.seo_title_en,r.seo_title_vi,r.seo_description_en,r.seo_description_vi,r.data,r.version,r.published_at,r.updated_at,exp)
  on conflict(id) do update set kind=excluded.kind,slug=excluded.slug,title_en=excluded.title_en,title_vi=excluded.title_vi,summary_en=excluded.summary_en,summary_vi=excluded.summary_vi,body_en=excluded.body_en,body_vi=excluded.body_vi,seo_title_en=excluded.seo_title_en,seo_title_vi=excluded.seo_title_vi,seo_description_en=excluded.seo_description_en,seo_description_vi=excluded.seo_description_vi,data=excluded.data,version=excluded.version,published_at=excluded.published_at,updated_at=excluded.updated_at,expires_on=excluded.expires_on;
 elsif p_status='archived' then
  if r.kind in('employer','category','location') then
   -- A working draft may have a different slug from the published snapshot.
   -- Guard the identity being removed, not the unpublished replacement name.
   select slug into previous_slug from public.jobs_public_content where id=r.id;
   previous_slug:=coalesce(previous_slug,r.slug);
   if exists(select 1 from public.jobs_public_content p where p.kind='vacancy' and (p.expires_on is null or p.expires_on>=current_date) and p.data->>(case r.kind when 'employer' then 'employer_slug' when 'category' then 'category_slug' else 'location_slug' end)=previous_slug) then raise exception 'jobs.reference_in_use' using errcode='23514';end if;
  end if;
  delete from public.jobs_public_content where id=r.id;
 end if;
 insert into public.jobs_cms_revisions(entry_id,version,status,snapshot,actor_id) values(r.id,r.version,r.status,to_jsonb(r),auth.uid());return r;
end;$function$;

CREATE OR REPLACE FUNCTION jobs_private.update_staff(p_user_id uuid, p_role text, p_active boolean, p_display_name text, p_expected_version integer)
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
 if not found then raise exception 'jobs.staff_not_found' using errcode='P0002';end if;
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

commit;
