-- TEACHING JOBS: STAFF ACCESS BOOTSTRAP
-- Run after installing Jobs migrations.
-- Only modifies Jobs staff membership.
-- Does not change passwords, Auth identities or other apps.

begin;

do $jobs_staff$
declare
  -- EDIT THESE THREE VALUES
  v_email text := 'giangcr9@gmail.com';
  v_role text := 'admin';
  v_protected boolean := true;

  -- ROLE: editor | publisher | recruiter | admin
  -- PROTECTED:
  -- true  = mark as protected owner
  -- false = remove protected status
  -- null  = preserve existing status

  v_target uuid;
  v_existing_protected boolean;

begin
  -- Validate role
  if v_role not in
    ('editor', 'publisher', 'recruiter', 'admin')
  then
    raise exception 'Invalid Teaching Jobs role.';
  end if;

  -- Find existing, verified Auth account
  select id into v_target
  from auth.users
  where lower(email) = lower(trim(v_email))
    and email_confirmed_at is not null;

  if v_target is null then
    raise exception
      'Nothing changed: % is not a verified Supabase Auth account.',
      v_email;
  end if;

  -- Check existing Jobs protection
  select protected
  into v_existing_protected
  from jobs_private.staff_members
  where user_id = v_target
  for update;

  -- Only admins can retain protected ownership
  if coalesce(
       v_protected,
       v_existing_protected,
       false
     ) and v_role <> 'admin'
  then
    raise exception
      'A protected Jobs owner must have the admin role.';
  end if;

  -- Create or update Jobs staff membership
  insert into jobs_private.staff_members
    (user_id, role, active, protected)
  values
    (
      v_target,
      v_role,
      true,
      coalesce(v_protected, false)
    )
  on conflict (user_id)
  do update set
    role = excluded.role,
    active = true,
    protected = coalesce(
      v_protected,
      jobs_private.staff_members.protected
    );

end;
$jobs_staff$;

commit;

-- REVIEW TEACHING JOBS STAFF
select
  u.email,
  j.role,
  j.active,
  j.protected
from jobs_private.staff_members j
join auth.users u on u.id = j.user_id
order by u.email;