# Jax Studio — Coming Soon Landing Page

## Original Problem Statement
> "I want to use this as my landing page. https://github.com/lorenzocadamuro/apple-fifth-avenue what can I customize on this?"

User chose to customize the Apple Fifth Avenue WebGL cube demo into a "Coming Soon" landing page for their Graphic Design business / portfolio called **Jax Studio**.

## Architecture
- **Stack**: Vanilla JS + WebGL (regl) + GLSL shaders + webpack 4 + dat.gui (disabled)
- **Source repo**: https://github.com/lorenzocadamuro/apple-fifth-avenue (cloned, customized)
- **Old React frontend**: backed up at `/app/frontend_bak_react`, no longer served
- **Service**: `yarn start` → `webpack-dev-server` on `0.0.0.0:3000`, supervisor-managed
- **Backend**: still FastAPI, untouched (currently unused by landing page)

## User's Requirements
- Logo inside cube → user-provided "J" SVG (decoded from PNG b64, padded onto 1024×1024 canvas) ✅
- "Made in WebGL" → "Jax Studio" brand label (top-left) ✅
- "Apple Fifth Avenue" → "Coming Soon" tagline (bottom-right) ✅
- Layout similar to apple-fifth-avenue demo, no debug/controls panel ✅
- Click cube → ripple wave → "Welcome to Jax Studio!" overlay ✅
- Mouse parallax sensitivity + auto-rotation slows when cursor approaches center ✅
- Mobile/touch parity (closer to center = slower) ✅
- Cube glass/shaders/background untouched ✅

## What's Implemented (May 2026)
- Replaced /app/frontend with the WebGL repo, removed unused deps (node-sass, sass-loader, eslint configs, prettier-eslint)
- Updated package.json `start` to webpack-dev-server on port 3000 with `--disable-host-check` for Kubernetes preview routing
- New `index.html` with brand corners, hint text, and welcome overlay (with Back button)
- New `base.css` with full-bleed cube layout, Inter font stack, ripple keyframes, mobile media queries
- Stubbed `helpers/gui.js` and `helpers/stats.js` so dat.gui controls + stats panel never render
- Rewrote `js/index.js`:
  - Pointer state (mouse + touch) drives smoothed parallax
  - Speed multiplier (1.0 → 0.22) based on `(1 - distFromCenter) * active`
  - Manual phase accumulator so velocity changes don't cause rotation jumps
  - Click / tap on stage → positions ripple at click point → triggers `is-active` overlay class
  - Esc key + Back button dismiss overlay
- Replaced texture assets:
  - `logo.png` (1024×1024, white "J" mark on transparent, derived from user's PNG)
  - `text-1.png` → "COMING" (Liberation Sans Bold, white)
  - `text-2.png` → "SOON" (Liberation Sans Bold, white)

## File Map
- `/app/frontend/src/html/index.html` — markup (frame, cube stage, welcome overlay, hint)
- `/app/frontend/src/static/base.css` — global styles + ripple animation + responsive
- `/app/frontend/src/js/index.js` — main entry: pointer logic, click overlay, animation loop
- `/app/frontend/src/js/helpers/gui.js` — stub (no controls)
- `/app/frontend/src/js/helpers/stats.js` — stub (no fps panel)
- `/app/frontend/src/assets/{logo,text-1,text-2}.png` — replaced textures

## Verified
- Page returns HTTP 200, webpack compiles cleanly
- Screenshot 1: Cube rotating with rainbow J / S textures, "JAX STUDIO" + "COMING SOON" + "CLICK THE CUBE" hint visible
- Screenshot 2: After click, overlay shows "Welcome to Jax Studio!" with orange "!" accent + "Graphic Design Portfolio" subtitle + Back button

## Backlog / Next Action Items (P1 → P2)
- **P1** Email waitlist capture form (Resend/SendGrid + MongoDB)
- **P1** Custom font swap (e.g., a graphic-design-y display face) — currently Inter/system stack
- **P2** Mobile auto-tilt via `DeviceOrientation` for parallax without touch
- **P2** SEO: og:image render, sitemap.xml, robots.txt
- **P2** Analytics (Plausible/GA4)
- **P2** Cube color/glass tint customization (later, per user's request to keep as-is)
- **P2** Build + serve via static `serve` for production (currently dev-server only)

## Future / Phase 2
- Sections below hero: featured projects, about, contact form
- Migrate to Next.js or React+Vite if SSR/SEO becomes important
- WebGL fallback image for very old browsers / no-WebGL devices
