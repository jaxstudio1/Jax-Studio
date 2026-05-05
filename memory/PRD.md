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
