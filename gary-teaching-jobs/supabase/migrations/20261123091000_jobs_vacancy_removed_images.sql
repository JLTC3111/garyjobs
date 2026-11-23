-- Review before applying. Lets editors restore a removed photo or delete its
-- stored file. Revision snapshots stay unchanged; a missing file is skipped.
begin;

create function jobs_private.vacancy_gallery_has(p_data jsonb, p_image_id uuid)
returns boolean language sql immutable as $$
 select coalesce(p_data->'vacancy_image'->>'id','')=p_image_id::text
  or exists(
   select 1 from jsonb_array_elements(
    case when jsonb_typeof(p_data->'vacancy_images')='array' then p_data->'vacancy_images' else '[]'::jsonb end
   ) item
   where item->>'id'=p_image_id::text
  );
$$;

create or replace function jobs_private.check_vacancy_image()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 images jsonb:=new.data->'vacancy_images';
 legacy jsonb:=new.data->'vacancy_image';
 item jsonb;
 asset jobs_private.vacancy_images;
 image_id uuid;
 seen uuid[]:='{}';
 normalized jsonb:='[]'::jsonb;
 cover_count integer:=0;
begin
 if new.kind is distinct from 'vacancy' then return new; end if;
 if images is null or images='null'::jsonb then
  if legacy is null or legacy='null'::jsonb then return new; end if;
  if jsonb_typeof(legacy)<>'object' then raise exception 'jobs.vacancy_image_invalid' using errcode='23514'; end if;
  images:=jsonb_build_array(legacy||jsonb_build_object('cover',true));
 elsif jsonb_typeof(images)<>'array' then
  raise exception 'jobs.vacancy_image_invalid' using errcode='23514';
 elsif jsonb_array_length(images)=0 then
  new.data:=(new.data-'vacancy_images')-'vacancy_image';
  return new;
 end if;
 if new.data is null or jsonb_typeof(new.data)<>'object' then
  raise exception 'jobs.vacancy_image_invalid' using errcode='23514';
 end if;
 if jsonb_array_length(images)>8 then raise exception 'jobs.vacancy_image_gallery_full' using errcode='23514'; end if;
 for index in 0..(jsonb_array_length(images)-1) loop
  item:=images->index;
  if jsonb_typeof(item)<>'object' or coalesce(item->>'id','')!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'jobs.vacancy_image_invalid' using errcode='23514';
  end if;
  image_id:=(item->>'id')::uuid;
  if image_id=any(seen) then raise exception 'jobs.vacancy_image_invalid' using errcode='23514'; end if;
  seen:=seen||image_id;
  select * into asset from jobs_private.vacancy_images
   where id=image_id and vacancy_id=new.id and state='ready' for update;
  if not found then
   if exists(select 1 from jobs_private.vacancy_images where id=image_id) then
    raise exception 'jobs.vacancy_image_invalid' using errcode='23514';
   end if;
   continue;
  end if;
  if item->'width' is distinct from to_jsonb(asset.width) or item->'height' is distinct from to_jsonb(asset.height)
   or item-array['id','width','height','alt_en','alt_vi','cover']<>'{}'::jsonb
   or jsonb_typeof(item->'cover') is distinct from 'boolean' then
   raise exception 'jobs.vacancy_image_invalid' using errcode='23514';
  end if;
  if jsonb_typeof(item->'alt_en') is distinct from 'string' or jsonb_typeof(item->'alt_vi') is distinct from 'string'
   or greatest(char_length(btrim(item->>'alt_en')),char_length(btrim(item->>'alt_vi'))) not between 2 and 500
   or greatest(char_length(item->>'alt_en'),char_length(item->>'alt_vi'))>500 then
   raise exception 'jobs.vacancy_image_alt_required' using errcode='23514';
  end if;
  if (item->'cover')='true'::jsonb then cover_count:=cover_count+1; end if;
  if asset.attached_at is null then
   update jobs_private.vacancy_images set attached_at=clock_timestamp() where id=asset.id;
  end if;
  normalized:=normalized||jsonb_build_array(jsonb_build_object(
   'id',asset.id,'width',asset.width,'height',asset.height,
   'alt_en',item->>'alt_en','alt_vi',item->>'alt_vi','cover',(item->'cover')='true'::jsonb));
 end loop;
 if jsonb_array_length(normalized)=0 then
  new.data:=(new.data-'vacancy_images')-'vacancy_image';
  return new;
 end if;
 if cover_count=0 then normalized:=jsonb_set(normalized,'{0,cover}','true'::jsonb);
 elsif cover_count<>1 then raise exception 'jobs.vacancy_image_invalid' using errcode='23514'; end if;
 new.data:=(new.data-'vacancy_image')||jsonb_build_object('vacancy_images',normalized);
 return new;
end;$$;
revoke all on function jobs_private.check_vacancy_image() from public,anon,authenticated;

create function public.jobs_vacancy_removed_images(p_vacancy_id uuid)
returns table(id uuid, width integer, height integer, alt_en text, alt_vi text, published boolean)
language sql stable security definer set search_path='' as $$
 select i.id, i.width, i.height, coalesce(caption.alt_en,''), coalesce(caption.alt_vi,''),
  coalesce(jobs_private.vacancy_gallery_has(live.data, i.id), false)
 from jobs_private.vacancy_images i
 join public.jobs_cms_entries draft on draft.id=i.vacancy_id and draft.kind='vacancy'
 left join public.jobs_public_content live on live.id=i.vacancy_id and live.kind='vacancy'
 left join lateral (
  select item->>'alt_en' as alt_en, item->>'alt_vi' as alt_vi
  from public.jobs_cms_revisions rev
  cross join lateral jsonb_array_elements(
   case
    when jsonb_typeof(rev.snapshot->'data'->'vacancy_images')='array' then rev.snapshot->'data'->'vacancy_images'
    when jsonb_typeof(rev.snapshot->'data'->'vacancy_image')='object' then jsonb_build_array(rev.snapshot->'data'->'vacancy_image')
    else '[]'::jsonb
   end
  ) item
  where rev.entry_id=i.vacancy_id and item->>'id'=i.id::text
  order by rev.version desc
  limit 1
 ) caption on true
 where jobs_private.can_edit() and i.vacancy_id=p_vacancy_id and i.state='ready'
  and not jobs_private.vacancy_gallery_has(draft.data, i.id)
 order by i.created_at, i.id;
$$;

create function jobs_private.forget_vacancy_image(p_image_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare image jobs_private.vacancy_images; draft jsonb; live jsonb;
begin
 if not jobs_private.can_edit() then raise exception 'jobs.forbidden' using errcode='42501'; end if;
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

create function public.jobs_vacancy_image_forget(p_image_id uuid)
returns uuid language sql security invoker set search_path='' as $$
 select jobs_private.forget_vacancy_image(p_image_id);
$$;

create function public.jobs_vacancy_image_release(p_image_id uuid)
returns void language sql security definer set search_path='' as $$
 update jobs_private.vacancy_images set state='ready' where id=p_image_id and state='discarding';
$$;

revoke all on function jobs_private.vacancy_gallery_has(jsonb,uuid),
 public.jobs_vacancy_removed_images(uuid),
 jobs_private.forget_vacancy_image(uuid),
 public.jobs_vacancy_image_forget(uuid),
 public.jobs_vacancy_image_release(uuid)
 from public,anon,authenticated;
grant execute on function public.jobs_vacancy_removed_images(uuid),
 jobs_private.forget_vacancy_image(uuid), public.jobs_vacancy_image_forget(uuid) to authenticated;
grant execute on function public.jobs_vacancy_image_release(uuid) to service_role;

notify pgrst,'reload schema';
commit;
