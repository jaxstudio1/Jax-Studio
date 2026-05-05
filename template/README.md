# WebGL Cube Coming-Soon Template

A reusable, fully-customizable "coming soon" landing page built around the Apple-Fifth-Avenue WebGL glass cube. Click the cube to lift the curtain and reveal the actual website behind.

> Forked from [`lorenzocadamuro/apple-fifth-avenue`](https://github.com/lorenzocadamuro/apple-fifth-avenue) and extended into a full template (admin panel, contact form, gradient customization, mobile tilt/shake, and a hidden site behind the curtain).

---

## What's in here

```
template/
├── frontend/             # webpack 4 + vanilla JS + GLSL
│   └── src/
│       ├── html/index.html        # markup: curtain + behind-site + modals
│       ├── static/base.css        # all styles
│       ├── static/og-image.png    # 1200×630 social card (regenerated per project)
│       ├── assets/                # logo.png, text-1.png, text-2.png (cube textures)
│       ├── glsl/                  # gradient + radial-rainbow shaders
│       └── js/
│           ├── index.js           # main entry, parallax, tilt, shake, curtain reveal
│           ├── admin.js           # login + control panel + live texture swap
│           ├── gradient-state.js  # mutable gradient state + 8 presets
│           ├── components/cube,content,reflection
│           └── helpers/Texture.js, stats.js, gui.js
└── backend/              # FastAPI + Motor (MongoDB) + SendGrid
    ├── server.py                  # admin auth + settings CRUD + contact form + logo upload
    ├── requirements.txt
    ├── .env                       # PLACEHOLDERS — fill in for production
    └── uploads/                   # admin-uploaded logos (one at a time)
```

## Features (out of the box)

- **WebGL cube** — three logo faces (rainbow / gradient2 / gradient3 tints), two text faces ("COMING" / "SOON"), reflective glass shaders, auto-rotation
- **Click cube → reveal behind-curtain site** — placeholder hero, work grid (6 cards), services list, about, contact CTA, footer with "back to intro" button
- **Mouse parallax + slow-down near center** (desktop)
- **Mobile tilt parallax** (`deviceorientation`) + **shake-to-spin** (`devicemotion`) with iOS 13+ permission prompt on first tap
- **Contact form** → POST `/api/contact` → MongoDB write + SendGrid dual-email (owner notification + visitor auto-reply)
- **Admin control panel** behind a single-password gate (bottom-left "ADMIN" pill):
  - Cube logo upload (PNG/SVG, max 4 MB, replaces previous file on disk)
  - Cube text — multi-line via Shift + Enter, max 30 chars per word
  - 8 display fonts (Boldonse, Bricolage Grotesque, Big Shoulders Display, Archivo Black, Bebas Neue, Anton, Fraunces, Space Grotesk)
  - Letter-spacing slider (-0.05 → 0.6 em)
  - Line-spacing slider (0.7 → 2.0×)
  - Gradient: 8 presets (Original, Sunset, Ocean, Mono White, Acid, Vaporwave, Noir, Forest) + two-color overrides (re-tint the faces *and* the wireframe outline)
  - Brand title + tagline
  - Accent color (picker + hex + 6 quick swatches)
  - Resizable panel (320 → 600 px, drag right edge, persisted in localStorage; double-click to reset)
- **Preview / Publish** flow (preview applies locally; publish writes to DB and broadcasts to all visitors)
- **Reset to defaults** clears DB doc + deletes any uploaded logo
- **SEO** — full meta tags, Open Graph, Twitter card, JSON-LD Organization schema

---

## Quick start (clone for a new project)

```bash
# 1. Copy the template into your new project location
cp -r /app/template /path/to/new-client-site
cd /path/to/new-client-site

# 2. Backend setup
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Generate fresh secrets (write to .env)
python3 -c "import secrets; print('JWT_SECRET=\"' + secrets.token_hex(32) + '\"')"
python3 -c "import bcrypt; print('ADMIN_PASSWORD_HASH=\"' + bcrypt.hashpw(b'YOUR_ADMIN_PASSWORD', bcrypt.gensalt()).decode() + '\"')"

# Edit .env and set:
#   MONGO_URL, DB_NAME              — your MongoDB
#   SENDGRID_API_KEY                — your SendGrid API key
#   SENDER_EMAIL, SENDER_NAME       — verified sender on your domain
#   OWNER_EMAIL                     — where contact-form notifications land
#   JWT_SECRET                      — paste the generated value
#   ADMIN_PASSWORD_HASH             — paste the generated bcrypt hash
#   UPLOAD_DIR                      — absolute path for logo uploads

# Start the backend
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# 3. Frontend setup (separate terminal)
cd ../frontend
yarn install
yarn start          # webpack-dev-server on :3000
# OR
yarn build          # produces /dist for static hosting
```

The frontend talks to `/api/*` on the same origin. In a Kubernetes setup, route `/api/*` to the backend; in dev, the bundled webpack-dev-server proxy/CORS already accepts everything.

---

## Default admin credentials (change before going live!)

- **Password**: `template2026`
- The bcrypt hash in `backend/.env` is for that password. Replace it before deploying to production using the bcrypt one-liner above.

---

## What to customize per client (in this order)

### 1. Branding (immediate, in the admin panel)
1. Sign in with the admin password
2. Upload the client's logo (PNG / SVG)
3. Set Brand title + tagline
4. Pick a gradient preset and (optionally) two brand colors
5. Set accent color
6. Pick a display font + spacing
7. Click **Publish**

### 2. Hidden site behind the curtain (code edits)
The placeholder content lives in `frontend/src/html/index.html` inside `<main class="site">`. Replace:
- `.site-hero` — headline, lede, CTAs
- `.work-grid` — 6 placeholder `.work-card` divs (replace per project: real names, real gradient colors via `style="--c1:...; --c2:...;"`, link to case studies)
- `.services` — 4 placeholder `.service` rows
- `.site-section--about` — about copy
- `.site-footer` — brand name + year

### 3. SEO + OG image (per-client)
- Edit `<title>`, `<meta name="description">`, all `og:*` and `twitter:*` tags in `index.html`
- Replace `frontend/src/static/og-image.png` with a designer-rendered 1200×630 social card
- Update the JSON-LD Organization block

### 4. SendGrid (one-time)
Sender domain must be verified in SendGrid before emails will deliver. Update `SENDER_EMAIL`, `SENDER_NAME`, `OWNER_EMAIL` in `.env`.

---

## How "click cube → reveal site" works

The landing curtain (`.landing-curtain`) is `position: fixed; z-index: 60` and covers the viewport. The actual site (`<main class="site">`) sits below it in normal document flow. On `body.is-locked` (default), scrolling is disabled.

When the visitor clicks the cube:
1. `revealSite()` adds `.is-revealed` to the curtain
2. Curtain fades out, scales up 1.08×, blurs 6px
3. After ~80 ms, `body.is-locked` is removed → scroll unlocks
4. Visitor explores the site below

The "← back to intro" button in the footer calls `restoreCurtain()` to return the curtain (re-locks scroll).

To change the click action to something else (open contact, navigate to URL, cycle gradient, etc.), edit the `revealSite()` call in `frontend/src/js/index.js` (search for "click cube → reveal").

---

## API surface

### Public
- `GET  /api/`                 — health check
- `GET  /api/settings`         — current published settings (driven into the cube on page load)
- `POST /api/contact`          — body `{ name, email, message, website }` (`website` is the honeypot, must be empty)

### Admin (Bearer token required, except login)
- `POST /api/admin/login`            — body `{ password }`, returns `{ token, expires_in, role }`
- `POST /api/admin/logout`
- `GET  /api/admin/me`
- `GET  /api/admin/settings`
- `PUT  /api/admin/settings`         — partial update of any field
- `POST /api/admin/settings/reset`   — clears the doc + deletes uploaded logo
- `POST /api/admin/upload/logo`      — multipart `file` field, PNG/SVG, ≤4 MB, replaces previous file

### Files
- Logo files served via `GET /api/uploads/<filename>` (FastAPI StaticFiles mount).

---

## Things to consider before production

- [ ] Change `ADMIN_PASSWORD_HASH` from the `template2026` default
- [ ] Set a real `JWT_SECRET` (64 hex chars from `secrets.token_hex(32)`)
- [ ] Verify your sender domain in SendGrid
- [ ] Replace `template.test` with your real canonical URL in `index.html` (canonical, og:url, JSON-LD)
- [ ] Drop in a designer-rendered `og-image.png`
- [ ] (Optional) Tighten `CORS_ORIGINS` in `.env` to your deployed domain only
- [ ] (Optional) Wire analytics (Plausible / GA4) via a `<script>` tag in `index.html`

---

## Credits

- **Original WebGL demo**: [Lorenzo Cadamuro — apple-fifth-avenue](https://github.com/lorenzocadamuro/apple-fifth-avenue)
- **Tutorial it accompanies**: [Codrops — apple-fifth-avenue](https://tympanus.net/Tutorials/apple-fifth-avenue/)
- **Display fonts**: Google Fonts — Boldonse, Bricolage Grotesque, Big Shoulders Display, Archivo Black, Bebas Neue, Anton, Fraunces, Space Grotesk

License: ISC for the template additions; see the original repo for the cube's underlying license.
