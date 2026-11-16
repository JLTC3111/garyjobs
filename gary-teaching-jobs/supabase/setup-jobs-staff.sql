-- Operator-only bootstrap AFTER installing the Jobs migration.
-- Choose an existing, verified Supabase Auth account and an app-scoped role.
-- This grants Jobs access only. Home/Agency membership is never consulted.
-- Replace staff@example.com and admin before executing in the intended project.
begin;
do $jobs_staff$
declare target uuid;chosen_role text:='admin';
begin
 if chosen_role not in('editor','publisher','recruiter','admin') then raise exception 'Choose a Jobs role';end if;
 select id into strict target from auth.users where lower(email)='staff@example.com' and email_confirmed_at is not null;
 insert into jobs_private.staff_members(user_id,role,active) values(target,chosen_role,true)
 on conflict(user_id) do update set role=excluded.role,active=true;
end;
$jobs_staff$;
commit;
-- Revoke independently with: update jobs_private.staff_members set active=false where user_id=...;
-- Do not delete or reset the global Auth identity to revoke one app membership.
