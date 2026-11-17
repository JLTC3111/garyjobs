# Teaching Jobs portal themes and branding — 17 November 2026

## Root causes

The public site already owned the `gary-jobs-theme` Light / Dark / System preference and a pre-styles initializer. The portal loaded that initializer, so its root `data-jobs-theme` could correctly say `dark`, but it did not load the public site's semantic palette. Its component styles still specified white backgrounds and fixed navy/slate text. The newer sidebar defined a separate, staff-only dark palette; candidate pages, main content, CMS tables and editor controls never consumed it. A dark root/sidebar therefore did not imply full portal coverage.

The Jobs-vendored CMS stylesheet also used literal white surfaces for dialogs, sticky headers/actions, inputs and tables, plus fixed status colors. Its shared sizing controller already supported semantic surface/ink/line inheritance; incomplete host tokens prevented the editor from changing with the page. The custom CMS filter arrow was painted in a fixed slate; it now uses the native color-scheme-aware select arrow.

The public vacancy renderer uses `.job-location`, `.job-benefit`, `.job-tags` and `.job-card-bottom strong`. The previous theme adapter addressed titles and some descriptions but omitted these actual metadata descendants, leaving light-mode colors on dark card backgrounds.

The portal header rendered the website name as plain text. Existing transparent SVG variants were already available and used publicly. Their provenance records the original PNG hash, tracing method and unchanged artwork/lettering geometry; they are faithful derived paths, not an original vector master. No artwork was invented or altered in this task.

## Implementation and affected components

- `dist/jobs-public-theme.css` now provides the shared public/portal semantic palette. Portal light roles retain the existing light surfaces and navy identity; dark roles inherit the established navy/lavender palette. Success, warning, error, control border, backdrop, elevation and scrollbar roles are paired centrally.
- `dist/jobs-portal.css` consumes those roles for authentication, candidate application cards/forms/details, recruitment filters, pagination, notices, links, dropdowns and content surfaces. No light/dark component forks are required.
- `dist/jobs-staff-sidebar.css` retains the current geometry/groups/collapse/resize/persistence behavior while consuming portal roles rather than maintaining an independent staff palette. Recruitment filters and CMS workspace surfaces follow the theme too.
- `dist/jobs-portal-theme.css` maps the shared roles into the CMS and editor tokens, including body-appended success confirmations. It also styles the original logo variants, appearance control, native controls/placeholders, scrollbars and responsive header. Sidebar offsets follow the measured header height, including wrapped EN/VI/mobile controls.
- `dist/cms-foundation/styles.css` replaces literal component colors with semantic CMS surface/control/action/status/backdrop/focus tokens. Dialog headers, actions, forms, validation, SEO/revision panels, media and upload forms all inherit the active palette. This is a Jobs-local vendored change; no Home/Visa CSS was changed or synchronized.
- `dist/jobs-portal-appearance.js` exposes Light / Dark / System using `window.setGaryJobsTheme`, the existing preference key and existing theme event. Locale changes update labels without rebuilding the portal or forms. A header ResizeObserver updates layout geometry only.
- `dist/jobs-theme-init.js` remains the single early initializer on public, staff and candidate pages. Stored/system preference resolves before CSS; explicit changes, system updates and cross-tab storage updates set root theme/color-scheme immediately. Storage denial falls back to System. There is no second appearance storage key or hydration phase.
- `dist/portal.html` loads the common palette and portal adapters, adds the translated appearance selector, and restores existing `teaching-jobs-logo-light.svg` / `teaching-jobs-logo-dark.svg` assets. Both candidate and staff use this header; CSS selects the appropriate transparent asset without a theme-dependent content rewrite.
- Public location, employer/workplace, salary, benefits and metadata foregrounds now consume paired readable text roles on their actual card/dialog surfaces.

No navigation destination, API, capability check, authentication rule, database schema, migration or authorization code is changed by this theme/branding work. Sidebar and editor preferences remain independent. Existing inputs/file nodes and form state are never replaced by theme changes.

## Verification

`tests/jobs-portal-theme.test.mjs` adds four integration/contrast checks:

1. Actual staff and candidate portal logic in EN/VI with all three preference values, live system changes, cross-tab changes, persistence and no cross-platform preference writes.
2. Open maximized CMS editor/error/draft preservation and candidate application fields/selected files through theme changes.
3. Reload/pre-styles initialization, blocked storage, original transparent logo asset paths and proportions.
4. AA contrast of semantic text/status pairs in both palettes (4.5:1), control boundary/focus contrast (3:1), actual public metadata role coverage and absence of literal component color values in the portal/sidebar/CMS styles.

The existing original-logo geometry/provenance tests and existing public appearance tests still pass. The staff-sidebar test's obsolete isolated-dark-palette assertion now checks its semantic portal alias; its navigation/publishing expectations are maintained by the publishing refinement.

Combined repository verification after integrating the publishing work: **196/196 `npm test` checks passed**. `npm run build` passed JavaScript syntax, 76 asset references and all 58 supplied photos. `git diff --check` passed. These include local database publication tests; they do not represent production authentication/uploads/publication.

## Visual fixture

Run `node scripts/build-portal-theme-qa.mjs`. It builds the actual current portal, CMS, sidebar, appearance controller and CSS/assets against in-memory demo services. No live authentication, API, upload or publication request is made. The candidate fixture has two application cards and supports the real application detail form. The original CV validator is bundled independently from backend initialization.

- `file:///private/tmp/gary-jobs-theme-qa/portal.html?access=staff&theme=dark`
- `file:///private/tmp/gary-jobs-theme-qa/portal.html?access=candidate&theme=light`
- Add `&lang=vi` for Vietnamese or `&view=apply` for the candidate form.
- Use `theme=system` to test OS appearance, or the real appearance selector to switch immediately.

Screenshot capture and cross-platform verification are reported by the parent task. Production sessions and live uploads/publication are not exercised by this visual fixture.
