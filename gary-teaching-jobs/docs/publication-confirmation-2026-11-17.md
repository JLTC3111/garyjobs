# Portal themes and publication confirmation

## Root causes

The publication handler reused the draft-save completion path: it rebuilt the editor, focused its first input and left it open. This caused the title-field focus/scroll and could trigger the browser's saved-info popup. `editorNotice` always used `role=alert`, including for success. There was no successful-publication close/list-refresh path, and response checking did not require the requested status. A subsequent history-read error could incorrectly make a committed operation appear to have failed.

## Changes

- `dist/cms-foundation/index.js`: successful publication requires an awaited backend record with ID, version and `published` status. It then closes/cleans the editor, refreshes the existing filtered list and opens a separate confirmation. Focus restoration uses `preventScroll`; success does not rebuild/refocus the title field. Draft save and Archive retain separate transitions and status messages. History/list read failures cannot reverse confirmed publication feedback.
- `dist/cms-foundation/success-notification.js`, `success-notification.css`: reusable, semantic-token-based CMS confirmation with localized heading/message/title, validated public link, manual close, Escape, focus management and five-second dismissal. Interaction pauses dismissal for accessibility. Destruction clears the dialog and timer.
- `dist/cms-foundation/index.d.ts`, `release.json`: exported reusable notification contract and updated local vendored metadata. Home's canonical CMS and Visa's CMS JavaScript are unchanged.
- `tests/jobs-publish-success.test.mjs`: 11 new behavioral checks. Existing sidebar and database workflow tests now dismiss confirmation/reopen the published record before subsequent edits.

The original input nodes and values survive validation/server failure. If draft saving commits but publishing fails, the saved ID/version are retained so retrying uses the same record. Busy state disables duplicate submissions. No browser autofill UI is globally suppressed.

## Verification

- Full Jobs suite: **196/196 passed**, including local database-backed vacancy create/publish/republish/failure workflows.
- Focused publishing/sidebar/database workflow: **24/24 passed**.
- Theme and notification checks cover EN/VI, Light/Dark/System, persistence/system changes, retained editor/uploads/errors, confirmed success, deferred/duplicate requests, validation/server failure, partial-save retry, unconfirmed status, post-commit read failure, draft/archive separation, dismissal/timer cleanup and focus without scrolling.
- Build passed JavaScript syntax, 76 asset references and 58 supplied photos.
- Native Chrome desktop fixtures verified Visa routes, themed editors and a successful Jobs publish-to-confirmation interaction using in-memory service adapters. No live publication/upload occurred.

Theme and branding details: [portal-theme-branding-2026-11-17.md](portal-theme-branding-2026-11-17.md). Visa's independent implementation: [staff-portal-theme-2026-11-17.md](../../../gary_visa_service/website/docs/staff-portal-theme-2026-11-17.md).

## Scope and remaining verification limits

No Home files, authorization rules, API contracts, schemas, migrations or Central Access Portal code changed. Current navigation and independently resizable editors remain. Existing original transparent Jobs logo assets are reused without artwork changes.

Changes are local and not deployed. Live authenticated uploads, realtime services and production publication remain unverified. Mobile behavior is covered by automated viewport/state tests; new native mobile screenshots were not captured because the user requested stopping screenshot work. Existing desktop evidence is in `visual-verification/2026-11-17-portal-themes/`. Native confirmation/file-picker internals remain browser/OS controlled.
