-- Review before applying. A 16:9 crop is stored on the gallery item.
-- The original file stays in Storage and can be framed again later.
begin;

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
 normalized_item jsonb;
 cover_count integer:=0;
 crop_box jsonb;
 crop_x numeric;
 crop_y numeric;
 crop_w numeric;
 crop_h numeric;
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
  crop_box:=null;
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
   or item-array['id','width','height','alt_en','alt_vi','cover','crop']<>'{}'::jsonb
   or jsonb_typeof(item->'cover') is distinct from 'boolean' then
   raise exception 'jobs.vacancy_image_invalid' using errcode='23514';
  end if;
  if jsonb_typeof(item->'alt_en') is distinct from 'string' or jsonb_typeof(item->'alt_vi') is distinct from 'string'
   or greatest(char_length(btrim(item->>'alt_en')),char_length(btrim(item->>'alt_vi'))) not between 2 and 500
   or greatest(char_length(item->>'alt_en'),char_length(item->>'alt_vi'))>500 then
   raise exception 'jobs.vacancy_image_alt_required' using errcode='23514';
  end if;
  if item ? 'crop' then
   if jsonb_typeof(item->'crop') is distinct from 'object'
    or (item->'crop')-array['x','y','w','h']<>'{}'::jsonb
    or jsonb_typeof(item->'crop'->'x') is distinct from 'number'
    or jsonb_typeof(item->'crop'->'y') is distinct from 'number'
    or jsonb_typeof(item->'crop'->'w') is distinct from 'number'
    or jsonb_typeof(item->'crop'->'h') is distinct from 'number' then
    raise exception 'jobs.vacancy_image_invalid' using errcode='23514';
   end if;
   crop_x:=(item->'crop'->>'x')::numeric;
   crop_y:=(item->'crop'->>'y')::numeric;
   crop_w:=(item->'crop'->>'w')::numeric;
   crop_h:=(item->'crop'->>'h')::numeric;
   if crop_x < 0 or crop_y < 0 or crop_w <= 0 or crop_h <= 0 or crop_w > 1 or crop_h > 1
    or crop_x + crop_w > 1.001 or crop_y + crop_h > 1.001
    or abs((crop_w * asset.width) / (crop_h * asset.height) - (16.0/9.0)) > 0.02 then
    raise exception 'jobs.vacancy_image_invalid' using errcode='23514';
   end if;
   crop_box:=jsonb_build_object(
    'x', to_jsonb(round(crop_x, 5)),
    'y', to_jsonb(round(crop_y, 5)),
    'w', to_jsonb(round(crop_w, 5)),
    'h', to_jsonb(round(crop_h, 5))
   );
  end if;
  if (item->'cover')='true'::jsonb then cover_count:=cover_count+1; end if;
  if asset.attached_at is null then
   update jobs_private.vacancy_images set attached_at=clock_timestamp() where id=asset.id;
  end if;
  normalized_item:=jsonb_build_object(
   'id',asset.id,'width',asset.width,'height',asset.height,
   'alt_en',item->>'alt_en','alt_vi',item->>'alt_vi','cover',(item->'cover')='true'::jsonb);
  if crop_box is not null then normalized_item:=normalized_item||jsonb_build_object('crop', crop_box); end if;
  normalized:=normalized||jsonb_build_array(normalized_item);
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

notify pgrst,'reload schema';
commit;
