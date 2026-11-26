# Teaching Jobs publication incident, 26 November 2026

## Evidence

The production deployment points to Git commit `89bb5b7f1212554c15aac2eab643e9588719bb94`. Its SSR discovery and direct routes use `jobs_public_content`. The browser uses the same public projection with an anonymous client whether the visitor has a session or browses signed out. Search filters those records. The deployed commit contains no bundled copy of the Gia Lai slug or title. The reference loader is for CMS selections. The public catalogue has empty and unavailable states, and SSR and catalogue requests use `no-store`.

The CMS record `53cfaafc-091a-4190-a055-3b3b966211e6` published version 6, saved version 7 as Draft, and archived it in version 8. The deployed publication trigger validates writes to the public snapshot. Its RLS read policy checks expiry. The save workflow previously kept the last published snapshot after a Draft save. That retained published snapshot was the source of the card while the entry was Draft. The archive removed the snapshot. Read-only production queries under the anonymous and authenticated database roles each returned nine visible vacancies and zero records for the Gia Lai slug.

## Manual release and verification

1. Review the two pending migrations through the approved production database operator process. Use the revised vacancy migration. Saving or reviewing a new vacancy revision preserves the last approved snapshot, and restoring a working revision does not publish it. Explicit **Withdraw vacancy** removes the active snapshot and keeps the current editable draft, with a distinct withdrawal in the revision history. Archive removes the snapshot and marks the entry Archived. The existing deletion foreign key removes the snapshot if the entry is deleted through an authorized workflow. The migration keeps the earlier Guide and FAQ boundary and the approved data of reference collections. The account migration adds the saved candidate name and current self-owned photo pointer to the existing capabilities response.

   ```sh
   export PGSERVICE=gary-home-media   # Use the approved service for the shared Supabase project.
   psql -X -w -d "service=$PGSERVICE sslmode=verify-full" -v ON_ERROR_STOP=1 \
     -f supabase/migrations/20261126114000_jobs_vacancy_current_publication.sql \
     -f supabase/migrations/20261126114100_jobs_account_profile_in_capabilities.sql
   ```

2. Deploy the reviewed `gary-teaching-jobs` revision to the existing Vercel project serving `jobs.garyhome.vn`. The staff list shows the live revision number next to an in-progress draft. Deploy the checked-in Jobs CMS files. The Jobs copy already has its own publishing controls, image editor and notification handling. If profile photo storage has a separate pending rollout, its existing self-read policy and pointer are used once that rollout is available.
3. Fetch the homepage and sitemap as a visitor. Check that the Gia Lai slug and title are absent and confirm a known current published vacancy is present. Check `/jobs/job-offer-in-gia-lai` and `/api/vacancy?slug=job-offer-in-gia-lai` for a 404 without draft content. Check the current published vacancy's direct URL and API output for a 200. Repeat the search and direct-page check signed in and signed out. A restored tab should clear stale cards before displaying refreshed results. The production database checks confirmed the current snapshot boundary. Direct production HTTP requests remained unavailable from the investigation environment.
4. With an approved test vacancy, save and submit a new revision. Verify the old approved title and version continue on the homepage, search, direct route and public projection. Verify the draft revision's strings are absent. As a Publisher or Admin, confirm withdrawal. Verify the slot is gone and the route returns 404. Check that the draft and withdrawal receipt remain. Check that a stale version gets HTTP 409 and an Editor cannot withdraw. Republish an approved revision and verify it returns on the same URL, and verify Archive separately. The revised migration does not reconstruct any missing snapshots from an earlier deployment. Review those records in the CMS before explicitly republishing.
5. Verify the Account with a saved full name, a blank name and an uploaded photograph. The Account label, preferences sliders and language and theme choices use the existing controls. The account capability request supplies the saved profile and reports the current private photo pointer. A same-session reread of that pointer reuses the already downloaded image.
