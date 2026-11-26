-- Manual production migration. Vacancy revisions retain their approved public copy.
begin;

lock table public.jobs_cms_entries, public.jobs_public_content in share row exclusive mode;

create or replace function jobs_private.public_content_is_published(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.jobs_cms_entries e
    where e.id=p_id and e.kind in ('guide','faq') and e.status='published');
$$;
revoke all on function jobs_private.public_content_is_published(uuid) from public,anon,authenticated;
grant execute on function jobs_private.public_content_is_published(uuid) to anon,authenticated;

-- The publication boundary already validates every vacancy snapshot at write time.
drop policy if exists jobs_current_content_publication on public.jobs_public_content;
create policy jobs_current_content_publication on public.jobs_public_content
  as restrictive for select to anon,authenticated
  using (kind not in ('guide','faq') or jobs_private.public_content_is_published(id));

-- Keep application and image consumers of the projection on the same boundary.
create or replace function jobs_private.retire_unpublished_content() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.jobs_public_content p where p.id=new.id and p.kind=new.kind;
  return new;
end;
$$;
revoke all on function jobs_private.retire_unpublished_content() from public,anon,authenticated;
drop trigger if exists jobs_retire_unpublished_content on public.jobs_cms_entries;
create trigger jobs_retire_unpublished_content after update of status on public.jobs_cms_entries
  for each row when (new.kind in ('guide','faq') and new.status <> 'published' and old.status is distinct from new.status)
  execute function jobs_private.retire_unpublished_content();

delete from public.jobs_public_content p
where p.kind in ('guide','faq') and not jobs_private.public_content_is_published(p.id);

create function jobs_private.withdraw_vacancy(p_id uuid,p_expected_version integer) returns public.jobs_cms_entries
language plpgsql security definer set search_path='' as $$
declare r public.jobs_cms_entries;
begin
  if not coalesce(jobs_private.can_publish(),false) then
    raise exception 'jobs.publisher_required' using errcode='42501';
  end if;
  select * into r from public.jobs_cms_entries where id=p_id and kind='vacancy' for update;
  if not found then raise exception 'jobs.not_found' using errcode='P0002'; end if;
  if r.version is distinct from p_expected_version then raise exception 'jobs.version_conflict' using errcode='PT409'; end if;
  if r.status='archived' then raise exception 'jobs.withdrawal_unavailable' using errcode='23514'; end if;

  delete from public.jobs_public_content where id=r.id and kind='vacancy'
    and (expires_on is null or expires_on>=current_date);
  if not found then raise exception 'jobs.withdrawal_unavailable' using errcode='23514'; end if;

  update public.jobs_cms_entries set status='draft',version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
    where id=r.id returning * into r;
  insert into public.jobs_cms_revisions(entry_id,version,status,snapshot,actor_id)
    values(r.id,r.version,r.status,to_jsonb(r)||jsonb_build_object('publication_action','withdrawn'),auth.uid());
  return r;
end;
$$;
revoke all on function jobs_private.withdraw_vacancy(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function jobs_private.withdraw_vacancy(uuid,integer) to authenticated;

create function public.jobs_cms_withdraw(p_id uuid,p_expected_version integer) returns public.jobs_cms_entries
language sql security invoker set search_path='' as $$
  select jobs_private.withdraw_vacancy(p_id,p_expected_version);
$$;
revoke all on function public.jobs_cms_withdraw(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.jobs_cms_withdraw(uuid,integer) to authenticated;

notify pgrst,'reload schema';
commit;
