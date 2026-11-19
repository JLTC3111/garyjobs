# Teaching Jobs Talent Pool and Teacher Showcase

## Decision for approval

Keep the existing applicant, application, CV and staff contracts. Add Jobs-only recruitment records for manually entered and recruiter-enriched candidates, plus a separate approval and publication model. The frontend can read existing applicants with Jobs recruitment access. Creation, editing and showcase publication depend on the interfaces below.

## Proposed records

| Record | Data and constraints |
| --- | --- |
| `jobs_talent_candidates` | Generated UUID, optional unique `applicant_id` referencing `jobs_candidates.id`, name, email, phone, location, specialty, nullable experience years, availability, candidate stage, private recruiter note, positive version, timestamps and actor IDs. A unique index on the generated key `lower(btrim(email))` prevents duplicate manual records. Candidate records have no staff or authentication membership effect. |
| `jobs_teacher_showcase_drafts` | One active draft per talent candidate. It has a distinct public UUID, public display name, bilingual specialties and stories, an approved portrait asset reference, a content revision and an optimistic concurrency version. Publishing and removing a profile are separate actions from editing a draft. |
| Placement, consent and approval evidence | Record a verified placement independently of the candidate's stage. Store the teacher's explicit authorization for the exact public revision, including its portrait and both language versions, with evidence, issuance, and withdrawal. Record who approved the revision and when. An intake process must verify the teacher for both linked and manual candidates before it writes evidence. The recruiter-facing candidate form does not write these fields. |
| Showcase projection | A snapshot for the currently published revision. The public endpoint returns its public UUID, display name, localized specialties and stories, a short-lived portrait URL, and three eligibility booleans. Contact details, candidate IDs, notes, proof, application history, and CV or private portrait paths stay in private records. |

Candidate stages are `new`, `screening`, `shortlisted`, `interview`, `offer`, `placed`, `rejected` and `withdrawn`. These stages track the person. Vacancy application stages continue to track individual submissions. The existing-applicant view displays the latest application stage, with `submitted` shown as New and `hired` as Placed. It makes no placement or publication attestation. Use the specialty and availability keys in `dist/jobs-talent-data.js`. Accept experience from 0 to 60 years in half-year increments and preserve null for unknown.

## Existing applicant linkage and duplicates

- Project linked talent records once. Project unmatched existing applicants as virtual profiles with `source: 'applicant'` and their existing ID. The first recruiter edit enriches the existing applicant by linking a single talent record. A virtual profile's expected version is null and a linked profile's expected version is mandatory.
- Normalize email consistently across manual entries and verified applicant addresses. Serialize creates, links and email changes on the normalized key, check both groups, and back the talent constraint with the unique index. Reject duplicate creation with `23505` or `jobs.talent_duplicate`. Return `40001` for a stale version. Use stable sort keys for the paged directory.
- An existing applicant may later share the email of a manual entry. The directory groups that normalized key under the existing talent entry while linkage is reviewed. Only a recruiter-authorized, verified linkage can bring that person's application history into the talent record. Ambiguous or historical duplicates need review before linkage. Preserve all original application IDs, foreign keys and history.
- Keep the verified email on linked applicants read-only in this workflow. Keep private documents and their existing signed-download path in the Applications workspace. Profiles link to existing applications by ID.

## Frontend interfaces

| Interface | Input and result |
| --- | --- |
| `jobs_talent_directory(p_filters jsonb, p_offset integer, p_limit integer)` | Recruiter-only. Filters are `query`, `location`, `stage`, `specialty`, `min_experience` and `availability`. Search name, email, location and specialty, and match Vietnamese text with or without accents. Return `{records,total}` ordered by name and stable ID. Each row has `id`, `source`, `full_name`, `email`, `location`, `stage`, `specialty`, `availability`, `experience_years` and optional `portrait_path`. Exclude notes and application details from the list. |
| `jobs_talent_profile(p_id uuid, p_source text)` | Recruiter-only. Return the directory fields, `applicant_id`, `version`, `phone`, private `internal_note`, and up to 20 recent linked `applications` with `id`, `receipt_code`, `vacancy_title`, and `stage`. Include `showcase` metadata only for viewers who also have Jobs publishing access. |
| `jobs_talent_save(p_candidate jsonb, p_id uuid, p_source text, p_expected_version integer)` | Recruiter-only. Whitelist and validate the editable candidate fields from the form. Both ID and source are null for manual creation. Return the confirmed detail with `source: 'talent'` and the new version. Use the same detail projection and authorization as the profile read. |
| `jobs_teacher_showcase_save(p_candidate_id uuid, p_profile jsonb, p_expected_version integer)` | Requires both Jobs recruitment and Jobs publishing. Accept only `public_name`, `specialty_en`, `specialty_vi`, `story_en`, and `story_vi`. Return the draft fields, status, version, and authoritative `placement_confirmed`, `consent_confirmed`, and `portrait_ready` flags. Editing an unpublished draft creates a new content revision and requires approval and consent for that revision. The frontend requires unpublishing before editing a live profile. |
| `jobs_teacher_showcase_visibility(p_candidate_id uuid, p_publish boolean, p_expected_version integer)` | Requires both Jobs recruitment and Jobs publishing. Check the version and recheck the placement, approved portrait, and unwithdrawn revision-specific consent under the same transaction. A successful publish records the publisher's approval and writes the public snapshot. Unpublishing removes it. Return the confirmed story state and version. |
| `GET jobs-teacher-showcase` | Public Edge Function returning `{profiles, expires_at}` with a UTC ISO expiration at or before the earliest signed portrait expires. A row includes only `public_id`, `status: 'published'`, `placement_confirmed: true`, `consent_confirmed: true`, `approval_confirmed: true`, `portrait_url`, `public_name`, both `specialty_*` fields and both `story_*` fields. Use a noncacheable response, and recheck the current eligibility before signing a portrait. |

## Access and media

Reuse Jobs' `can_recruit()` and `can_publish()` checks in the server operations. Keep private tables outside the public projection and restrict direct access. Apply row-level security to exposed tables, grant only the required privileges, and expose private RPC execution to authenticated clients with the corresponding authorization check. The public reader uses a fixed allowlist for both anonymous and signed-in visitors. Lock the current draft and consent state during publication and withdrawal so these operations cannot race. Withdrawal removes the live snapshot in the same transaction.

The proposed `jobs-talent-portraits` bucket is private with recruiter-only access. The frontend signs only the current result page and the selected profile. The proposed `jobs-showcase-portraits` bucket is also private. The public read endpoint signs only approved copies, with a maximum 120-second lifetime. Keep the two media paths distinct from Jobs CMS public media and the CV bucket. The approved portrait intake must validate and re-encode images and strip metadata before placing them in either bucket. Previously issued URLs can remain valid briefly after withdrawal. A copy already downloaded by a visitor is outside the site's control.

## Approval checks

Verify the new server contracts separately for candidate, recruiter, publisher, administrator and anonymous sessions. Include simultaneous duplicate submissions, stale edits, withdrawal during publication, document URL isolation, and a public response field allowlist. The frontend tests use fixtures and the existing applicant path. Database implementation and migration review follow approval of this contract.

References [Supabase database functions](https://supabase.com/docs/guides/database/functions#function-privileges) and [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
