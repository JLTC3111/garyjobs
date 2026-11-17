# Teaching Jobs CMS and recruitment backend

This release is implemented locally and has not been deployed. The database migration was authorized and applied to the hosted project on 16 November 2026 (version `20261116043122`). Staff-bootstrap and optional draft-content seed SQL remain unapplied.

## Architecture and ownership

The site retains static HTML/ES modules, the existing gallery islands, and its public visual design. `/portal.html` adds a signed-in candidate and Jobs staff workspace. The app-local `cms-foundation/` release supplies presentation/editor conventions only. Its adapter uses Jobs-owned tables and RPCs; it does not obtain universal Gary administration rights.

The configured Supabase origin is the existing Gary project, `duyiihsmaqfgwezmsnjs`. The browser contains only its intentionally public publishable key. Auth credentials identify the same account across Gary apps; Jobs authorization is separately checked against **`jobs_private.staff_members`**. Neither Home nor Agency staff membership grants Jobs access.

Roles:

| Role | Content drafts/revisions/media | Publish/archive | Recruitment/candidate data |
|---|---|---|---|
| editor | Yes | No | No |
| publisher | Yes | Yes | No |
| recruiter | No | No | Yes |
| admin | Yes | Yes | Yes |
| candidate | No | No | Own applications/documents only |

Only active Jobs memberships with verified Auth email are accepted. Jobs admins grant, change, suspend and restore memberships in Staff management (below); the operator script bootstraps the first owner. Neither path resets or deletes global Auth credentials.

## Candidate and staff sign-in

The public Sign in menu and mobile navigation offer separate Candidate login and Staff login links. The portal also keeps both choices visible, like Home and Agency:

- `/portal.html?access=candidate` opens candidate sign-in and My applications. An empty account explains where submissions will appear and offers Find vacancies and Introduce yourself actions.
- `/portal.html?access=staff` opens staff sign-in without candidate registration. An assigned editor/publisher opens content management; a recruiter opens recruitment; an admin can use both.
- Existing `?view=cms` and `?view=applications` links select staff entry. Explicit `access=candidate` keeps the candidate area and lists only that account's applications, including when its owner also has a staff role.
- Both entries use the same existing Gary Auth credentials. Sign-in accepts existing passwords; the 12-character minimum applies to new candidate passwords and password recovery. Staff entry does not grant membership or reuse another site's roles.
- An account without Jobs membership sees Staff access not assigned. A permission-check failure has its own retry state and never grants access. Session validation has a visible loading state, a 12-second request timeout, and a retry action.
- Role switching preserves the vacancy, other query parameters and fragment. Browser history respects unsaved CMS drafts.
- Auth changes synchronize outside the Supabase callback. Same-user tab-focus/token events preserve the CMS draft; sign-out immediately removes private workspace content and invalidates pending responses.

The English and Vietnamese interface uses the same flow. These UI changes require a frontend deployment. They do not alter database policies or assign any staff accounts. The hosted capability RPC was checked with an unassigned authenticated role and correctly returned no staff permissions; the membership count was zero at verification.

## Staff management

Active Jobs admins see **Administration → Staff management** (`/portal.html?view=staff`). It lists every Jobs membership with name, email, role and access state, explains each role, and shows the latest 50 access changes in English or Vietnamese.

- **Assign:** enter the email of an existing Auth account with a verified email. Unknown, unverified and ambiguous addresses return the same message, so the form cannot be used to discover accounts. It never creates or invites Auth users; existing members are changed in the list instead.
- **Change, suspend, restore:** choose Editor, Publisher, Recruiter, Admin or No access. No access suspends the membership but keeps its role, history and recruitment assignments; suspended staff leave the assignee list. Suspension and any Admin change ask for confirmation. Each save sends the row version, so a stale screen gets a conflict instead of overwriting a newer change.
- **Database guards (checked against current rows, not the browser):** only active verified Jobs admins can call the staff RPCs; nobody can change their own access; **protected** memberships cannot be changed in the app; only a protected admin (a reviewed Jobs owner) can grant, change or remove Admin access; the last active verified admin cannot be suspended or demoted, including by direct SQL updates. Staff changes take a transaction lock so concurrent changes are checked one at a time.
- **Audit:** every membership insert, change and deletion, from the app or SQL, appends to `jobs_private.staff_audit_events` with the actor (none for database operators), a target email snapshot, and the before/after role, access and protection. Audit rows cannot be updated or deleted. Rejected attempts are not recorded.
- **Protected owners** are set only by an operator with `supabase/setup-jobs-staff.sql` (`make_protected`). Nothing is inferred from email addresses, labels or Home/Agency roles.

Role changes apply to database permissions immediately. Another person's open portal keeps its previous navigation until they reload or sign in again; their requests already use the new role.

## Implemented content collections

Vacancies generate their URL automatically from the English job title, falling back to the Vietnamese title. There is no Page Address input. Vietnamese accents and punctuation are normalized, and repeated titles receive an automatic numeric suffix. The adapter checks saved drafts and visible published snapshots, then retries the database's specific URL uniqueness conflict if two editors save the same title concurrently. Other errors retain their original permission/version handling.

The assigned URL is fixed after the first save, including subsequent title edits. Published cards link to `/jobs/<saved-title-slug>`, which can be opened directly or refreshed through the Vercel rewrite and local server. Closing the detail view returns to listings; browser back/forward and interface-language changes preserve the vacancy context. Drafts and unavailable vacancies are never substituted with old reference listings at that URL. An unavailable route displays an unavailable/noindex state after its published-data check.

The public page still serves the static HTML shell; vacancy-specific title, description and canonical metadata are applied in the browser. This change does not add server-rendered vacancy SEO or HTTP 404 responses for unpublished/unknown slugs. The new frontend and rewrite require deployment; no database migration or existing content changes are needed.

- Vacancies: bilingual title, summary, body, requirements, benefits, salary; monthly hours, learner ages, recruiter email, source, closing date, employer/category/location references.
- Employer profiles: bilingual profile content and optional website/logo.
- Job categories and locations: independently managed bilingual taxonomy.
- Guides and FAQs: bilingual publishing and public rendering.

Draft save -> review -> publisher publish is enforced in the database, not just the UI. Publishing requires bilingual titles/summaries/body as applicable; vacancies additionally require a valid future/current closing date, contact email, and published employer/category/location references. An open vacancy prevents archiving or renaming a referenced profile.

Working drafts live in `jobs_cms_entries`; public readers see only `jobs_public_content` snapshots. Saving a draft never changes/disappears the currently published content. Archive removes its public snapshot. Every save/transition/restore records a revision. Writes require the expected version; stale editors receive conflicts rather than overwriting newer work. Restoring a revision creates a fresh draft/version and requires review before republishing.

Marketing image media is public in `jobs-media`, limited to JPEG/PNG/WebP/AVIF at 8 MiB, with both English and Vietnamese alt text. This library must never store CVs or other candidate documents.

## Recruitment and candidate flow

- Public page reads published snapshot vacancies and managed employer/category/location/guide/FAQ content.
- Published vacancies expire automatically from anonymous/public reads after their closing date.
- Apply opens `/portal.html?view=apply&vacancy=<uuid>`. The candidate signs in or confirms a new account email before submitting.
- The submission RPC validates the verified identity, explicit consent, published vacancy, daily intake quota, and idempotency key. It creates/updates the candidate profile and returns a durable `GJ-...` receipt.
- Retrying the same request key returns the same application and does not create another event/application.
- Candidate status, receipt and event history appear in My applications.
- Private PDF/DOCX CVs up to 10 MiB use random paths under `<candidate>/<application>/...`, the private `jobs-cv` bucket, restrictive cross-policy guards, and 60-second signed reads. A failed CV upload does not conceal the saved application receipt; the candidate can retry from its detail panel.
- Recruiters can search role titles, filter by stage/assignee, paginate queues, transfer/unassign to active Jobs recruiters, add private notes, and move through allowed stages.
- Allowed progression: submitted -> screening -> shortlisted -> interview -> offer -> hired; rejection/withdrawal are allowed from open stages. Terminal outcomes cannot be arbitrarily rewritten. Assignment-only updates can retain the same stage. All transitions use expected versions and append events.
- Candidate views cannot read recruitment notes or another candidate's records. Independent Home/Agency memberships cannot invoke CMS/recruitment writes.

## Honest unavailable state

Until the reviewed migration is applied, public queries cannot find the new tables. The public site keeps explicitly labelled reference listings and its email-draft fallback. It never claims that fallback data was submitted. The portal displays an unavailable/provisioning message rather than fake saved content or demo recruitment records.

Once provisioned, an empty published catalogue is shown honestly as empty; it does not silently substitute old vacancies. Optional source seed records are drafts only, require employer and closing-date review, and never auto-publish stale listings.

## Rollout (database migration applied; remaining steps pending)

1. Review `supabase/migrations/20261116043122_teaching_jobs_cms_and_recruitment.sql` against the intended shared project. It creates only `jobs_*`/`jobs_private` objects and app bucket guards. No Home/Agency roles are reused.
2. The reviewed migration was applied on 16 November 2026; do not rerun it. Hosted grants/RLS, Storage MIME/size rules and security advisors were checked afterward. No Jobs content or staff membership was seeded automatically.
3. Staff management needs `supabase/migrations/20261117195500_jobs_staff_role_management.sql`, which is **not applied**. Apply it only with approval. It changes only Jobs objects: new `staff_members` columns with safe defaults (existing memberships and assignments are kept), staff triggers, the audit table, the staff RPCs and two new `jobs_capabilities()` keys.
4. Choose an existing verified Auth account. Edit the placeholder email and role in `supabase/setup-jobs-staff.sql`; grant explicit Jobs membership. Set `make_protected` to true only for the reviewed Jobs owner. Until one admin is protected, admins can manage non-admin roles but nobody can grant Admin in the app. No staff account is auto-promoted.
5. Configure permitted Auth callback/recovery URL `https://jobs.garyhome.vn/portal.html` and any intended localhost test URL. Existing email delivery/confirmation settings belong to the shared Auth project and must be checked before launch.
6. Sign in as a Jobs publisher/admin; create and publish employer/category/location profiles before vacancies. Import draft reference content only if editorial owners want it. Verify current eligibility, terms, closing dates and employer identity before publication.
7. Deploy the built `dist/` only after cross-role tests in the target environment. Verify candidate signup/confirmation, receipt/idempotency, CV upload/download isolation, editorial review, publication snapshots, recruiter assignment/stages, and role revocation.
8. Define retention/deletion, mail notifications, malware scanning, employer portal access, and operational monitoring before broader recruitment rollout. These integrations are not silently claimed by this release.

## Local verification

- `npm run build`: pinned SDK bundle, existing gallery/menu build, asset/syntax checks.
- `npm test`: shared runtime tests, public published-content/fallback/XSS tests, portal role/receipt/signout tests, and isolated in-memory Postgres tests.
- `npm run test:db`: applies the prepared SQL only to an ephemeral PGlite instance, with fake Auth/Storage fixtures. It never contacts hosted Supabase. It includes the staff-management guards, audit trail and operator script.

Database tests cover CMS capabilities, unrelated-app rejection, bilingual validation, review/publish gates, stale-version conflicts, revision restore, live snapshot retention, expiry/reference rules, candidate isolation, idempotent receipts, verified-email gating, stage/assignee enforcement, private notes and restrictive CV policies even when an unrelated permissive storage policy exists.

Final integration regressions also cover browser-history cancellation/confirmed CMS teardown, visible bilingual vacancy salaries, employer profile body/website/logo rendering, unsafe employer URL rejection, and attempts to archive a renamed working employer/category/location while its previous published slug is still referenced. The final local suite passes **22 tests**; the production build and `git diff --check` pass. These are local/mock/in-memory checks, not hosted deployment or real-browser acceptance.

Current limits: recruitment history shows the latest 100 events/documents and 20 notes with explicit labels; content revision/media lists show the latest 100. The first release does not send transactional email, schedule interviews, run malware scans, expose an employer self-service portal, or implement privacy deletion automation. No live backend/SMTP/storage/browser deployment verification is claimed.
