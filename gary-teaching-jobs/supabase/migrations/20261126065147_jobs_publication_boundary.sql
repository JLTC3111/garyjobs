begin;

lock table public.jobs_public_content in share row exclusive mode;

-- Validate the disposable public projection against the last publication action.
-- A newer draft, review or restore does not replace that published revision.
delete from public.jobs_public_content as p
where not exists (
  select 1
  from public.jobs_cms_entries as e
  cross join lateral (
    select r.status, r.snapshot
    from public.jobs_cms_revisions as r
    where r.entry_id = e.id and r.status in ('published', 'archived')
    order by r.version desc limit 1
  ) as publication
  where e.id = p.id and e.status <> 'archived' and publication.status = 'published'
    and publication.snapshot @> (to_jsonb(p) - array['data', 'expires_on', 'published_at', 'updated_at'])
    and (publication.snapshot->>'published_at')::timestamptz = p.published_at
    and (publication.snapshot->>'updated_at')::timestamptz = p.updated_at
    and (
      publication.snapshot->'data' = p.data
      or (
        -- The gallery migration normalized live images without changing revision history.
        p.kind = 'vacancy' and jsonb_typeof(publication.snapshot->'data'->'vacancy_image') = 'object'
        and p.data = ((publication.snapshot->'data') - 'vacancy_image') || jsonb_build_object(
          'vacancy_images', jsonb_build_array((publication.snapshot->'data'->'vacancy_image') || '{"cover":true}'::jsonb)
        )
      )
    )
    and (p.kind <> 'vacancy' or p.expires_on <= (publication.snapshot->'data'->>'closes_on')::date)
);

create function jobs_private.require_published_content() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- Allow an existing snapshot to expire earlier without replacing its content.
  if tg_op = 'UPDATE' then
    if new.expires_on <= old.expires_on
      and (to_jsonb(new) - 'expires_on') = (to_jsonb(old) - 'expires_on') then
      return new;
    end if;
  end if;

  if not exists (
    select 1 from public.jobs_cms_entries as e
    where e.id = new.id and e.status = 'published'
      and to_jsonb(e) @> (to_jsonb(new) - array['data', 'expires_on'])
      and e.data = new.data
      and (new.kind <> 'vacancy' or new.expires_on = (e.data->>'closes_on')::date)
  ) then
    raise exception 'jobs.published_snapshot_required' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function jobs_private.require_published_content() from public;

-- The existing publish transaction locks the CMS entry before writing its copy.
-- The archive action removes the copy and hard deletion cascades via the existing FK.
create trigger jobs_require_published_content
before insert or update on public.jobs_public_content
for each row execute function jobs_private.require_published_content();

commit;
