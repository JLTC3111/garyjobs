-- Review before applying. Depends on the Jobs staff-eligibility migration.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('jobs-vacancy-images','jobs-vacancy-images',false,4194304,array['image/jpeg','image/png','image/webp']);

create table jobs_private.vacancy_images(
 id uuid primary key default gen_random_uuid(),
 vacancy_id uuid references public.jobs_cms_entries(id) on delete set null,
 uploaded_by uuid not null,
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 size_bytes integer not null check(size_bytes between 1 and 4194304),
 width integer not null check(width between 1 and 4096),
 height integer not null check(height between 1 and 4096 and width*height<=12000000),
 state text not null default 'pending' check(state in ('pending','ready','discarding')),
 created_at timestamptz not null default now(),
 attached_at timestamptz
);
alter table jobs_private.vacancy_images enable row level security;
revoke all on jobs_private.vacancy_images from public,anon,authenticated;
create index vacancy_images_uploader on jobs_private.vacancy_images(uploaded_by,created_at);
create index vacancy_images_cleanup on jobs_private.vacancy_images(created_at)
 where attached_at is null or vacancy_id is null;

create function jobs_private.reserve_vacancy_image(p_vacancy_id uuid,p_mime text,p_bytes integer,p_width integer,p_height integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); image_id uuid;
begin
 if not jobs_private.can_edit() then raise exception 'jobs.forbidden' using errcode='42501';end if;
 if not exists(select 1 from public.jobs_cms_entries where id=p_vacancy_id and kind='vacancy') then
  raise exception 'jobs.vacancy_image_draft_required' using errcode='P0002';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,918));
 if (select count(*) from jobs_private.vacancy_images where uploaded_by=actor and created_at>now()-interval '1 hour')>=30 then
  raise exception 'jobs.vacancy_image_limit' using errcode='P0001';
 end if;
 insert into jobs_private.vacancy_images(vacancy_id,uploaded_by,mime_type,size_bytes,width,height)
 values(p_vacancy_id,actor,p_mime,p_bytes,p_width,p_height) returning id into image_id;
 return image_id;
end;$$;

create function public.jobs_vacancy_image_reserve(p_vacancy_id uuid,p_mime text,p_bytes integer,p_width integer,p_height integer)
returns uuid language sql security invoker set search_path='' as $$
 select jobs_private.reserve_vacancy_image(p_vacancy_id,p_mime,p_bytes,p_width,p_height);
$$;
revoke all on function jobs_private.reserve_vacancy_image(uuid,text,integer,integer,integer),
 public.jobs_vacancy_image_reserve(uuid,text,integer,integer,integer) from public,anon,authenticated;
grant execute on function jobs_private.reserve_vacancy_image(uuid,text,integer,integer,integer),
 public.jobs_vacancy_image_reserve(uuid,text,integer,integer,integer) to authenticated;

-- Only the upload function can finalize a validated object after Storage succeeds.
create function public.jobs_vacancy_image_ready(p_image_id uuid)
returns boolean language sql security definer set search_path='' as $$
 with verified as (
  update jobs_private.vacancy_images i set state='ready'
   where i.id=p_image_id and i.state='pending' and i.vacancy_id is not null
    and jobs_private.staff_identity_eligible(i.uploaded_by)
    and exists(select 1 from jobs_private.staff_members s
      where s.user_id=i.uploaded_by and s.active and s.role in ('editor','publisher','admin'))
    and exists(select 1 from storage.objects o where o.bucket_id='jobs-vacancy-images' and o.name=i.id::text)
   returning 1
 )
 select exists(select 1 from verified);
$$;

create function jobs_private.can_preview_vacancy_image(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select jobs_private.can_edit() and exists(
  select 1 from jobs_private.vacancy_images
  where id=case when p_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then p_path::uuid end
   and state='ready' and vacancy_id is not null
 );
$$;
revoke all on function jobs_private.can_preview_vacancy_image(text) from public,anon,authenticated;
grant execute on function jobs_private.can_preview_vacancy_image(text) to authenticated;

-- This bucket is managed by the server. Restrictive policies also constrain
-- permissive Storage policies that other apps in the shared project may add.
create policy jobs_vacancy_images_anon_guard on storage.objects as restrictive for all to anon
 using(bucket_id<>'jobs-vacancy-images') with check(bucket_id<>'jobs-vacancy-images');
create policy jobs_vacancy_images_read on storage.objects for select to authenticated
 using(bucket_id='jobs-vacancy-images' and jobs_private.can_preview_vacancy_image(name));
create policy jobs_vacancy_images_read_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'jobs-vacancy-images' or jobs_private.can_preview_vacancy_image(name));
create policy jobs_vacancy_images_insert_guard on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'jobs-vacancy-images');
create policy jobs_vacancy_images_update_guard on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'jobs-vacancy-images') with check(bucket_id<>'jobs-vacancy-images');
create policy jobs_vacancy_images_delete_guard on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'jobs-vacancy-images');

create function jobs_private.check_vacancy_image()
returns trigger language plpgsql security definer set search_path='' as $$
declare image jsonb:=new.data->'vacancy_image'; asset jobs_private.vacancy_images;
begin
 if new.kind<>'vacancy' or image is null then return new;end if;
 if jsonb_typeof(image)<>'object' or coalesce(image->>'id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  raise exception 'jobs.vacancy_image_invalid' using errcode='23514';
 end if;
 select * into asset from jobs_private.vacancy_images
 where id=(image->>'id')::uuid and vacancy_id=new.id and state='ready' for update;
 if not found or image->'width' is distinct from to_jsonb(asset.width) or image->'height' is distinct from to_jsonb(asset.height)
  or image-array['id','width','height','alt_en','alt_vi']<>'{}'::jsonb then
  raise exception 'jobs.vacancy_image_invalid' using errcode='23514';
 end if;
 if jsonb_typeof(image->'alt_en') is distinct from 'string' or jsonb_typeof(image->'alt_vi') is distinct from 'string'
  or greatest(char_length(btrim(image->>'alt_en')),char_length(btrim(image->>'alt_vi'))) not between 2 and 500
  or greatest(char_length(image->>'alt_en'),char_length(image->>'alt_vi'))>500 then
  raise exception 'jobs.vacancy_image_alt_required' using errcode='23514';
 end if;
 if asset.attached_at is null then
  update jobs_private.vacancy_images set attached_at=clock_timestamp() where id=asset.id;
 end if;
 return new;
end;$$;
revoke all on function jobs_private.check_vacancy_image() from public,anon,authenticated;
create trigger jobs_check_vacancy_draft_image before insert or update of data on public.jobs_cms_entries
 for each row execute function jobs_private.check_vacancy_image();
create trigger jobs_check_vacancy_public_image before insert or update of data on public.jobs_public_content
 for each row execute function jobs_private.check_vacancy_image();

create function public.jobs_vacancy_image_published_mime(p_image_id uuid)
returns text language sql stable security definer set search_path='' as $$
 select i.mime_type from jobs_private.vacancy_images i
 join public.jobs_public_content p on p.id=i.vacancy_id
 where i.id=p_image_id and i.state='ready' and p.kind='vacancy'
  and (p.expires_on is null or p.expires_on>=current_date)
  and p.data->'vacancy_image'->>'id'=i.id::text;
$$;

-- Reservations are written before upload. Retain attached images for the
-- existing CMS revision/restore workflow, including through unpublication.
create function public.jobs_vacancy_image_cleanup_claim()
returns setof uuid language sql security definer set search_path='' as $$
 update jobs_private.vacancy_images i set state='discarding'
 where i.id in (
  select id from jobs_private.vacancy_images
  where (attached_at is null or vacancy_id is null) and created_at<now()-interval '1 day'
  order by created_at,id limit 50 for update skip locked
 ) returning i.id;
$$;
create function public.jobs_vacancy_image_cleanup_finish(p_image_ids uuid[])
returns void language sql security definer set search_path='' as $$
 delete from jobs_private.vacancy_images i where i.state='discarding' and i.id=any(p_image_ids)
  and not exists(select 1 from storage.objects o where o.bucket_id='jobs-vacancy-images' and o.name=i.id::text);
$$;
revoke all on function public.jobs_vacancy_image_ready(uuid),public.jobs_vacancy_image_published_mime(uuid),
 public.jobs_vacancy_image_cleanup_claim(),public.jobs_vacancy_image_cleanup_finish(uuid[]) from public,anon,authenticated;
grant execute on function public.jobs_vacancy_image_ready(uuid),public.jobs_vacancy_image_published_mime(uuid),
 public.jobs_vacancy_image_cleanup_claim(),public.jobs_vacancy_image_cleanup_finish(uuid[]) to service_role;

notify pgrst,'reload schema';
commit;
