-- Review before applying. Extends the existing vacancy image bucket and rows.
begin;

-- Canonical photos live in data.vacancy_images. A legacy vacancy_image object is
-- rewritten as a one-item gallery so current rows and old revision restores save.
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
  if not found or item->'width' is distinct from to_jsonb(asset.width) or item->'height' is distinct from to_jsonb(asset.height)
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
 if cover_count<>1 then raise exception 'jobs.vacancy_image_invalid' using errcode='23514'; end if;
 new.data:=(new.data-'vacancy_image')||jsonb_build_object('vacancy_images',normalized);
 return new;
end;$$;
revoke all on function jobs_private.check_vacancy_image() from public,anon,authenticated;

create or replace function public.jobs_vacancy_image_published_mime(p_image_id uuid)
returns text language sql stable security definer set search_path='' as $$
 select i.mime_type from jobs_private.vacancy_images i
 join public.jobs_public_content p on p.id=i.vacancy_id
 where i.id=p_image_id and i.state='ready' and p.kind='vacancy'
  and (p.expires_on is null or p.expires_on>=current_date)
  and (
   exists(
    select 1 from jsonb_array_elements(
     case when jsonb_typeof(p.data->'vacancy_images')='array' then p.data->'vacancy_images' else '[]'::jsonb end
    ) as gallery(image)
    where gallery.image->>'id'=i.id::text
   )
   or p.data->'vacancy_image'->>'id'=i.id::text
  );
$$;
revoke all on function public.jobs_vacancy_image_published_mime(uuid) from public,anon,authenticated;
grant execute on function public.jobs_vacancy_image_published_mime(uuid) to service_role;

update public.jobs_cms_entries
 set data=(data-'vacancy_image')||jsonb_build_object('vacancy_images',jsonb_build_array((data->'vacancy_image')||'{"cover":true}'::jsonb))
 where kind='vacancy' and jsonb_typeof(data->'vacancy_image')='object'
  and jsonb_typeof(data->'vacancy_images') is distinct from 'array';
update public.jobs_public_content
 set data=(data-'vacancy_image')||jsonb_build_object('vacancy_images',jsonb_build_array((data->'vacancy_image')||'{"cover":true}'::jsonb))
 where kind='vacancy' and jsonb_typeof(data->'vacancy_image')='object'
  and jsonb_typeof(data->'vacancy_images') is distinct from 'array';

notify pgrst,'reload schema';
commit;
