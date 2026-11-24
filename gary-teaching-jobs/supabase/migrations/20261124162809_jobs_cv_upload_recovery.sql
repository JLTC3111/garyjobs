begin;

-- Reservations track interrupted uploads. Existing documents and clients keep
-- using their original keys and the existing private bucket policies.
create table jobs_private.cv_uploads (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.jobs_applications(id) on delete cascade,
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  object_path text not null unique,
  file_name text not null check(char_length(file_name) between 1 and 200),
  mime_type text not null check(mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes integer not null check(size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  unique(application_id,fingerprint)
);
alter table jobs_private.cv_uploads enable row level security;
revoke all on jobs_private.cv_uploads from public,anon,authenticated;

create function jobs_private.reserve_cv_upload(p_application_id uuid,p_fingerprint text,p_name text,p_mime text,p_size integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); reserved jobs_private.cv_uploads; extension text;
begin
  if actor is null or not exists(select 1 from public.jobs_applications a where a.id=p_application_id and a.candidate_id=actor) then
    raise exception 'jobs.forbidden' using errcode='42501';
  end if;
  extension:=case p_mime when 'application/pdf' then 'pdf'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx' end;
  if extension is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    or coalesce(char_length(p_name),0) not between 1 and 200 or coalesce(p_size,0) not between 1 and 10485760 then
    raise exception 'jobs.cv_invalid' using errcode='23514';
  end if;

  insert into jobs_private.cv_uploads(application_id,fingerprint,object_path,file_name,mime_type,size_bytes)
  values(p_application_id,p_fingerprint,actor::text||'/'||p_application_id::text||'/'||gen_random_uuid()::text||'.'||extension,p_name,p_mime,p_size)
  on conflict(application_id,fingerprint) do nothing returning * into reserved;
  if not found then
    select * into strict reserved from jobs_private.cv_uploads where application_id=p_application_id and fingerprint=p_fingerprint;
  end if;
  if (reserved.mime_type,reserved.size_bytes) is distinct from (p_mime,p_size) then
    raise exception 'jobs.cv_invalid' using errcode='23514';
  end if;
  return jsonb_build_object('id',reserved.id,'object_path',reserved.object_path,
    'stored',exists(select 1 from storage.objects o where o.bucket_id='jobs-cv' and o.name=reserved.object_path),
    'document',(select to_jsonb(d) from public.jobs_application_documents d where d.object_path=reserved.object_path));
end;
$$;

create function jobs_private.complete_cv_upload(p_upload_id uuid)
returns public.jobs_application_documents language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); reserved jobs_private.cv_uploads; document public.jobs_application_documents; attributes jsonb;
begin
  select u.* into reserved from jobs_private.cv_uploads u join public.jobs_applications a on a.id=u.application_id
  where u.id=p_upload_id and a.candidate_id=actor for update of u;
  if not found then raise exception 'jobs.forbidden' using errcode='42501'; end if;
  select * into document from public.jobs_application_documents d where d.object_path=reserved.object_path;
  if found then return document; end if;

  select o.metadata into attributes from storage.objects o where o.bucket_id='jobs-cv' and o.name=reserved.object_path;
  if not found then raise exception 'jobs.cv_upload_missing' using errcode='23514'; end if;
  if attributes->>'mimetype' is distinct from reserved.mime_type or attributes->>'size' is distinct from reserved.size_bytes::text then
    raise exception 'jobs.cv_invalid' using errcode='23514';
  end if;
  insert into public.jobs_application_documents(application_id,candidate_id,object_path,file_name,mime_type,size_bytes)
  values(reserved.application_id,actor,reserved.object_path,reserved.file_name,reserved.mime_type,reserved.size_bytes)
  on conflict(object_path) do nothing returning * into document;
  if not found then
    select * into strict document from public.jobs_application_documents d where d.object_path=reserved.object_path;
  end if;
  return document;
end;
$$;

create function public.jobs_reserve_cv_upload(p_application_id uuid,p_fingerprint text,p_name text,p_mime text,p_size integer)
returns jsonb language sql security invoker set search_path='' as $$
  select jobs_private.reserve_cv_upload(p_application_id,p_fingerprint,p_name,p_mime,p_size);
$$;
create function public.jobs_complete_cv_upload(p_upload_id uuid)
returns public.jobs_application_documents language sql security invoker set search_path='' as $$
  select jobs_private.complete_cv_upload(p_upload_id);
$$;
revoke all on function jobs_private.reserve_cv_upload(uuid,text,text,text,integer),jobs_private.complete_cv_upload(uuid),
  public.jobs_reserve_cv_upload(uuid,text,text,text,integer),public.jobs_complete_cv_upload(uuid) from public,anon,authenticated;
grant execute on function jobs_private.reserve_cv_upload(uuid,text,text,text,integer),jobs_private.complete_cv_upload(uuid),
  public.jobs_reserve_cv_upload(uuid,text,text,text,integer),public.jobs_complete_cv_upload(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
