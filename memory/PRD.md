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
