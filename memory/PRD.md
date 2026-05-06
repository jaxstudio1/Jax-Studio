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

### Phase 1 (May 2026)
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
