/**
 * Custom static server that:
 *   1. For "/" and "/index.html" — reads dist/index.html, fetches the latest
 *      published settings from the backend, and injects them as
 *      `window.__INITIAL_SETTINGS__` into the HTML BEFORE sending. This way
 *      EVERY visitor (including first-time on a new device) sees the
 *      currently published values from the very first paint — no flash of
 *      bundled defaults.
 *   2. Everything else — serves files from /app/frontend/dist as static.
 *
 * Run via: node serve.js  (port 3000)
 */
const path = require('path')
const fs = require('fs')
const express = require('express')

const PORT = parseInt(process.env.PORT || '3000', 10)
const DIST = path.join(__dirname, 'dist')
const INDEX_PATH = path.join(DIST, 'index.html')

// Backend on the SAME pod, default 8001. Override with BACKEND_INTERNAL_URL.
const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:8001'

const app = express()

// Read index.html once at boot — re-read on every request so admin Publish
// changes are reflected instantly without restarting this server.
const readIndexHtml = () => {
  return fs.readFileSync(INDEX_PATH, 'utf8')
}

const fetchSettings = async () => {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1500) // hard cap so we never block paint
    const res = await fetch(`${BACKEND_URL}/api/settings`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    return null
  }
}

const injectInitialSettings = (html, settings) => {
  if (!settings) return html
  // Defensively escape `</script>` to avoid breaking out of the script tag.
  const json = JSON.stringify(settings).replace(/<\/script>/gi, '<\\/script>')
  const tag = `<script>window.__INITIAL_SETTINGS__=${json};</script>`
  // Insert just before </head> so it runs BEFORE the inline hydration script
  // that already lives in <head> (the hydration script will prefer
  // window.__INITIAL_SETTINGS__ over localStorage when both exist).
  return html.replace('</head>', `  ${tag}\n  </head>`)
}

const serveIndex = async (req, res) => {
  let html
  try { html = readIndexHtml() }
  catch (e) {
    res.status(500).send('Could not load index.html')
    return
  }
  const settings = await fetchSettings()
  const out = injectInitialSettings(html, settings)
  res.set('Content-Type', 'text/html; charset=utf-8')
  // Don't cache the HTML so admin Publish takes effect on next page load
  res.set('Cache-Control', 'no-store, must-revalidate')
  res.send(out)
}

app.get('/', serveIndex)
app.get('/index.html', serveIndex)

// Static for everything else (JS bundles, assets, etc.). cache headers OK
// since webpack hashes filenames.
app.use(express.static(DIST, {
  index: false,            // we handle "/" ourselves
  fallthrough: true,
  maxAge: '1h',
}))

// SPA-style fallback (for hash routes like /#about) — also inject settings
app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  // Don't catch obvious asset requests
  if (/\.[a-zA-Z0-9]{1,5}$/.test(req.path)) return next()
  serveIndex(req, res)
})

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`Jax Studio frontend (with settings injection) listening on :${PORT}`)
  // eslint-disable-next-line no-console
  console.log(`Backend: ${BACKEND_URL}`)
})
