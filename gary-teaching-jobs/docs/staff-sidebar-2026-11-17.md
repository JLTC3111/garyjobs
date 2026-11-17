# Teaching Jobs staff navigation

## Scope and inventory

The staff portal now uses a persistent, Jobs-specific left navigation panel. Candidate navigation remains the existing My applications experience. The public website is unchanged by this task.

- Recruitment: Vacancies (CMS read capability), Recruitment applications (recruit capability).
- Directories: Employers, Job Categories, Locations (CMS read capability).
- Guides & answers: Guides and FAQs (CMS read capability).
- Content & media: Media Library (CMS read capability; existing upload authorization remains separate).
- Existing language, sign-out, and candidate/staff access controls remain accessible in the header/page chrome.

No destination, API, permission, schema, authentication rule, validation rule, or publication workflow was added or removed. No Central Access Portal code is involved.

## Implementation

`dist/jobs-portal.js` renders only permitted staff destinations and routes collection/media selections through the existing CMS controller. The redundant horizontal Content Manager/Recruitment row and internal CMS collection row are replaced by this one navigation structure in staff mode. The default shared CMS navigation remains available for other hosts.

The CMS gains optional external navigation integration: `navigation:false`, `navigate(destination)`, `navigationState()`, and `onNavigationChange`. `navigate` validates the destination, requires the existing read capability, honors the current dirty-leave confirmation and busy state, and uses the same collection/media transition behavior. The editor modal, shared resize/fullscreen controller, fields, uploads, and publishing adapter are unchanged.

`dist/jobs-staff-sidebar.js` owns navigation geometry only. It changes width CSS variables and navigation classes, never clones/replaces the form or calls editor save/reset methods. The exported `mountJobsStaffSidebar(doc)` returns `refresh`, `getState`, and `destroy` for integration/verification.

Normal navigation width is 272px, adjustable by dragging the right edge or using Left/Right, Shift for larger increments, Home for minimum, and End for maximum. Width is bounded at 216–384px and further constrained to preserve a 640px content workspace where feasible. At constrained widths the panel becomes a collapsible rail/overlay; on phones it becomes a compact top navigation entry with an expandable overlay. Escape closes the overlay and returns focus to its toggle. Resize handles hide when resizing is impractical.

Desktop collapsed rails keep all icon routes reachable with complete accessible labels/tooltips. Nested group preferences are restored on expansion. Width, collapsed state, and nested group preferences are stored separately under `gary-jobs:staff-sidebar:v1`. Editor geometry continues using `gary-editor-workspace:v1:...`; neither panel mutates the other's preferences. Storage denial/corruption falls back safely.

The staff panel has EN/VI labels and independent light/dark colors using the existing Jobs theme preference/system initialization. Theme styling is staff-scoped and does not replace the shared modal shell. Content tables retain their current readable surface; dark sidebar/header colors follow the staff palette. Reduced-motion preferences are respected.

## Files

- `dist/jobs-staff-sidebar.js`, `dist/jobs-staff-sidebar.css`: panel presentation, geometry, groups, persistence, and keyboard controls.
- `dist/jobs-portal.js`, `dist/portal.html`: permitted destination rendering, existing-route integration, theme/style/module imports.
- `dist/cms-foundation/index.js`, `index.d.ts`: opt-in external navigation API only.
- `tests/jobs-staff-sidebar.test.mjs`, `tests/helpers/jobs-staff-portal.mjs`: real portal/CMS/sidebar integration fixtures and regressions.
- `tests/jobs-auth-access.test.mjs`: updated assertions for the new destination labels while retaining permission/auth checks.

## Verification

Five integration tests cover all seven CMS destinations and permitted recruitment navigation, no duplicate controls, role filtering and candidate compatibility, active states, EN/VI, pointer/keyboard navigation resizing, collapse/persistence, constrained/mobile overlay and Escape, independent modal dimensions, preserved unsaved text/errors, dirty-leave refusal, create/save/publish, and retained media input/selected-file submission after navigation resizing.

The focused portal/sidebar/auth test run passes 29/29. Full Jobs suite passes 181/181. Static build passes JavaScript syntax, 76 asset references, and all 58 supplied photos. `git diff --check` passes. After the full run, small staff-only alignment/collapsed-rail refinements were covered by rerunning all five sidebar integration tests successfully. Browser screenshots and final cross-platform QA are handled by the task owner.
