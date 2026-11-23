-- Review before applying. Permanent delete succeeds only when the stored
-- file and its private row are both gone.
begin;

create function public.jobs_vacancy_image_forgotten(p_image_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from jobs_private.vacancy_images where id=p_image_id)
  and not exists(
   select 1 from storage.objects
   where bucket_id='jobs-vacancy-images' and name=p_image_id::text
  );
$$;

revoke all on function public.jobs_vacancy_image_forgotten(uuid) from public,anon,authenticated;
grant execute on function public.jobs_vacancy_image_forgotten(uuid) to service_role;

notify pgrst,'reload schema';
commit;
