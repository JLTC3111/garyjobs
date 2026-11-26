-- Manual production migration. The published projection is disposable.
begin;

lock table public.jobs_cms_entries, public.jobs_public_content in share row exclusive mode;

create function jobs_private.public_content_is_published(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.jobs_cms_entries e
    where e.id=p_id and e.kind in ('vacancy','guide','faq') and e.status='published');
$$;
revoke all on function jobs_private.public_content_is_published(uuid) from public,anon,authenticated;
grant execute on function jobs_private.public_content_is_published(uuid) to anon,authenticated;

-- Already-published reference rows remain available to the vacancies that use them.
create policy jobs_current_content_publication on public.jobs_public_content
  as restrictive for select to anon,authenticated
  using (kind in ('employer','category','location') or jobs_private.public_content_is_published(id));

-- Keep application and image consumers of the projection on the same boundary.
create function jobs_private.retire_unpublished_content() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.jobs_public_content p where p.id=new.id and p.kind=new.kind;
  return new;
end;
$$;
revoke all on function jobs_private.retire_unpublished_content() from public,anon,authenticated;
create trigger jobs_retire_unpublished_content after update of status on public.jobs_cms_entries
  for each row when (new.kind in ('vacancy','guide','faq') and new.status <> 'published' and old.status is distinct from new.status)
  execute function jobs_private.retire_unpublished_content();

delete from public.jobs_public_content p
where p.kind in ('vacancy','guide','faq') and not jobs_private.public_content_is_published(p.id);

notify pgrst,'reload schema';
commit;
