-- Teaching Jobs staff bootstrap. Run as an operator after the Jobs migrations.
-- Set the reviewed Auth user UUID and Jobs role explicitly before running.
begin;

do $jobs_staff$
declare
  v_user_id uuid := null;
  v_role text := null;
  -- True grants protected ownership. False removes it. Null preserves it.
  v_protected boolean := null;
  v_existing_protected boolean;
begin
  if v_user_id is null or v_role is null then
    raise exception 'Set the verified Auth user ID and Jobs role before running.' using errcode='22023';
  end if;
  if v_role not in ('editor','publisher','recruiter','admin') then
    raise exception 'Invalid Teaching Jobs role.' using errcode='22023';
  end if;
  if not jobs_private.staff_identity_eligible(v_user_id) then
    raise exception 'The Auth account is unavailable for Jobs staff access.' using errcode='23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('jobs.staff_access',0));
  select protected into v_existing_protected
  from jobs_private.staff_members where user_id=v_user_id for update;

  if coalesce(v_protected,v_existing_protected,false) and v_role<>'admin' then
    raise exception 'A protected Jobs owner must have the admin role.' using errcode='23514';
  end if;

  insert into jobs_private.staff_members (user_id,role,active,protected)
  values (v_user_id,v_role,true,coalesce(v_protected,false))
  on conflict (user_id) do update set
    role=excluded.role,
    active=true,
    protected=coalesce(v_protected,jobs_private.staff_members.protected);
end;
$jobs_staff$;

commit;
