-- Operator-only bootstrap AFTER installing the Jobs migrations.
-- Choose an existing, verified Supabase Auth account and an app-scoped role.
-- This grants Jobs access only. Home/Agency membership is never consulted.
-- Replace staff@example.com and admin before executing in the intended project.
-- make_protected: true marks a reviewed Jobs owner, false removes that mark, null keeps the current setting.
-- Only protected admins can grant or change Admin access in Staff management, and protected memberships
-- cannot be changed there. Protect owners only. Changes made here are audited with no actor (database operator).
begin;
do $jobs_staff$
declare target uuid;chosen_role text:='admin';make_protected boolean:=null;
begin
 if chosen_role not in('editor','publisher','recruiter','admin') then raise exception 'Choose a Jobs role';end if;
 if make_protected and chosen_role<>'admin' then raise exception 'Only a Jobs admin can be a protected owner';end if;
 select id into strict target from auth.users where lower(email)='staff@example.com' and email_confirmed_at is not null;
 insert into jobs_private.staff_members(user_id,role,active,protected) values(target,chosen_role,true,coalesce(make_protected,false))
 on conflict(user_id) do update set role=excluded.role,active=true,protected=coalesce(make_protected,jobs_private.staff_members.protected);
end;
$jobs_staff$;
commit;
-- Revoke independently in Staff management, or with: update jobs_private.staff_members set active=false where user_id=...;
-- The last active, verified Jobs admin cannot be suspended or demoted; assign another admin first.
-- Do not delete or reset the global Auth identity to revoke one app membership.
