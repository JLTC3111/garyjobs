-- Add self-profile data to the existing authenticated account request.
begin;

create function jobs_private.account_profile() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); saved_name text; avatar_path text;
begin
  if actor is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then return null; end if;
  select nullif(btrim(c.full_name),'') into saved_name from public.jobs_candidates c where c.id=actor;
  -- The optional photo release has its own schema and existing self-read policies.
  if to_regclass('public.jobs_avatar_profiles') is not null then
    execute 'select p.path from public.jobs_avatar_profiles p where p.user_id=$1' into avatar_path using actor;
  end if;
  return jsonb_build_object('full_name',saved_name,'avatar_path',avatar_path);
end;
$$;
revoke all on function jobs_private.account_profile() from public,anon,authenticated;
grant execute on function jobs_private.account_profile() to anon,authenticated;

create or replace function public.jobs_capabilities() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('role',jobs_private.role(),'read',jobs_private.can_edit(),'edit',jobs_private.can_edit(),
    'publish',jobs_private.can_publish(),'media',jobs_private.can_manage_admins(),'recruit',jobs_private.can_recruit(),
    'view_staff',jobs_private.role() is not null,
    'manage_staff',jobs_private.can_manage_staff(),'manage_admins',jobs_private.can_manage_admins(),
    'account',jobs_private.account_profile());
$$;

notify pgrst,'reload schema';
commit;
