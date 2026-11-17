# Teaching Jobs vacancy editor audit — 17 November 2026

## Result and rollout status

A publisher can complete a vacancy and click **Publish** once. The editor validates the vacancy, saves it when needed, then publishes it directly. No employer, category, or location record is created or published as part of this action. Save draft remains available; editors without publishing permission can still submit for review.

Implementation and end-to-end verification are local. The new migration has **not** been applied to production, and the website has **not** been deployed. Apply the new migration before deploying the updated website. Existing production records were inspected read-only and were not changed, corrected, published, archived, or deleted.

## Root causes

1. The vacancy collection declared employer, category, and location as required CMS references. Each reference widget added search, refresh, publication state, and inline bilingual “Create and publish” controls. Completing a vacancy therefore depended on three unrelated publishing workflows.
2. The publishing adapter fetched all three reference catalogues during save/preflight/transition. Missing profiles, unpublished entries, stale slugs, ambiguous names, and lookup outages could block publication. The database separately required published reference snapshots.
3. Generic content validation required English **and** Vietnamese titles, summaries, and bodies with artificial minimum lengths. The UI also required a separate save and review transition before enabling Publish.
4. The live project contained a published category whose slug/title was `british-council` / “british council”, a published Hanoi location, and one draft vacancy assigned to that category with an empty employer. There were no published vacancies at audit time. This was a misclassified category record, not an employer-to-category lookup bug. No source or seed contained that British Council mapping.
5. Optional whitespace-only source URLs were incorrectly validated as nonempty invalid URLs. Unknown imported category/location values also prevented saving incomplete drafts. Both were unnecessary blockers.

## Editor and validation changes

- Employer is required **Employer name (English)** and optional **Employer name (Vietnamese)**. Neither requires a profile.
- Job category is a predefined bilingual dropdown: public schools, language centers, international schools, private schools, kindergartens, universities/colleges, online teaching, other teaching jobs.
- Location is a predefined city/province dropdown, with optional workplace/branch and street address. The current 34-unit list follows the [official administrative reorganization resolution](https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/6/202qh.signed.pdf).
- These three sections have no search inputs, refresh buttons, separate publication statuses, bilingual summaries, or inline creation panels.
- Publishing requires English title, English content, employer name, category, city/province, valid recruiter email, and a real closing date of today or later. Vietnamese content, summaries, salary, benefits, requirements, learner ages, hours, source URL, workplace, street address, and SEO fields are optional. Supplied optional typed values still receive relevant type/length checks.
- Vietnamese public content falls back to English when a translation is absent. Optional summaries fall back to a body excerpt. Preview and completion messages no longer claim both translations are required or complete.
- Publish works for new, modified, saved, or previously published vacancies. It validates before saving, saves unsaved content once, then publishes the saved version. Existing role checks and optimistic version checks remain enforced.
- Errors are shown beside their exact field, summarized as focusable links, and localized in EN/VI. Database JSON error details are converted into the same issue protocol. A save followed by publication failure retains the saved ID/version, so correcting/retrying does not create a duplicate vacancy.
- Draft saving permits unknown imported category/location choices; publication asks for a valid choice. The known `british-council` category must be corrected explicitly by selecting a teaching category; it is never silently reassigned.
- Late legacy-name lookups cannot reopen a closed editor or replace a different entry or more recently edited draft.

## Compatibility and migration notes

`supabase/migrations/20261117102706_simplify_vacancy_publication.sql` replaces two existing functions only. It adds no tables, columns, management systems, or new permissions, and performs no data migration. Existing records, revisions, published snapshots, URLs, expiry handling, application workflows, role checks, and archive safeguards remain intact.

Vacancy names and address details use the existing JSON `data` object (`employer_name_en`, `employer_name_vi`, `workplace_name`, `street_address`). The existing `category_slug` and `location_slug` keys remain available for filtering. Legacy `employer_slug` remains supported, with an editable name populated from the old profile when available and a raw-name fallback if it cannot be loaded. Profile lookup availability never determines whether a complete vacancy can be published.

Unchanged custom categories/locations in existing published vacancies are preserved for editing and republishing. New vacancies use curated choices. Existing public vacancy rendering retains legacy snapshot labels and supports filters for historic custom values. The malformed British Council category is preserved as a database record but rejected as a vacancy category on publication; unrelated taxonomy records no longer become public category filters.

The migration changes direct draft-to-published behavior for vacancies only. Other content collections retain their existing review/translation rules. Existing employer/category/location management APIs remain available for backwards compatibility but are not part of vacancy creation or publication.

Deploy order: apply the reviewed function migration to the existing Jobs project, then deploy the website assets together. No re-seeding or manual profile creation is needed. Do not rerun the original migration or overwrite the existing draft with seed data. The existing British Council draft still needs its employer name entered and a valid teaching category selected before it can publish.

## Files changed

Within `gary_jobs/gary-teaching-jobs/`:

| Files | Purpose |
| --- | --- |
| `dist/jobs-backend.js` | Vacancy field definitions and opt-in publication rules |
| `dist/jobs-vacancy-options.js` | Curated bilingual category and city/province choices |
| `dist/jobs-publishing-adapter.js` | Self-contained normalization, validation, transition errors, legacy-name preparation |
| `dist/cms-foundation/content.js`, `index.js`, `copy.js`, `index.d.ts`, `seo-findings.js`, `release.json` | One-action publication, optional text rules, field errors, draft compatibility, messages and async safety |
| `dist/jobs-public-content.js`, `dist/app.js` | Direct names/addresses, English fallbacks, public filtering and legacy rendering |
| `supabase/migrations/20261117102706_simplify_vacancy_publication.sql` | Non-destructive database publication rules |
| `tests/jobs-database.test.mjs`, `tests/jobs-publishing-adapter.test.mjs`, `tests/jobs-vacancy-workflow.test.mjs`, `tests/jobs-public.test.mjs` | Database, adapter, actual editor workflow, and public regression tests |
| `docs/vacancy-editor-audit-2026-11-17.md`, `README.md` | Audit evidence and rollout notes |

The five matching CMS implementation/type/copy files in `gary_home_website/shared/cms-foundation/` carry the same generic opt-in extensions so future vendoring retains this behavior. Defaults for other applications are unchanged; no other application was deployed or database modified.

## Verification

End-to-end tests mount the real editor in jsdom, use the real publishing adapter, and execute the actual migrations and role-protected RPC functions in an isolated PostgreSQL-compatible PGlite database. A new vacancy is populated through UI inputs and published with one click, then read anonymously from `jobs_public_content`. EN and VI interface runs succeed with no related CMS records, no taxonomy reads, blank Vietnamese text, and blank summaries. Public vacancy conversion is checked for employer/category/location rendering.

Additional checks cover field-specific error recovery, invalid category/city/email/date, permission and version conflicts, non-destructive upgrade of an already published vacancy, unchanged legacy values, stable URLs, saved-draft identity after server errors, retry without duplicates, bilingual filters, escaping, optional whitespace, and stale async preparation.

Browser layout verification was attempted but the environment denied binding the local preview server (`listen EPERM`). No browser screenshot or production publishing test is claimed. No test vacancy was inserted into the live catalogue.

Final verification results:

| Command / check | Result |
| --- | --- |
| `npm test` in Teaching Jobs | **162 passed, 0 failed, 0 skipped**, including 8 editor-to-database workflow tests |
| `npm run build` in Teaching Jobs | Passed; JavaScript syntax, 76 asset references and all 58 photos verified |
| `node --test tests/cms-foundation.test.mjs` in Gary Home | **3 passed**, confirming default shared validation behavior remains unchanged |
| `git diff --check` in both affected repositories | Passed |
| Production migration / website deployment | Not performed |
| Browser visual QA | Unavailable: preview server bind denied by environment |
