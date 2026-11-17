begin;

-- Vacancy content is self-contained. Existing JSON data and published snapshots are
-- left intact; no profile or taxonomy record is created, changed or published.
create or replace function jobs_private.check_publication(r public.jobs_cms_entries) returns void language plpgsql set search_path='' as $$
declare
 issues jsonb := '[]'::jsonb;
 closing_date date;
 field_name text;
 field_label text;
 required_value text;
begin
 if r.kind='vacancy' then
  if nullif(trim(r.title_en),'') is null then
   issues := issues || jsonb_build_array(jsonb_build_object('code','cms-title-missing','field','title_en','params',jsonb_build_object('language','en'),'severity','critical'));
  end if;
  if nullif(trim(r.body_en),'') is null then
   issues := issues || jsonb_build_array(jsonb_build_object('code','cms-body-missing','field','body_en','params',jsonb_build_object('language','en'),'severity','critical'));
  end if;
  -- Legacy vacancy payloads contain an employer slug instead of an embedded name.
  -- Keep them editable without requiring any linked record or publication status.
  if nullif(trim(coalesce(r.data->>'employer_name_en',r.data->>'employer_slug','')),'') is null then
   issues := issues || jsonb_build_array(jsonb_build_object('code','cms-field-required','field','data.employer_name_en','params',jsonb_build_object('field','Employer name (English)'),'severity','critical'));
  end if;
  for field_name,field_label in select * from (values ('category_slug','Job category'),('location_slug','City / province'),('closes_on','Closing date'),('contact_email','Recruiter email')) as fields(name,label) loop
   required_value := trim(coalesce(r.data->>field_name,''));
   if required_value='' then
    issues := issues || jsonb_build_array(jsonb_build_object('code','cms-field-required','field','data.'||field_name,'params',jsonb_build_object('field',field_label),'severity','critical'));
   end if;
  end loop;
  -- The curated category list is vacancy data, not a published taxonomy lookup.
  -- Unchanged historic published categories remain compatible, except the known
  -- employer-as-category mistake which editors must correct explicitly.
  if nullif(trim(r.data->>'category_slug'),'') is not null
   and not (r.data->>'category_slug'=any(array['public','centers','international-schools','private-schools','kindergarten','universities','online','other']))
   and (r.data->>'category_slug'='british-council' or not exists(
    select 1 from public.jobs_public_content p where p.id=r.id and p.kind='vacancy' and p.data->>'category_slug'=r.data->>'category_slug'
   )) then
   issues := issues || jsonb_build_array(jsonb_build_object('code','cms-option-invalid','field','data.category_slug','params','{}'::jsonb,'severity','critical'));
  end if;
  -- Match the city's curated selector while keeping an existing vacancy's
  -- published historic location usable without creating a location record.
  if nullif(trim(r.data->>'location_slug'),'') is not null
   and not (r.data->>'location_slug'=any(array['hanoi','ho-chi-minh','hai-phong','hue','da-nang','can-tho','an-giang','bac-ninh','ca-mau','cao-bang','dak-lak','dien-bien','dong-nai','dong-thap','gia-lai','ha-tinh','hung-yen','khanh-hoa','lai-chau','lam-dong','lang-son','lao-cai','nghe-an','ninh-binh','phu-tho','quang-ngai','quang-ninh','quang-tri','son-la','tay-ninh','thai-nguyen','thanh-hoa','tuyen-quang','vinh-long']))
   and not exists(
    select 1 from public.jobs_public_content p where p.id=r.id and p.kind='vacancy' and p.data->>'location_slug'=r.data->>'location_slug'
   ) then
   issues := issues || jsonb_build_array(jsonb_build_object('code','cms-option-invalid','field','data.location_slug','params','{}'::jsonb,'severity','critical'));
  end if;
  if nullif(trim(r.data->>'contact_email'),'') is not null and trim(r.data->>'contact_email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
   issues := issues || jsonb_build_array(jsonb_build_object('code','cms-email-invalid','field','data.contact_email','params','{}'::jsonb,'severity','critical'));
  end if;
  if nullif(trim(r.data->>'closes_on'),'') is not null then
   if r.data->>'closes_on' ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
     closing_date := (r.data->>'closes_on')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
     closing_date := null;
    end;
   end if;
   if closing_date is null then
    issues := issues || jsonb_build_array(jsonb_build_object('code','cms-date-invalid','field','data.closes_on','params','{}'::jsonb,'severity','critical'));
   elsif closing_date<current_date then
    issues := issues || jsonb_build_array(jsonb_build_object('code','cms-date-past','field','data.closes_on','params',jsonb_build_object('minimum','today'),'severity','critical'));
   end if;
  end if;
  if jsonb_array_length(issues)>0 then
   raise exception 'jobs.publication_invalid' using errcode='23514',detail=jsonb_build_object('issues',issues)::text;
  end if;
  return;
 end if;
 -- Other CMS collections retain their existing publishing contract.
 if least(char_length(trim(r.title_en)),char_length(trim(r.title_vi)))<3 or least(char_length(trim(r.summary_en)),char_length(trim(r.summary_vi)))<10 then
  raise exception 'jobs.translation_required' using errcode='23514';
 end if;
 if r.kind in('guide','faq') and least(char_length(trim(r.body_en)),char_length(trim(r.body_vi)))<20 then
  raise exception 'jobs.body_required' using errcode='23514';
 end if;
end;$$;

create or replace function jobs_private.transition_content(p_id uuid,p_status text,p_expected_version integer) returns public.jobs_cms_entries language plpgsql security definer set search_path='' as $$
declare r public.jobs_cms_entries;exp date;previous_slug text;
begin
 if not jobs_private.can_edit() then raise exception 'jobs.forbidden' using errcode='42501';end if;
 if p_status not in('draft','review','published','archived') then raise exception 'jobs.invalid_status' using errcode='22023';end if;
 if p_status in('published','archived') and not jobs_private.can_publish() then raise exception 'jobs.publisher_required' using errcode='42501';end if;
 select * into r from public.jobs_cms_entries where id=p_id for update;
 if not found then raise exception 'jobs.not_found' using errcode='P0002';end if;
 if r.version is distinct from p_expected_version then raise exception 'jobs.version_conflict' using errcode='40001';end if;
 if p_status='published' then
  if r.kind<>'vacancy' and r.status<>'review' then raise exception 'jobs.review_required' using errcode='23514';end if;
  perform jobs_private.check_publication(r);
  if r.kind in('employer','category','location') then
   select slug into previous_slug from public.jobs_public_content where id=r.id;
   if previous_slug is not null and previous_slug<>r.slug and exists(select 1 from public.jobs_public_content p where p.kind='vacancy' and (p.expires_on is null or p.expires_on>=current_date) and p.data->>(case r.kind when 'employer' then 'employer_slug' when 'category' then 'category_slug' else 'location_slug' end)=previous_slug) then raise exception 'jobs.reference_in_use' using errcode='23514';end if;
  end if;
  r.published_at:=clock_timestamp();
  if r.kind='vacancy' then exp:=(r.data->>'closes_on')::date;end if;
 end if;
 r.status:=p_status;r.version:=r.version+1;r.updated_at:=clock_timestamp();r.updated_by:=auth.uid();
 update public.jobs_cms_entries set status=r.status,version=r.version,updated_at=r.updated_at,updated_by=r.updated_by,published_at=r.published_at where id=r.id;
 if p_status='published' then
  insert into public.jobs_public_content(id,kind,slug,title_en,title_vi,summary_en,summary_vi,body_en,body_vi,seo_title_en,seo_title_vi,seo_description_en,seo_description_vi,data,version,published_at,updated_at,expires_on)
  values(r.id,r.kind,r.slug,r.title_en,r.title_vi,r.summary_en,r.summary_vi,r.body_en,r.body_vi,r.seo_title_en,r.seo_title_vi,r.seo_description_en,r.seo_description_vi,r.data,r.version,r.published_at,r.updated_at,exp)
  on conflict(id) do update set kind=excluded.kind,slug=excluded.slug,title_en=excluded.title_en,title_vi=excluded.title_vi,summary_en=excluded.summary_en,summary_vi=excluded.summary_vi,body_en=excluded.body_en,body_vi=excluded.body_vi,seo_title_en=excluded.seo_title_en,seo_title_vi=excluded.seo_title_vi,seo_description_en=excluded.seo_description_en,seo_description_vi=excluded.seo_description_vi,data=excluded.data,version=excluded.version,published_at=excluded.published_at,updated_at=excluded.updated_at,expires_on=excluded.expires_on;
 elsif p_status='archived' then
  if r.kind in('employer','category','location') then
   -- A working draft may have a different slug from the published snapshot.
   -- Guard the identity being removed, not the unpublished replacement name.
   select slug into previous_slug from public.jobs_public_content where id=r.id;
   previous_slug:=coalesce(previous_slug,r.slug);
   if exists(select 1 from public.jobs_public_content p where p.kind='vacancy' and (p.expires_on is null or p.expires_on>=current_date) and p.data->>(case r.kind when 'employer' then 'employer_slug' when 'category' then 'category_slug' else 'location_slug' end)=previous_slug) then raise exception 'jobs.reference_in_use' using errcode='23514';end if;
  end if;
  delete from public.jobs_public_content where id=r.id;
 end if;
 insert into public.jobs_cms_revisions(entry_id,version,status,snapshot,actor_id) values(r.id,r.version,r.status,to_jsonb(r),auth.uid());return r;
end;$$;

-- Replacing functions preserves their existing ACLs and private authorization.
notify pgrst,'reload schema';
commit;
