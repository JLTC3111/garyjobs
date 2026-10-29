# Gary Agency — Teach. Travel. Belong.

A responsive, bilingual rebuild of [garyagency.com](https://garyagency.com/). The visual direction combines deep blue, warm cream, editorial typography, Vietnam photography, and the agency's real community photos and partner logos.

## Run and deploy

```sh
npm ci
npm run dev
```

Open `http://localhost:4179`. To use another port, run `npm run dev -- --port 4181`.

```sh
npm run build
```

The photo carousel uses React, React DOM, and OGL, bundled locally with esbuild. `npm run dev` rebuilds the gallery when its source changes. `dist/` is the complete static site and can be served by any static host without installing dependencies on that host. `server.mjs` is a small development server; it is not needed by a static hosting service.

### Vercel

Deploy this directory with the included `vercel.json`. It selects the **Other** framework preset, runs `npm run build`, and serves `dist/` as static files. If this repository contains multiple projects, set Vercel's **Root Directory** to `gary-agency`.

The website does not need a Vercel Function or a production start command. `npm start` runs the local preview server only. If an older deployment shows `500 FUNCTION_INVOCATION_FAILED`, deploy the updated configuration so Vercel serves the static build. Existing deployments keep their original configuration until a new deployment is created.

The Sites project is registered in `.openai/hosting.json`. Publication was not completed because the execution environment could not resolve `git.chatgpt-team.site`. The expected Sites origin in the social image metadata is not a verified live URL. Before deploying elsewhere, update `og:image` to that host's origin.

## Visitor experience

- English and Vietnamese content, with a remembered language preference.
- Keyword and location search, including Vietnamese accent-insensitive matching.
- School category filters, saved roles, clear empty states, and expandable results.
- Five sourced teaching listings with full requirement dialogs, publication dates, and original-listing links.
- Role-specific application forms that prepare email drafts addressed to the published recruiter.
- Service and destination dialogs, contact options, FAQ disclosures, and phone navigation.
- The life beyond the classroom section uses the actual React Bits `FlexCarousel`, with all 58 supplied photographs, location filters, captions, keyboard/arrow controls, drag/swipe, and click-to-focus. It uses `preset="liquid"`, `intro="rise"`, `cardHeight={0.5}`, `gap={12}`, and `squeeze={0.2}`. The stage is 560 px tall on desktop and adapts on phones. The four supplied videos are not part of this image carousel.
- Direct links to [Gary Homes](https://garyhome.vn/) and [Gary Visa Service](https://visa.garyhome.vn/) in the desktop service navigation, phone menu, support cards, matching service dialogs, and footer. External service links open in a new tab.
- Keyboard focus, native modal focus containment, reduced-motion support, larger phone controls, and local browser storage.

Application forms **do not submit data to a backend**. They prepare a `mailto:` draft, show an address and copyable message as a fallback, and ask the visitor to attach their documents before sending. No application is silently sent or stored remotely. Job data is a source snapshot, not a live CMS integration; availability and final terms must be confirmed with the recruiter.

## Files

- `dist/index.html`: document metadata, initial readable fallback, and modal shell.
- `dist/app.js`: bilingual content, sourced listings, and visitor interactions.
- `src/components/FlexCarousel.jsx`: the React Bits component, with localized accessible labels.
- `src/components/PhotoGallery.jsx`: the gallery, album filters, controls, and a photo-strip fallback for devices without WebGL 2.
- `src/data/photos.json`: all 58 local photos, with English/Vietnamese titles, alt text, locations, and image dimensions.
- `dist/photo-gallery.js` and `dist/photo-gallery.css`: compiled, self-hosted carousel assets.
- `dist/styles.css`: responsive design and self-hosted fonts.
- `dist/assets/`: optimized WebP photography, logos, favicon, and fonts.
- `scripts/check-site.mjs`: JavaScript syntax and local asset checks.
- `scripts/prepare-photos.py`: regenerate the WebP gallery images and photo manifest after adding source photographs (requires Pillow and pillow-heif). Photo exports exclude camera/EXIF metadata.

## Content and image provenance

Source reviewed on 28 October 2026 (Asia/Ho_Chi_Minh):

- [Gary Agency homepage](https://garyagency.com/): agency services, placement-fee promise, public contact information, partner logos and community photos. Originals are served from its `/wp-content/uploads/` paths. Community images are presented as real moments without invented quotations or ratings.
- [Bắc Giang listing](https://garyagency.com/offer-in-bac-giang-2/).
- [Hải Phòng listing](https://garyagency.com/%f0%9f%9a%a8-teaching-opportunity-in-hai-phong-%f0%9f%87%bb%f0%9f%87%b3-public-schools-2/).
- [Thạch Thất, Hanoi listing](https://garyagency.com/job-offer-in-thach-that-hanoi/).
- [Đồng Nai listing](https://garyagency.com/%f0%9f%8c%9f-full-time-english-teacher-needed-dong-nai-%f0%9f%8c%9f-4/).
- [Thái Nguyên listing](https://garyagency.com/native-english-teacher-needed-thai-nguyen-2/).
- Hero: [Ferdinand Stöhr / Unsplash, “View from Mua Cave”](https://unsplash.com/photos/a-river-running-through-a-lush-green-valley-wl_3yExsNsg).
- The life beyond the classroom carousel uses every supplied photograph: 27 from `assets/public/images/hagiang/`, 8 from `assets/public/images/hoian/`, and 23 from `assets/public/images/hanoi/`. Optimized, browser-ready files live in each location's `gallery/` subdirectory. The selected cover photographs remain available as `destination.webp` in the matching location detail dialogs.
- The header uses the supplied Vietnam English Teaching Jobs logo, sourced in higher resolution from the agency's [original PNG](https://garyagency.com/wp-content/uploads/2025/02/LOGOgary.png). Its cap, stars and curved mark are used in the PNG favicons and mobile icons; the full wordmark remains on the page.

Mobile/browser icons: `assets/favicon-32.png` (32 px), `assets/apple-touch-icon.png` (180 px), `assets/icon-192.png`, `assets/icon-512.png`, and a transparent 512 px `assets/favicon.png`. `site.webmanifest` and the document head reference the appropriate PNGs.

DM Sans and DM Serif Display are used for English. Be Vietnam Pro and Lora provide complete Vietnamese glyph coverage. Fonts are self-hosted from Google Fonts and its [official font repository](https://github.com/google/fonts), under their respective SIL Open Font Licenses in `licenses/`.

The [Flex Carousel component](https://reactbits.dev/components/flex-carousel) comes from the [official React Bits source](https://github.com/DavidHDev/react-bits/tree/main/src/content/Components/FlexCarousel). Its MIT + Commons Clause notice, React/React DOM licenses, and OGL notice are included in `licenses/`. The component is integrated into this website, not distributed as a standalone component product.

## Verification

Verified in desktop Edge and responsive Chrome: English and Vietnamese page rendering, phone navigation, keyword search, bookmarking and saved roles, role details, required form validation, and preparation of an email draft using disposable test details. No email was sent. The static build checks JavaScript syntax and asset presence.

The photo carousel was also checked in Chrome on desktop and at a 390 px phone width: real local photographs, location filtering, next-photo controls, Vietnamese captions, language switching, keyboard navigation to the last photo, Enter/Escape focus, and the Hội An destination dialog. The build confirms all 58 supplied photographs are included.

## Shared Gary Apps updates

The header and phone navigation connect to Gary Home's shared runtime at
`https://garyhome.vn/shared/gary-apps/v1/manifest.json`. The manifest points to
matching, hashed JavaScript and CSS from one release. Publishing that shared
release updates Homes, Jobs and Visa without rebuilding Jobs. Visible pages
check once a minute and on returning to the tab; an open or focused menu finishes
its interaction before the new release replaces it.

`src/components/GaryAppsMount.jsx` keeps the locally bundled menu available until
the remote component and its stylesheet load successfully. Network errors leave
the current menu usable. The adapter forwards the current English/Vietnamese
language and mobile-menu callbacks. The shared component reads no account data.

The canonical component, catalogue, release builder and browser protocol adapter
live in Gary Home's `shared/gary-apps/`. Jobs keeps a copy of `client.js` only for
the stable loading protocol, plus its last known local component as a fallback;
regular design, copy and link changes belong in the canonical Home component.
Change the local protocol copy only when the loading API itself changes.

Run `npm run test:shared` for manifest validation, deduplicated loading, language
updates, deferred release replacement, retry and unmount cleanup checks. Run
`npm run build` for the complete static-site validation.
