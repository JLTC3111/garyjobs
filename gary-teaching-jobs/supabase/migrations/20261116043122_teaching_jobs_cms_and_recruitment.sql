begin;

-- Jobs owns its content and permissions. Home/Agency memberships confer no access.
create schema if not exists jobs_private;
revoke all on schema jobs_private from public,anon;
grant usage on schema jobs_private to authenticated;
create table jobs_private.staff_members(
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check(role in('editor','publisher','recruiter','admin')),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table jobs_private.staff_members enable row level security;
revoke all on jobs_private.staff_members from public,anon,authenticated;
create function jobs_private.role() returns text language sql stable security definer set search_path='' as $$
 select s.role from jobs_private.staff_members s join auth.users u on u.id=s.user_id
 where s.user_id=(select auth.uid()) and s.active and u.email_confirmed_at is not null
$$;
create function jobs_private.can_edit() returns boolean language sql stable security definer set search_path='' as $$select coalesce(jobs_private.role() in('editor','publisher','admin'),false)$$;
create function jobs_private.can_publish() returns boolean language sql stable security definer set search_path='' as $$select coalesce(jobs_private.role() in('publisher','admin'),false)$$;
create function jobs_private.can_recruit() returns boolean language sql stable security definer set search_path='' as $$select coalesce(jobs_private.role() in('recruiter','admin'),false)$$;
revoke all on function jobs_private.role(),jobs_private.can_edit(),jobs_private.can_publish(),jobs_private.can_recruit() from public,anon;
grant execute on function jobs_private.role(),jobs_private.can_edit(),jobs_private.can_publish(),jobs_private.can_recruit() to authenticated;

create table public.jobs_cms_entries(
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in('vacancy','employer','category','location','guide','faq')),
 slug text not null check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug)<=180),
 title_en text not null default '',title_vi text not null default '',
 summary_en text not null default '',summary_vi text not null default '',
 body_en text not null default '',body_vi text not null default '',
 seo_title_en text not null default '',seo_title_vi text not null default '',
 seo_description_en text not null default '',seo_description_vi text not null default '',
 data jsonb not null default '{}' check(jsonb_typeof(data)='object' and octet_length(data::text)<=65536),
 status text not null default 'draft' check(status in('draft','review','published','archived')),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),published_at timestamptz,
 created_by uuid references auth.users(id),updated_by uuid references auth.users(id),
 unique(kind,slug)
);
create index jobs_cms_kind_status_updated on public.jobs_cms_entries(kind,status,updated_at desc,id);
create table public.jobs_public_content(
 id uuid primary key references public.jobs_cms_entries(id) on delete cascade,
 kind text not null,slug text not null,title_en text not null,title_vi text not null,
 summary_en text not null,summary_vi text not null,body_en text not null,body_vi text not null,
 seo_title_en text not null,seo_title_vi text not null,seo_description_en text not null,seo_description_vi text not null,
 data jsonb not null,version integer not null,published_at timestamptz not null,updated_at timestamptz not null,
 expires_on date, unique(kind,slug)
);
create index jobs_public_kind_date on public.jobs_public_content(kind,published_at desc,id);
create table public.jobs_cms_revisions(
 id uuid primary key default gen_random_uuid(),entry_id uuid not null references public.jobs_cms_entries(id) on delete cascade,
 version integer not null,status text not null,snapshot jsonb not null,
 created_at timestamptz not null default now(),actor_id uuid references auth.users(id),unique(entry_id,version)
);
create index jobs_revisions_entry_version on public.jobs_cms_revisions(entry_id,version desc);
create table public.jobs_cms_media(
 id uuid primary key default gen_random_uuid(),object_path text not null unique,file_name text not null,
 mime_type text not null check(mime_type in('image/jpeg','image/png','image/webp','image/avif')),
 size_bytes integer not null check(size_bytes between 1 and 8388608),alt_en text not null check(char_length(trim(alt_en)) between 2 and 500),alt_vi text not null check(char_length(trim(alt_vi)) between 2 and 500),
 created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now()
);
alter table public.jobs_cms_entries enable row level security;
alter table public.jobs_public_content enable row level security;
alter table public.jobs_cms_revisions enable row level security;
alter table public.jobs_cms_media enable row level security;
revoke all on public.jobs_cms_entries,public.jobs_public_content,public.jobs_cms_revisions,public.jobs_cms_media from public,anon,authenticated;
grant select on public.jobs_cms_entries,public.jobs_cms_revisions,public.jobs_cms_media to authenticated;
grant select on public.jobs_public_content to anon,authenticated;
grant insert on public.jobs_cms_media to authenticated;
create policy jobs_cms_read on public.jobs_cms_entries for select to authenticated using(jobs_private.can_edit());
create policy jobs_revisions_read on public.jobs_cms_revisions for select to authenticated using(jobs_private.can_edit());
create policy jobs_media_read on public.jobs_cms_media for select to authenticated using(jobs_private.can_edit());
create policy jobs_media_insert on public.jobs_cms_media for insert to authenticated with check(jobs_private.can_edit() and created_by=(select auth.uid()) and object_path like (select auth.uid())::text||'/%');
create policy jobs_published_read on public.jobs_public_content for select to anon,authenticated using(kind<>'vacancy' or expires_on is null or expires_on>=current_date);

create function jobs_private.check_publication(r public.jobs_cms_entries) returns void language plpgsql set search_path='' as $$
begin
 if least(char_length(trim(r.title_en)),char_length(trim(r.title_vi)))<3 or least(char_length(trim(r.summary_en)),char_length(trim(r.summary_vi)))<10 then
  raise exception 'jobs.translation_required' using errcode='23514';end if;
 if r.kind in('vacancy','guide','faq') and least(char_length(trim(r.body_en)),char_length(trim(r.body_vi)))<20 then raise exception 'jobs.body_required' using errcode='23514';end if;
 if r.kind='vacancy' then
  if coalesce(r.data->>'closes_on','')='' then raise exception 'jobs.expiry_required' using errcode='23514';end if;
  if (r.data->>'closes_on')::date<current_date then raise exception 'jobs.expiry_past' using errcode='23514';end if;
  if coalesce(r.data->>'contact_email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'jobs.contact_required' using errcode='23514';end if;
  if not exists(select 1 from public.jobs_public_content p where p.kind='employer' and p.slug=r.data->>'employer_slug')
   or not exists(select 1 from public.jobs_public_content p where p.kind='category' and p.slug=r.data->>'category_slug')
   or not exists(select 1 from public.jobs_public_content p where p.kind='location' and p.slug=r.data->>'location_slug') then
    raise exception 'jobs.references_required' using errcode='23514';end if;
 end if;
end;$$;
revoke all on function jobs_private.check_publication(public.jobs_cms_entries) from public,anon,authenticated;
create function jobs_private.save_content(p_record jsonb,p_expected_version integer) returns public.jobs_cms_entries language plpgsql security definer set search_path='' as $$
declare r public.jobs_cms_entries; v_id uuid; v_existing boolean;
begin
 if not jobs_private.can_edit() then raise exception 'jobs.forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_record)<>'object' or octet_length(p_record::text)>131072 then raise exception 'jobs.invalid_content' using errcode='22023';end if;
 v_id:=coalesce(nullif(p_record->>'id','')::uuid,gen_random_uuid());
 select * into r from public.jobs_cms_entries where id=v_id for update;v_existing:=found;
 if v_existing then
  if p_expected_version is distinct from r.version then raise exception 'jobs.version_conflict' using errcode='40001';end if;
  if p_record->>'kind' is distinct from r.kind then raise exception 'jobs.kind_immutable' using errcode='23514';end if;
 else
  if p_expected_version is not null and p_expected_version<>0 then raise exception 'jobs.version_conflict' using errcode='40001';end if;
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
end;$$;
create function jobs_private.transition_content(p_id uuid,p_status text,p_expected_version integer) returns public.jobs_cms_entries language plpgsql security definer set search_path='' as $$
declare r public.jobs_cms_entries;exp date;previous_slug text;
begin
 if not jobs_private.can_edit() then raise exception 'jobs.forbidden' using errcode='42501';end if;
 if p_status not in('draft','review','published','archived') then raise exception 'jobs.invalid_status' using errcode='22023';end if;
 if p_status in('published','archived') and not jobs_private.can_publish() then raise exception 'jobs.publisher_required' using errcode='42501';end if;
 select * into r from public.jobs_cms_entries where id=p_id for update;
 if not found then raise exception 'jobs.not_found' using errcode='P0002';end if;
 if r.version is distinct from p_expected_version then raise exception 'jobs.version_conflict' using errcode='40001';end if;
 if p_status='published' then
  if r.status<>'review' then raise exception 'jobs.review_required' using errcode='23514';end if;
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
end;$$;
create function public.jobs_cms_save(p_record jsonb,p_expected_version integer default null) returns public.jobs_cms_entries language sql security invoker set search_path='' as $$select jobs_private.save_content(p_record,p_expected_version)$$;
create function public.jobs_cms_transition(p_id uuid,p_status text,p_expected_version integer) returns public.jobs_cms_entries language sql security invoker set search_path='' as $$select jobs_private.transition_content(p_id,p_status,p_expected_version)$$;
create function jobs_private.restore_content(p_id uuid,p_revision_id uuid,p_expected_version integer) returns public.jobs_cms_entries language plpgsql security definer set search_path='' as $$
declare snap jsonb;
begin
 if not jobs_private.can_edit() then raise exception 'jobs.forbidden' using errcode='42501';end if;
 select snapshot into snap from public.jobs_cms_revisions where id=p_revision_id and entry_id=p_id;
 if not found then raise exception 'jobs.not_found' using errcode='P0002';end if;
 return jobs_private.save_content(snap,p_expected_version);
end;$$;
create function public.jobs_cms_restore(p_id uuid,p_revision_id uuid,p_expected_version integer) returns public.jobs_cms_entries language sql security invoker set search_path='' as $$select jobs_private.restore_content(p_id,p_revision_id,p_expected_version)$$;
create function public.jobs_capabilities() returns jsonb language sql security invoker set search_path='' as $$select jsonb_build_object('role',jobs_private.role(),'read',jobs_private.can_edit(),'edit',jobs_private.can_edit(),'publish',jobs_private.can_publish(),'media',jobs_private.can_edit(),'recruit',jobs_private.can_recruit())$$;

create table public.jobs_candidates(
 id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 full_name text not null check(char_length(trim(full_name)) between 2 and 100),
 email text not null,phone text not null default '' check(char_length(phone)<=60),
 current_location text not null default '' check(char_length(current_location)<=200),
 consent_at timestamptz not null default now(),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.jobs_applications(
 id uuid primary key default gen_random_uuid(),receipt_code text not null unique default 'GJ-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
 candidate_id uuid not null references public.jobs_candidates(id),vacancy_id uuid references public.jobs_cms_entries(id),
 vacancy_title text not null,message text not null default '' check(char_length(message)<=5000),client_request_id uuid not null,
 stage text not null default 'submitted' check(stage in('submitted','screening','shortlisted','interview','offer','hired','rejected','withdrawn')),
 assigned_staff_id uuid references jobs_private.staff_members(user_id),version integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(candidate_id,client_request_id)
);
create index jobs_apps_candidate_date on public.jobs_applications(candidate_id,created_at desc,id);
create index jobs_apps_stage_assignee_date on public.jobs_applications(stage,assigned_staff_id,created_at desc,id);
create table public.jobs_application_events(
 id uuid primary key default gen_random_uuid(),application_id uuid not null references public.jobs_applications(id) on delete cascade,
 stage text not null,actor_id uuid references auth.users(id),created_at timestamptz not null default now()
);
create index jobs_app_events_app_date on public.jobs_application_events(application_id,created_at,id);
create table public.jobs_recruitment_notes(
 id uuid primary key default gen_random_uuid(),application_id uuid not null references public.jobs_applications(id) on delete cascade,
 body text not null check(char_length(trim(body)) between 1 and 5000),actor_id uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now()
);
create table public.jobs_application_documents(
 id uuid primary key default gen_random_uuid(),application_id uuid not null references public.jobs_applications(id) on delete cascade,
 candidate_id uuid not null references public.jobs_candidates(id),object_path text not null unique,file_name text not null check(char_length(file_name)<=200),
 mime_type text not null check(mime_type in('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
 size_bytes integer not null check(size_bytes between 1 and 10485760),created_at timestamptz not null default now()
);
alter table public.jobs_candidates enable row level security;
alter table public.jobs_applications enable row level security;
alter table public.jobs_application_events enable row level security;
alter table public.jobs_recruitment_notes enable row level security;
alter table public.jobs_application_documents enable row level security;
revoke all on public.jobs_candidates,public.jobs_applications,public.jobs_application_events,public.jobs_recruitment_notes,public.jobs_application_documents from public,anon,authenticated;
grant select on public.jobs_candidates,public.jobs_applications,public.jobs_application_events,public.jobs_recruitment_notes,public.jobs_application_documents to authenticated;
grant insert on public.jobs_recruitment_notes,public.jobs_application_documents to authenticated;
create policy jobs_candidate_read on public.jobs_candidates for select to authenticated using(id=(select auth.uid()) or jobs_private.can_recruit());
create policy jobs_application_read on public.jobs_applications for select to authenticated using(candidate_id=(select auth.uid()) or jobs_private.can_recruit());
create policy jobs_event_read on public.jobs_application_events for select to authenticated using(exists(select 1 from public.jobs_applications a where a.id=application_id));
create policy jobs_notes_read on public.jobs_recruitment_notes for select to authenticated using(jobs_private.can_recruit());
create policy jobs_notes_insert on public.jobs_recruitment_notes for insert to authenticated with check(jobs_private.can_recruit() and actor_id=(select auth.uid()));
create policy jobs_document_read on public.jobs_application_documents for select to authenticated using(candidate_id=(select auth.uid()) or jobs_private.can_recruit());
create policy jobs_document_insert on public.jobs_application_documents for insert to authenticated with check(candidate_id=(select auth.uid()) and object_path like candidate_id::text||'/'||application_id::text||'/%' and exists(select 1 from public.jobs_applications a where a.id=application_id and a.candidate_id=(select auth.uid())));

create function jobs_private.submit_application(p_vacancy_id uuid,p_profile jsonb,p_message text,p_client_request_id uuid) returns public.jobs_applications language plpgsql security definer set search_path='' as $$
declare r public.jobs_applications;v_user uuid:=auth.uid();v_email text;v_title text;v_name text;
begin
 if v_user is null then raise exception 'jobs.sign_in_required' using errcode='42501';end if;
 select lower(email) into v_email from auth.users where id=v_user and email_confirmed_at is not null;
 if v_email is null then raise exception 'jobs.email_verification_required' using errcode='42501';end if;
 if p_client_request_id is null then raise exception 'jobs.request_id_required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_user::text,21));
 select * into r from public.jobs_applications where candidate_id=v_user and client_request_id=p_client_request_id;
 if found then return r;end if;
 v_name:=trim(p_profile->>'full_name');
 if v_name is null or char_length(v_name) not between 2 and 100 or char_length(coalesce(p_message,''))>5000 or coalesce((p_profile->>'consent')::boolean,false)<>true then raise exception 'jobs.application_invalid' using errcode='23514';end if;
 if (select count(*) from public.jobs_applications where candidate_id=v_user and created_at>clock_timestamp()-interval '24 hours')>=10 then raise exception 'jobs.intake_limit' using errcode='P0001';end if;
 if p_vacancy_id is not null then
  select title_en into v_title from public.jobs_public_content where id=p_vacancy_id and kind='vacancy' and (expires_on is null or expires_on>=current_date);
  if not found then raise exception 'jobs.vacancy_closed' using errcode='23514';end if;
 else v_title:='General introduction';end if;
 insert into public.jobs_candidates(id,full_name,email,phone,current_location) values(v_user,v_name,v_email,coalesce(p_profile->>'phone',''),coalesce(p_profile->>'current_location',''))
 on conflict(id) do update set full_name=excluded.full_name,email=excluded.email,phone=excluded.phone,current_location=excluded.current_location,updated_at=clock_timestamp(),consent_at=clock_timestamp();
 insert into public.jobs_applications(candidate_id,vacancy_id,vacancy_title,message,client_request_id) values(v_user,p_vacancy_id,v_title,coalesce(p_message,''),p_client_request_id) returning * into r;
 insert into public.jobs_application_events(application_id,stage,actor_id) values(r.id,r.stage,v_user);return r;
end;$$;
create function public.jobs_submit_application(p_vacancy_id uuid,p_profile jsonb,p_message text,p_client_request_id uuid) returns public.jobs_applications language sql security invoker set search_path='' as $$select jobs_private.submit_application(p_vacancy_id,p_profile,p_message,p_client_request_id)$$;
create function jobs_private.transition_application(p_id uuid,p_stage text,p_assignee uuid,p_expected_version integer) returns public.jobs_applications language plpgsql security definer set search_path='' as $$
declare r public.jobs_applications;allowed text[];
begin
 if not jobs_private.can_recruit() then raise exception 'jobs.forbidden' using errcode='42501';end if;
 select * into r from public.jobs_applications where id=p_id for update;
 if not found then raise exception 'jobs.not_found' using errcode='P0002';end if;
 if r.version is distinct from p_expected_version then raise exception 'jobs.version_conflict' using errcode='40001';end if;
 if p_assignee is not null and not exists(select 1 from jobs_private.staff_members where user_id=p_assignee and active and role in('recruiter','admin')) then raise exception 'jobs.assignee_invalid' using errcode='23514';end if;
 allowed:=case r.stage when 'submitted' then array['submitted','screening','rejected','withdrawn'] when 'screening' then array['screening','shortlisted','rejected','withdrawn'] when 'shortlisted' then array['shortlisted','interview','rejected','withdrawn'] when 'interview' then array['interview','offer','rejected','withdrawn'] when 'offer' then array['offer','hired','rejected','withdrawn'] else array[r.stage] end;
 if p_stage is null or not p_stage=any(allowed) then raise exception 'jobs.stage_invalid' using errcode='23514';end if;
 update public.jobs_applications set stage=p_stage,assigned_staff_id=p_assignee,version=version+1,updated_at=clock_timestamp() where id=p_id returning * into r;
 insert into public.jobs_application_events(application_id,stage,actor_id) values(r.id,r.stage,auth.uid());return r;
end;$$;
create function public.jobs_transition_application(p_id uuid,p_stage text,p_assignee uuid,p_expected_version integer) returns public.jobs_applications language sql security invoker set search_path='' as $$select jobs_private.transition_application(p_id,p_stage,p_assignee,p_expected_version)$$;
create function jobs_private.staff_directory() returns table(user_id uuid,full_name text,role text) language sql stable security definer set search_path='' as $$select s.user_id,coalesce(p.full_name,u.email),s.role from jobs_private.staff_members s join auth.users u on u.id=s.user_id left join public.jobs_candidates p on p.id=s.user_id where jobs_private.can_recruit() and s.active and s.role in('recruiter','admin')$$;
create function public.jobs_staff_directory() returns table(user_id uuid,full_name text,role text) language sql security invoker set search_path='' as $$select * from jobs_private.staff_directory()$$;

-- Marketing media is public; CVs remain private and never use public URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('jobs-media','jobs-media',true,8388608,array['image/jpeg','image/png','image/webp','image/avif']),
 ('jobs-cv','jobs-cv',false,10485760,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
create function jobs_private.can_read_cv(p_path text) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and (split_part(p_path,'/',1)=auth.uid()::text or jobs_private.can_recruit())$$;
create function jobs_private.can_upload_cv(p_path text) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from public.jobs_applications a where a.candidate_id=auth.uid() and p_path like a.candidate_id::text||'/'||a.id::text||'/%')$$;
revoke all on function jobs_private.can_read_cv(text),jobs_private.can_upload_cv(text) from public,anon;
grant execute on function jobs_private.can_read_cv(text),jobs_private.can_upload_cv(text) to authenticated;
create policy jobs_media_object_read on storage.objects for select to anon,authenticated using(bucket_id='jobs-media');
create policy jobs_media_object_insert on storage.objects for insert to authenticated with check(bucket_id='jobs-media' and jobs_private.can_edit() and name like (select auth.uid())::text||'/%');
create policy jobs_cv_object_read on storage.objects for select to authenticated using(bucket_id='jobs-cv' and jobs_private.can_read_cv(name));
create policy jobs_cv_object_insert on storage.objects for insert to authenticated with check(bucket_id='jobs-cv' and jobs_private.can_upload_cv(name));
create policy jobs_storage_read_guard on storage.objects as restrictive for select to authenticated using(bucket_id<>'jobs-cv' or jobs_private.can_read_cv(name));
create policy jobs_storage_anon_guard on storage.objects as restrictive for all to anon using(bucket_id not in('jobs-cv')) with check(bucket_id not in('jobs-cv','jobs-media'));
create policy jobs_storage_write_guard on storage.objects as restrictive for insert to authenticated with check((bucket_id<>'jobs-cv' or jobs_private.can_upload_cv(name)) and (bucket_id<>'jobs-media' or (jobs_private.can_edit() and name like (select auth.uid())::text||'/%')));
create policy jobs_storage_update_guard on storage.objects as restrictive for update to authenticated using(bucket_id not in('jobs-cv','jobs-media')) with check(bucket_id not in('jobs-cv','jobs-media'));
create policy jobs_storage_delete_guard on storage.objects as restrictive for delete to authenticated using(bucket_id not in('jobs-cv','jobs-media'));

-- Public wrappers are invokers; privileged implementations are private and
-- explicitly granted only to signed-in users, with authorization inside each.
revoke all on function jobs_private.save_content(jsonb,integer),jobs_private.transition_content(uuid,text,integer),jobs_private.restore_content(uuid,uuid,integer),jobs_private.submit_application(uuid,jsonb,text,uuid),jobs_private.transition_application(uuid,text,uuid,integer),jobs_private.staff_directory() from public,anon;
grant execute on function jobs_private.save_content(jsonb,integer),jobs_private.transition_content(uuid,text,integer),jobs_private.restore_content(uuid,uuid,integer),jobs_private.submit_application(uuid,jsonb,text,uuid),jobs_private.transition_application(uuid,text,uuid,integer),jobs_private.staff_directory() to authenticated;
revoke all on function public.jobs_cms_save(jsonb,integer),public.jobs_cms_transition(uuid,text,integer),public.jobs_cms_restore(uuid,uuid,integer),public.jobs_capabilities(),public.jobs_submit_application(uuid,jsonb,text,uuid),public.jobs_transition_application(uuid,text,uuid,integer),public.jobs_staff_directory() from public,anon;
grant execute on function public.jobs_cms_save(jsonb,integer),public.jobs_cms_transition(uuid,text,integer),public.jobs_cms_restore(uuid,uuid,integer),public.jobs_capabilities(),public.jobs_submit_application(uuid,jsonb,text,uuid),public.jobs_transition_application(uuid,text,uuid,integer),public.jobs_staff_directory() to authenticated;

notify pgrst,'reload schema';
commit;
