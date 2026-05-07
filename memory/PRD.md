# Jax Studio — Coming Soon Landing Page

## Original Problem Statement
> "I want to use this as my landing page. https://github.com/lorenzocadamuro/apple-fifth-avenue what can I customize on this?"

User chose to customize the Apple Fifth Avenue WebGL cube demo into a "Coming Soon" landing page for **Jax Studio** (graphic design business / portfolio).

## Architecture
- **Stack**: Vanilla JS + WebGL (regl) + GLSL shaders + webpack 4 (frontend) | FastAPI + Motor + MongoDB + SendGrid (backend)
- **Service**: `yarn start` → `webpack-dev-server` on `0.0.0.0:3000` (supervisor)
- **API**: `/api/*` routed via Kubernetes ingress to FastAPI on `:8001`
- **Old React frontend**: backed up at `/app/frontend_bak_react`

## Owner / Brand Configuration
- Brand: Jax Studio (graphic design)
- Domain: jaxstudio.ink (verified in SendGrid)
- Sender: hello@jaxstudio.ink (Jax Studio)
- Owner notifications: jaxstudio.ink@gmail.com

## Implemented Features

### Phase 14.8 (Feb 2026) — Site Access switch + Padlock-only Admin launcher
User feedback: "in the control panel add a access switch at the top. This would control whether or not they can access the page after clicking the cube. when access switch is off 'click the cube' should not be visible. i want the admin button visible throughout the page. I want it just as the pad lock and when i move my mouse over it reveals the text 'admin' like how it originally looks."

- **Site Access switch** — new `access_enabled` field on `Settings` (validated bool, default `True`). Persistent bar at the top of the admin panel header (above all 5 pages). iOS-style toggle with live status label ("Visitors can enter" / "Site is locked"). Instant save on change — no Publish required. When OFF: `body.site-locked` class is added, the `.hint` ("click the cube") is hidden via inline `display: none`, and clicking the cube does NOT trigger the welcome overlay (gated in both `.content` click and `touchend` handlers via the `_accessEnabled` flag).
- **Admin launcher redesigned** — collapsed by default (only the padlock icon visible, label has `max-width: 0; opacity: 0`); CSS `:hover` + `:focus-visible` expands it (`max-width: 80px; opacity: 1`) with a 0.35 s cubic-bezier transition. The `padding-right` also widens slightly so the label doesn't crowd the icon.
- **Persistent visibility** — launcher z-index bumped from 12 to **80** so it stays visible above the welcome overlay (50) and the about section (70). Verified visible (display:flex, opacity:1, in viewport) at cube/welcome/about/projects routes.
- **TDZ bug fix** — `window.__access = { setAccessEnabled }` was previously assigned BEFORE the `const setAccessEnabled = ...` declaration, leading to the bundled output capturing `undefined` (webpack doesn't hoist `const` initializers). Moved the exposure to immediately after the const so it's TDZ-safe.

**Test coverage**: 38/38 backend pytest pass — added new `TestAccessEnabled` class with 6 tests (public GET exposure, PUT True/False round-trip, reset, exclude_none preserves existing, type-coercion). Frontend e2e verified by `testing_agent_v3_fork` — TDZ fix, launcher z-index/collapse/CSS-hover-rule, access toggle instant-save + cube-click gate + hint hide + body class.


User feedback: "I'm seeing the cube flash at some instances when I scroll back to the welcome. Do a Hybrid (continuous scroll + letter FX triggers as you cross the threshold)."
- **Continuous scroll layout** — Welcome is `position: fixed; z-index: 50` covering the first viewport; About is `position: relative; margin-top: 100vh; z-index: 70` flowing below. Document height = 200vh (welcome + about). Body becomes `is-scrollable` automatically ~600 ms after the welcome entrance completes.
- **Threshold-driven letter FX** — A single `window.scroll` listener (rAF-debounced) plays `playAboutExit()` once when scrollY crosses **30 vh** (welcome heading letters + decorative shapes scatter), and plays `playAboutEntrance()` once when scrolling back below **10 vh**. The trigger uses an internal `_aboutFxState` flag so each direction fires once per crossing.
- **No cube flash** — the previous implementation faded the welcome to opacity 0, briefly exposing the WebGL cube behind it. The hybrid keeps the welcome at full opacity throughout; About's solid `var(--color-bg)` background fully covers the welcome (and cube) as it scrolls into view. Verified visually at y=0/100/300/500/700/900/1080 with `welcome_opacity: 1` at every position.
- **Scroll arrow** smooth-scrolls to About's top. **About's "Back" button** smooth-scrolls to top (lets the threshold-triggered letter ENTRANCE play naturally as the user crosses 10 vh going up). **Welcome's small back arrow** dismisses the entire scroll-mode + welcome to cube.
- **Past Projects button** unchanged — still calls `_exitOverlay` (welcome's slide-up + letter exit) and reveals the projects grid as a separate route.
- **CSS layout fix** — `html.is-scrollable, body.is-scrollable { height: auto !important; min-height: 100% }` was needed because the base `html, body { height: 100% }` was capping body height at viewport, preventing native scrolling even with `overflow-y: auto`.

### Phase 14.5 (Feb 2026) — DecorativeLetterAnimations on Welcome ↔ About transition (superseded by 14.6)
The discrete-transition flow was upgraded to a continuous scroll. Admin Page 5 controls (`about_transition_effect` dropdown + `about_transition_speed` slider) and the underlying `playAboutExit/playAboutEntrance` API in `welcomeFx.js` are unchanged — they're now triggered by scroll thresholds instead of explicit goToAbout/goBackToWelcome calls.
User feedback: "What happened to the DecorativeLetterAnimations github i gave u to use? I want it so that when i barely scroll my mouse twice to go to the about section it animates-out using the DecorativeLetterAnimations and then fade in the about section. This should have sliders and a dropbox to pick animation styles." User confirmed: bidirectional (a) — scroll back up reverses with letter entrance.
- **Welcome → About transition** now plays the DecorativeLetterAnimations EXIT (per-letter swirl + decorative shapes scattering) on the welcome heading, then fades the welcome to opacity 0 (`is-faded` class). About fades in over it (`position: fixed; inset: 0; z-index: 70`).
- **About → Welcome reverse** — at the top of About (`scrollTop ≤ 2`), wheel-up (deltaY < -10) OR clicking the back button replays the letter ENTRANCE animation, restoring the welcome.
- **Dedicated admin controls** (Page 5 → "Welcome → About transition" section):
  - Effect dropdown: "Same as welcome entrance" (default) + 9 codrops presets (Eurhythmic, Aquarius, Lycanthropy, Wonderland, Screenager, Callipygian, Eviternity, Jumbuck, Babooner).
  - Speed slider: 0.5×–2.0× with live `1.50×`-style label.
  - Both edit `about_transition_effect` and `about_transition_speed` on the public Settings document.
  - Live-preview wires `window.__welcomeFx.setAboutTransitionSettings(...)` on every change — no Publish required to see the effect on the next scroll.
- **Backend Settings model** gains `about_transition_effect` (str, must be in `ALLOWED_LETTER_EFFECTS` or `null`) and `about_transition_speed` (float `0.5..2.0` or `null`). Validated in `SettingsUpdate`. `POST /api/admin/settings/reset` clears both. PUT with null is a partial no-op (existing semantics).
- **Implementation note**: `welcomeFx.js` reuses the already-built `_headingWord` / `_subWord` Word instances and only swaps the effect's `show` / `hide` config when the new `playAboutExit` / `playAboutEntrance` are called — no DOM rebuild needed since codrops effects share the same per-letter span structure.
- **Test coverage**: 35/35 pytest pass (9 new tests for the transition fields — every codrops effect, range 422s, boundaries, public exposure, reset, partial-update preservation). Frontend verified by `testing_agent_v3_fork` end-to-end (letter FX exit → about fade-in → wheel-up reverse → letter entrance, plus admin live-preview & publish round-trip).

### Phase 14.4 (Feb 2026) — Scroll-back-to-welcome + About back button polish
(Superseded by 14.5 — the scroll-back-to-welcome behaviour is now reverse-letter-FX rather than the dual-section scroll.)

### Phase 14.3 (Feb 2026) — About section + Page 5 admin CMS + greet/bang exit animation
- New `<section class="about">` revealed when scrolling down from welcome. Photo + name/role/years card on the left (sticky on ≥880 px), heading + body paragraphs + animated skill bars + tools chips on the right.
- Admin Page 5 (`data-page="5"`) — full CMS for the About section: eyebrow, title (pre + emphasis), body (multi-paragraph blank-line split), photo upload, name, role, years, skills (`name : pct` per line), tools (comma-separated). Live-preview as you type; persists via `PUT /api/admin/settings`.
- Backend extension — `Settings` + `SettingsUpdate` models gain `about_eyebrow`, `about_heading_pre`, `about_heading_emphasis`, `about_body`, `about_photo_url`, `about_person_name`, `about_person_role`, `about_years`, `about_skills` (list of `{name, pct}`), `about_tools` (list of strings), all with appropriate range/length validation. New endpoint: `POST /api/admin/about/upload` (PNG/JPG/WEBP/SVG ≤ 6 MB → `/api/uploads/about-<hex>.<ext>`).
- "Welcome to" greet, "!" bang, sub-heading, and action buttons now animate during the welcome's exit (e.g. clicking "Past Projects") via the new `is-exiting` class — fade + translate-up + bang rotates/falls — so nothing sits frozen while the per-letter swirl plays.


- WebGL cube replaces React frontend; J logo (decoded from user's PNG) replaces Apple logo on all 3 logo faces
- Brand corners: top-left "JAX STUDIO", bottom-right "COMING SOON"
- Click cube → ripple from click point → "WELCOME TO / JAX STUDIO!" overlay
- Mouse parallax + auto-rotation slows as cursor approaches center; mobile parity via touch
- dat.gui controls + stats panel disabled (stubs)

### Phase 2 (May 2026) — Contact + SEO + Font
[…unchanged…]

### Phase 3 (May 2026) — Logo refresh + Device tilt
- Replaced cube logo texture with the user's official `J.svg` artifact
  - SVG rendered at high res via cairosvg → forced white-on-transparent → centered on a 1024×1024 canvas → saved to `/app/frontend/src/assets/logo.png`
- **Mobile DeviceOrientation tilt parallax**:
  - Listens to `deviceorientation` (gamma → x, beta → y) and feeds the same `pointer` state as mouse / touch
  - Auto-calibrates the first reading as the user's neutral pose (so resting hold ≈ 0,0)
  - Sensitivity tuned to ~22° = full deflection (gentle, not jittery)
  - iOS 13+ permission gate: request triggered on the first user gesture (touch/click), fails silently if denied
  - Re-calibrates on `orientationchange` (portrait ↔ landscape)
  - Only auto-attaches on coarse-pointer devices (phones / tablets) — desktop unaffected
- **Mobile shake-to-spin easter egg**:
  - `devicemotion` listener tracks frame-to-frame acceleration delta; when > 18 m/s² it boosts auto-rotation up to 7×, decaying back to normal in ~1.5s
  - Shares the same first-gesture permission flow as orientation

### Phase 14.2 (Feb 2026) — Scroll & swipe sensitivity sliders (Page 2)
User asked for runtime control over swipe-to-projects sensitivity.
- New **"Scroll & swipe sensitivity"** section at the bottom of Page 2 with two sliders:
  - **Mobile swipe-up threshold** — 16 → 80 px, default 36 px (the upward finger-drag distance needed on the welcome overlay to trigger the projects reveal)
  - **Desktop wheel-down threshold** — 4 → 40 px, default 12 px (the `e.deltaY` gate on the wheel listener)
- Live-preview wired via `window.__motion = { swipeThresh, wheelThresh }`. The wheel/touchmove handlers in `index.js` read from `window.__motion` on every event, so a slider drag instantly updates sensitivity without a Publish.
- Backend `Settings` + `SettingsUpdate` extended with `swipe_threshold` (int 16-80) and `wheel_threshold` (int 4-40). Reset endpoint clears both back to null.
- Verified live: `PUT { swipe_threshold: 24, wheel_threshold: 8 }` → 200, `GET /api/settings` reads them back; out-of-range (150) → 422 with descriptive Pydantic error.
- The letter-effect dropdown was already on Page 2 (under "Decorative letter animation" → "Effect"); no change needed there.

### Phase 14.1 (Feb 2026) — Mobile fixes for scrolling + persistent UI
User reported on mobile:
1. couldn't scroll the welcome overlay down with a finger swipe (only tapping the bottom worked)
2. projects section wasn't scrollable
3. "CLICK THE CUBE" hint persisted on the projects view

**Fixes:**
- **Touch-swipe to projects:** added `touchstart` / `touchmove` / `touchend` listeners on `.welcome-overlay` that detect a >36 px upward swipe and trigger `goToProjects()` (mirroring the existing wheel-down behavior). Mobile users now reveal projects with their finger, not just a tap on the arrow.
- **Body & html scrolling unlocked:** `html.is-scrollable` and `body.is-scrollable` now both override `overflow: hidden` to `overflow-y: auto !important`, set `height: auto`, and enable iOS-style `-webkit-overflow-scrolling: touch`. The `<html>` class is also added in JS via `document.documentElement.classList.add('is-scrollable')`.
- **`<main>` overflow override:** the main element had `width:100vw; height:100vh; overflow:hidden` clipping the projects section to the first viewport. Added `body.is-scrollable main { overflow: visible; height: auto; min-height: 100vh }` so the full grid is reachable. Verified live: `scrollHeight` jumped from 844 → 2135 px on a 390×844 mobile viewport, scrolling now lands at any y.
- **Cube hint + COMING SOON tagline hidden** when projects are active via `body.is-scrollable .hint { opacity: 0; visibility: hidden; pointer-events: none }` and same on `.frame__tagline`. Verified `hintVis: 'hidden'` after scroll.

### Phase 14 (Feb 2026) — Letter animations, scroll-to-projects, & admin Page 4 CMS
A massive feature drop covering 3 user requests in one pass:

#### A) Ripple defaults shipped (1.80× / 20% / 4 rings)
- `DEFAULTS` in admin.js, slider initial values, and CSS fallbacks all bumped
- Live-DB values updated via PUT so the deployed site already reflects them

#### B) Decorative letter animations on the welcome overlay (codrops)
- Vendored the codrops `DecorativeLetterAnimations` repo (MIT) into `/app/frontend/src/js/letterFx/`:
  - `wordFx.js` — adapted to ES modules (with a tricky webpack 4 + babel-loader interop fix: `require('animejs')` returns `{__esModule: true, default: anime}`, so we unwrap with `_animeImported.default || _animeImported`)
  - `effects.js` — all 9 named presets (Eurhythmic, Aquarius, Lycanthropy, Wonderland, Screenager, Callipygian, Eviternity, Jumbuck, Babooner) extracted from the codrops demo, plus a `customizeEffect()` helper that applies user overrides without breaking function-based delay/duration values
- New `welcomeFx.js` module manages `Word` instances on `.welcome-overlay__brand` and `.welcome-overlay__sub`:
  - Captures original heading/sub text on first run, restores on tear-down
  - Replaces ASCII spaces with non-breaking spaces (`\u00a0`) so charming-split spans don't collapse whitespace under `display: inline-block`
  - Keeps the orange `!` as a separate, un-split sibling so it retains the `welcome-overlay__bang` class
  - `playWelcomeEntrance()` / `playWelcomeExit()` Promises wired into the cube-click & dismiss flow
- Page 2 of admin panel gets **8 new tweakables** (settings persist via the existing `/api/admin/settings` PUT):
  - **Effect** dropdown — None + 9 named presets
  - **Speed** slider — 0.5× → 2.0× (multiplies durations & delays)
  - **Per-letter stagger** slider — 0 (use preset) or 10 → 80 ms override
  - **Decoration shapes** select — Mix · Circles only · Rectangles only · Triangles only
  - **Decoration density** select — Sparse · Normal · Dense (multiplies `totalShapes` by 0.5/1/1.6)
  - **Filled shapes** checkbox — uncheck for outlined only
  - **Tint shapes from accent color** checkbox — overrides the preset's color palette with `[accent, white, black]`
  - **Apply to** select — Heading only · Sub-heading only · Both
- Backend `Settings` + `SettingsUpdate` extended with `welcome_letter_*` fields + range-validated allowed-value sets (`ALLOWED_LETTER_EFFECTS`, `ALLOWED_LETTER_DENSITIES`, `ALLOWED_LETTER_SHAPES`, `ALLOWED_LETTER_APPLY_TO`)
- All controls live-preview without needing Publish — the next cube click shows the effect immediately

#### C) Scroll arrow → Past Projects section + admin Page 4 CMS
- Tiny **scroll arrow** at the bottom of the welcome overlay — fades in `0.8 × ripple_speed` seconds after the welcome heading reveals; pulses with a 2 s `scroll-bob` keyframe
- **Click or wheel-down** triggers `playWelcomeExit()` → `is-scrolling-out` (overlay slides up off-screen over 0.9 s with `cubic-bezier(0.7, 0, 0.2, 1)`) → reveals `.projects` section + `body.is-scrollable`
- **Past Projects section** at `<section class="projects">` with eyebrow / heading / lede / 3-column responsive CSS grid:
  - 3 cols on ≥1100 px viewports, auto-fit ≥320 px on tablet, ≥290 px on mobile
  - Cards: image + accent-tinted gradient placeholder (with the project's first-letter initial when no image), hover-revealed overlay (orange year tag, title, 3-line clamped description)
  - **3D tilt on hover** — JS `mousemove` → `rotateX/rotateY` (-4.5°..+6° range) + `scale(1.02)` + accent-tinted glow box-shadow; lerps with 0.18 weighted easing for buttery-smooth motion; resets on `mouseleave`
- **New backend collection** `projects` with full CRUD:
  - `GET /api/projects` — public, sorted by `sort_order` then `year` DESC
  - `POST /api/admin/projects`, `PUT /api/admin/projects/{id}`, `DELETE /api/admin/projects/{id}` — auth-required
  - `POST /api/admin/projects/upload` — multipart file upload (.png/.jpg/.jpeg/.webp/.svg, ≤6 MB), stored under `/app/backend/uploads/`, served via `/api/uploads/*`
- **Admin Page 4** — full-fledged project CMS:
  - "+ Add" button creates a new placeholder
  - Each project row inline-edits title, year, sort order, description (Save persists)
  - "Upload image" / "Replace image" — uploads to backend, persists `image_url` immediately
  - "Delete" — confirms then DELETEs (also unlinks the uploaded image file)
  - Rendered in scroll list with thumbnail, accent-tinted thumb when no image
- **6 seeded placeholder projects** populated via `POST /api/admin/projects` so the deployed site has content out of the box

### Phase 13.1 (Feb 2026) — Ripple base timing slowed ~25%
User feedback: the default `1.0×` ripple felt too fast. Slowed every base duration & delay roughly 25 % so the new default reads as relaxed-cinematic instead of punchy:
- Ring durations: 1.40 / 1.55 / 1.70 / 1.85 / 2.00 s → **1.75 / 1.95 / 2.15 / 2.35 / 2.55 s**
- Ring start delays: 0 / 0.10 / 0.22 / 0.36 / 0.52 s → **0 / 0.13 / 0.28 / 0.45 / 0.65 s**
- Final fill: duration 1.10 → **1.40 s**, delay 0.45 → **0.55 s**
- Welcome heading fade-in: delay 1.50 → **1.85 s**
- Slider remains 0.5× → 2.0× — users who want punchier still have full range below 1.0×, dreamier still goes above

### Phase 13 (Feb 2026) — Admin Page 3: Cube ripple "Effects"
- **3 new controls** on Page 3 of the multi-page admin panel:
  - **Speed** slider (0.5× → 2.0×, default 1.0×) — multiplier applied to every ripple animation duration & delay (ring 1–5 + final fill + welcome text fade-in) via the new `--ripple-speed` CSS custom property on `:root`. Lower = punchier, higher = dreamier.
  - **Accent tint strength** slider (0% → 60%, default 30%) — drives the `var(--ripple-tint)` CSS var that's plugged into the `box-shadow` halo's `color-mix(in srgb, var(--accent) var(--ripple-tint), transparent)`. As you change accent color in Page 1, the ripple rings inherit the tint live.
  - **Ring count** select (3 / 4 / 5, default 4) — `data-rings` attribute on the `.welcome-overlay__ripple` element; CSS `:nth-child(n+4)` and `:nth-child(n+5)` selectors gate the trailing rings via `display: none`. A 5th ring animation was added (delay 0.52 s, duration 2.00 s, alpha 0.10) for the "layered pond" option.
- **Pager moved out of the scroll container** to a new flex row between the scroll area and the footer, so it's always visible regardless of how much content sits in the active page (was previously buried at the bottom of the long Page 1)
- **Live preview** — every slider drag immediately updates the corresponding CSS custom property on `:root` so the ripple feels different on the next click without needing to hit Publish
- **Backend persistence**: new `ripple_speed` (float, 0.5–2.0), `ripple_tint` (int, 0–60), `ripple_ring_count` (int, 3–5) fields on `Settings` and `SettingsUpdate`, wired through Reset to defaults. Live API verified:
  - PUT `{ ripple_speed:1.4, ripple_tint:45, ripple_ring_count:5 }` → 200 OK with values echoed
  - GET `/api/settings` returns the same values for public visitors
  - Out-of-range PUTs (`ripple_ring_count: 7`, `ripple_speed: 3.5`) → 422 with descriptive Pydantic error
  - Reset endpoint clears all three back to null

### Phase 12 (Feb 2026) — Water-style ripple effect on cube click  *(refined)*
**Refinement after first pass — softer, dreamier, designer-tinted:**
- **Slower & dreamier**: base ring duration 1.15 s → 1.40 s; per-ring delays bumped (0 / 0.10 / 0.22 / 0.36 s); fill kicks in at 0.45 s and ends at 1.55 s; welcome heading retimed to fade in at 1.50 s
- **Less white**: leading ring's border opacity 0.92 → 0.70 with a warm cream tint `rgba(255, 245, 235, 0.7)` instead of pure white — reads as "light bouncing off water" instead of "neon flashlight"
- **Four rings** instead of three (border alphas 0.70 / 0.45 / 0.28 / 0.16) — the extra trailing echo makes the splash feel organic rather than structured
- **Accent-orange tint at the leading edge**: each ring's outer halo is now `color-mix(in srgb, var(--accent) 30%, transparent)` so the shock-wave glows warm in the brand color; the inner radial wash also picks up a 5% accent-tint at the center. As soon as the user changes their accent color in the admin panel, the ripple inherits it automatically — fully on-brand, no separate config needed
- Verified via computed-style inspection: `box-shadow: color(srgb 1 0.341 0.133 / 0.3) 0 0 32px 6px ...` confirms the accent (`#ff5722`) is correctly resolved by the browser

**Original implementation** (still in place):
- Replaced the single solid expanding circle with a layered water ripple
- Border-width animates 4 px → 0.6 px during expansion (rings naturally thin out as they spread)
- 0.5 px CSS blur for the wet-surface look
- Pure HTML/CSS — no JS changes needed (existing click handler still just sets `--ripple-x` / `--ripple-y`)

### Phase 11 (Feb 2026) — Collapsible Inbox + Multi-page Admin Panel
- **Inbox is now collapsible**:
  - Section header is a clickable toggle with a chevron icon (rotates -90° when collapsed)
  - Auto-collapse on first load when there are no unread messages, auto-open when there are
  - User preference persists in `localStorage` (`jax_admin_inbox_collapsed`)
  - Refresh button (↻) keeps `e.stopPropagation()` so it doesn't accidentally toggle the section
- **Multi-page panel cycling** (← 1/2 →):
  - Existing seven sections are now wrapped in `[data-page="1"]`; the new welcome-typography section lives in `[data-page="2"]`
  - Pager bar at the bottom of the scroll area: prev arrow + "1 / 2" indicator + next arrow (the prev/next disable at the ends)
  - Animated page-in (8 px slide + fade, 280 ms) + scroll position resets to top on switch
  - Active page persisted via `localStorage` (`jax_admin_panel_page`) so reopening the panel returns to your last-viewed page
- **Page 2 — Welcome overlay typography**:
  - Letter spacing slider (-0.05 → 0.6 em, default -0.02)
  - Line spacing slider (0.7× → 2.0×, default 0.95)
  - Both apply LIVE via CSS custom properties on `:root` (`--welcome-brand-ls`, `--welcome-brand-lh`) consumed by `.welcome-overlay__brand`
  - Backend persistence: new `welcome_letter_spacing` + `welcome_line_spacing` fields on `Settings` and `SettingsUpdate` (with the same range validators), wired through Reset to defaults, and round-trip-tested via PUT → GET (live API confirmed: `ls=0.12 lh=1.6` saved, public GET reads it back, out-of-range PUT properly 422s)

### Phase 10 (Feb 2026) — Production static build (Jax site)
- Switched supervisor's `frontend` program from `yarn start` (webpack-dev-server) to `yarn start:prod`
- New `start:prod` script in `/app/frontend/package.json`: `yarn build && serve -s dist -l tcp://0.0.0.0:3000 --no-clipboard`
- Added `serve@latest` as a dev dependency (lightweight static-only HTTP server with SPA fallback)
- Verified live preview URL: `/`, `/main.js`, `/og-image.png` all return 200 with the production-minified webpack build; `/api/*` continues to be routed to the FastAPI backend (8001) by the Kubernetes ingress, fully unaffected
- To restore dev-mode hot reload during local edits: run `yarn start` manually (port 3500 free via `yarn dev` on a separate port if needed)

### Phase 9 (Feb 2026) — Admin Inbox + SendGrid Event Webhook
- **Admin Inbox** — top section of the floating control panel:
  - Live unread count badge in the section title (`6`, `99+`, hidden when 0)
  - Refresh button (rotating ↻) to re-fetch
  - Per-message card: name, relative time (just now / 23m ago / 2h ago / 3d ago), email, 2-line snippet, optional event chips (delivered / open / click / bounce / dropped / spamreport — each color-coded)
  - Unread items get an orange left bar + tinted background; clicking expands the item, marks it read on the server (PATCH `/api/admin/contacts/{id}` with `{read:true}`), shows the full message + Reply (mailto:) / Mark unread / Delete actions
  - Backend: `GET /api/admin/contacts?limit=&skip=&unread_only=` (auth required, paginated, newest first, returns `{total, unread, items[]}`), `GET /api/admin/contacts/{id}`, `PATCH /api/admin/contacts/{id}` (mark read/unread), `DELETE /api/admin/contacts/{id}`
  - New `read: false` and `events: []` fields persisted at `contact_submissions` insert time
- **SendGrid Event Webhook** — `POST /api/webhooks/sendgrid`:
  - ECDSA P-256 (SHA-256) signed-payload verification using SendGrid's official `EventWebhook` helper (`sendgrid-python` SDK ≥ 6.x)
  - Rejects: no headers → 401, bad signature → 403, replays > 10 min old → 403
  - Custom args (`submission_id`, `kind`) attached to every outgoing `Mail` so events map back to their `contact_submissions` doc; events appended via `$push: { events: {...} }`
  - Verification key stored at `SENDGRID_WEBHOOK_PUBLIC_KEY` env var (loaded once at startup, fail-closed if unset)
  - Pytest at `/app/backend/tests/test_webhook_signature.py` validates the full chain with a synthetic P-256 keypair (3/3 passing)
- **Configuration step (one-time, on user's side)**:
  1. SendGrid Dashboard → Settings → Mail Settings → Event Webhook
  2. POST URL: `<deployed-host>/api/webhooks/sendgrid`
  3. Enable **Signed Event Webhook** (verification key is already in `.env`)
  4. Pick events: delivered, opened, clicked, bounced, dropped (recommended)
  5. Send "Test Integration" → status code should be 200

### Phase 8 verified (Feb 2026) — Template build + smoke screenshot
- `yarn install` + `yarn build` clean in `/app/template/frontend` (webpack 4 production build, all assets compile)
- Served via `python -m http.server` and screenshot-verified: STUDIO NAME / GET IN TOUCH / ADMIN / COMING SOON corners present, placeholder rounded-square logo + COMING/SOON cube text textures, "CLICK THE CUBE TO ENTER" hint visible, no Jax-specific branding bleed
- Jax live site (`/app/frontend`) also smoke-screenshot verified: J cube, JAX STUDIO / GET IN TOUCH / ADMIN / COMING SOON corners present, "CLICK THE CUBE" hint visible
- Both backends confirmed using MongoDB via `motor.motor_asyncio.AsyncIOMotorClient` for `site_settings` (singleton id="main") and `contact_submissions` collections — handoff summary's "in-memory dict" claim was stale, the DB persistence layer is real

### Phase 8 (May 2026) — Standalone reusable template at `/app/template/`
- Created a complete, standalone, brand-neutral copy of the codebase at `/app/template/` (frontend + backend + README)
- **Stripped Jax-specific defaults** throughout:
  - Brand: Jax Studio → "Studio Name", `jaxstudio.ink` → `template.test`
  - Generic placeholder logo (rounded-square mark) and "COMING" / "SOON" text textures
  - Generic 1200×630 OG image
  - Empty SendGrid creds in `.env` (with placeholder sender + owner emails)
  - Default admin password = `template2026` (with bcrypt hash in `.env`); placeholder `JWT_SECRET` flagged for replacement
  - Removed welcome-overlay / ripple HTML, CSS, and JS from `index.html`, `base.css`, `index.js`, `admin.js`
  - Removed `welcome_heading` / `welcome_sub` fields from `Settings`, `SettingsUpdate`, reset endpoint, and admin DEFAULTS
- **Cube click → curtain lift reveal** of a behind-page placeholder site:
  - `.landing-curtain` is `position: fixed; z-index: 60`
  - On click → adds `.is-revealed` (fade + scale 1.08 + 6 px blur over 0.9 s) → removes `body.is-locked` to unlock scrolling
  - Behind-page sections: hero with display title + lede + CTAs, 6-card work grid (each card is a `linear-gradient` between two CSS-variable colors per project), 4-row services list, about prose, contact CTA, footer with "← back to intro" button that re-locks the curtain
- **Build verified** — production webpack build succeeds cleanly, output served via `python -m http.server` returns 200 for `/`, `/main.js`, `/og-image.png`, and HTML contains all Studio Name placeholders + behind-site sections
- **README.md** at `/app/template/README.md` documenting:
  - Full feature list and file layout
  - Step-by-step quick-start: copy → backend setup → frontend setup
  - One-liner snippets for generating fresh `JWT_SECRET` + `ADMIN_PASSWORD_HASH`
  - Per-client customization checklist (branding via admin panel, behind-site copy edits, SEO/OG, SendGrid)
  - How the curtain-reveal works + where to edit it
  - Full API surface
  - Production checklist

### Phase 7 (May 2026) — Cube outline gradient sync
- The wireframe edges of the cube (drawn via `radialRainbow` in `radial-rainbow.glsl`) used to be **hardcoded** rainbow (blue/green/pink/red/yellow). They now respect the gradient state too:
  - `radial-rainbow.glsl` rewritten to take 5 vec4 colors as parameters
  - `cube/shader.frag` declares 5 new `u_outline_*` uniforms
  - `cube/index.js` feeds them from `gradientState.outline_a..e`
- Each preset in `gradient-state.js` now ships with a matching 5-stop outline derived from its own face palette (`presetWithOutline` helper)
- **Color A / Color B overrides** also propagate into the outline:
  - Color A → `outline_b`, `outline_d`
  - Color B → `outline_a`, `outline_c`
- Result: the cube feels cohesive across faces + edges. Mono White → white/grey edges, Vaporwave → pink/cyan edges, custom green+magenta override → green+magenta edges.
- Verified visually with Ocean, Vaporwave, Mono White, and Acid + green/magenta override presets

### Phase 6 (May 2026) — Cube text spacing + gradient customization + resizable panel
- **Letter spacing slider** (range -0.05 to 0.6 em, default 0.06) — modulates `ctx.letterSpacing` while rendering text-1 / text-2 textures; live-renders 80 ms after each input event
- **Line spacing slider** (range 0.7× to 2.0×, default 1.05×) — multiplies the per-line height in the multi-line auto-fit pass; matters when Shift+Enter wraps the text
- **Cube gradient customization** (1c + 2d):
  - Eight curated **preset packs** in a dropdown: Original (rainbow), Sunset, Ocean, Mono White, Acid, Vaporwave, Noir, Forest
  - Two **brand color overrides** (Color A + Color B) that re-tint gradient2 / gradient3 over any preset; each override has its own picker, hex input, and "×" button to clear back to the preset
  - Implementation: rewrote `gradients.glsl` to take colors as parameters (no more hardcoded constants), added 8 `vec3` uniforms to the content fragment shader fed from a JS `gradientState` module mutated at runtime — zero shader recompiles
  - Apply / preview / publish flow integrated with the existing settings system
- **Resizable admin panel**:
  - Right-edge drag handle (`admin-panel__resizer`) with pulsing accent grip on hover
  - Range: 320 px (min) → 600 px (max)
  - Width persisted to `localStorage` (`jax_admin_panel_width`) so it sticks across sessions
  - Double-click the resizer to reset to the 380 px default
  - Touch support for tablets

### Phase 5 (May 2026) — Font picker + multi-line cube text
- Added a **font picker** to the cube-text section in the admin panel:
  - 8 display faces: Boldonse (default), Bricolage Grotesque, Big Shoulders Display, Archivo Black, Bebas Neue, Anton, Fraunces, Space Grotesk
  - Compact "Aa" preview swatch alongside the dropdown so you can read the face at a glance
  - Selecting a font live-renders both cube text textures + shows status hint until you Publish
  - Family is loaded via `document.fonts.load()` before canvas drawing so text never falls back
  - Backend stores the choice in a new `cube_font` field, validated against the allow-list
- **Multi-line cube text**:
  - Replaced single-line inputs with `<textarea rows="2">` so Shift + Enter inserts a line break naturally
  - `buildTextCanvas` re-written to split on `\n`, auto-fit the largest font size where the widest line stays within 88% of the canvas and the stack height stays within 84%
  - Up to 4 lines per word; max 30 chars (extended from 24)
  - Live re-render on each keystroke (debounced 220 ms) so editing feels instant
  - Verified: textarea correctly captures Shift+Enter as `\n`, Publish saves "OPEN\nSTUDIO" + "BY\nJAX" intact

### Phase 4 (May 2026) — Admin Control Panel
- **Auth**: single shared admin password (bcrypt-hashed in `.env`), HS256 JWT (7-day expiry), in-memory IP brute-force limiter (5 / 15 min)
- **Bottom-left "ADMIN" launcher pill** (with lock icon) → opens password modal → opens floating control panel that slides in from the left
- **Customizable settings** (live preview + publish):
  - Cube logo (PNG/SVG upload, max 4 MB, replaces previous file on disk)
  - Cube text 1 + 2 (replaces "COMING" / "SOON" — rendered to canvas via Boldonse and pushed as live texture)
  - Brand title (top-left) + tagline (bottom-right)
  - Welcome overlay heading + sub-heading
  - Accent color (color picker, hex input, 6 quick swatches)
- **Preview**: applies form values locally without saving
- **Publish**: PUT `/api/admin/settings`, persists for all visitors
- **Reset to defaults**: clears DB doc, deletes uploaded logo file, restores bundled assets in cube
- **Sign out**: clears JWT + closes panel
- Public visitors get the customized settings via `GET /api/settings` on page load (logo_url, texts, colors, overlay copy all applied)
- Texture helper rewritten to expose `.reload(urlOrCanvas)` for hot-swapping GPU textures without page reload
- New logo files normalized to white-on-transparent on the client via offscreen canvas (so any PNG/SVG color works — shaders apply gradient on top)

### Phase 2 (May 2026) — Contact + SEO + Font
- **Contact form**:
  - "Get in Touch" pill button (top-right, with pulsing accent dot)
  - "Start a Project" CTA inside the welcome overlay
  - Modal with Name + Email + Message + honeypot, full validation, success state
  - Backend `POST /api/contact` saves to MongoDB `contact_submissions` collection (id, name, email, message, ip, user_agent, created_at, email_sent flag)
  - SendGrid dual-send via FastAPI BackgroundTasks:
    - Owner notification → jaxstudio.ink@gmail.com (Reply-To = visitor email)
    - Customer auto-reply → "I've received your message and will get back to you within 24 hours" + a copy of their request
  - Honeypot anti-spam (`website` field hidden via positioning)
  - All sends verified returning 202 from SendGrid in logs
- **SEO**:
  - title, description, keywords, theme-color, canonical
  - Open Graph (title, description, url, image, image:width/height/alt)
  - Twitter card (summary_large_image)
  - JSON-LD Organization schema
  - Generated 1200×630 OG image (`og-image.png`) with brand mark + "Coming Soon" + accent
- **Display font**: Google Fonts **Boldonse** (bold geometric brutalist display) for headings + **Archivo** for UI body + **JetBrains Mono** for tech accents (eyebrows, taglines)
- Welcome overlay + contact modal use Boldonse throughout

## File Map
- Frontend
  - `/app/frontend/src/html/index.html` — markup, SEO meta, JSON-LD, contact modal, welcome overlay
  - `/app/frontend/src/static/base.css` — CSS variables, font families, modal styles, ripple keyframes, mobile media queries
  - `/app/frontend/src/static/og-image.png` — 1200×630 branded social card
  - `/app/frontend/src/js/index.js` — pointer/parallax loop + welcome ripple + contact form fetch
  - `/app/frontend/src/js/helpers/{gui,stats}.js` — stubs
  - `/app/frontend/src/assets/{logo,text-1,text-2}.png` — replaced textures (logo = J, text-1 = COMING, text-2 = SOON)
- Backend
  - `/app/backend/server.py` — FastAPI app, ContactRequest model, `/api/contact` route, SendGrid helpers, MongoDB writes
  - `/app/backend/.env` — MONGO_URL, DB_NAME, SENDGRID_API_KEY, SENDER_EMAIL, SENDER_NAME, OWNER_EMAIL
  - `/app/backend/requirements.txt` — added sendgrid==6.12.5

## Verified
- Page returns 200, webpack compiles cleanly
- E2E: filled form → POST /api/contact → 202 SendGrid for both owner + customer (logs confirm 3 successful test submissions)
- Success state visible after submission, form correctly hidden
- Welcome overlay accessible via cube click; "Start a Project" opens contact modal
- Mouse parallax + slow rotation near center working

## Backlog
- **P1** Add analytics later (deferred per user — Plausible or GA4 ready to drop in)
- **P2** Mobile DeviceOrientation parallax (tilt instead of touch)
- **P2** Production build + static serve (currently dev-server)
- **P2** SendGrid event webhook for delivery tracking
- **P2** Admin endpoint to list submissions (auth required)
- **P3** Replace `og-image.png` with a designer-rendered version (current is auto-generated)

## Future / Phase 3
- Sections below hero: featured projects, about, services, FAQ
- CMS or markdown-based portfolio entries
- Migrate to Next.js if SSR/SEO becomes important (current is CSR static)
