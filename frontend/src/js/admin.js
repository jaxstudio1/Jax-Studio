/**
 * Jax Studio — admin control panel
 * Login / settings / live preview & publish.
 *
 * Exposes:
 *   initAdmin({ logoTexture, text1Texture, text2Texture })
 *
 * Settings shape (server-side):
 *   { logo_url, cube_text_1, cube_text_2,
 *     brand_title, brand_tagline,
 *     welcome_heading, welcome_sub,
 *     accent_color }
 * Any null/missing field falls back to the bundled default.
 */

const STORAGE_KEY = 'jax_admin_token'
const DEFAULTS = {
  cube_text_1: 'COMING',
  cube_text_2: 'SOON',
  cube_font: 'Boldonse',
  brand_title: 'Jax Studio',
  brand_tagline: 'Coming Soon',
  welcome_heading: 'Jax Studio',
  welcome_sub: 'Graphic Design · Portfolio & Studio',
  accent_color: '#ff5722',
}

// Display fonts available in the admin font picker. The link tag in index.html
// preloads all of them via Google Fonts so canvas drawing can use them
// after a single document.fonts.load() call below.
const FONT_OPTIONS = [
  { id: 'Boldonse',              weight: 400 },
  { id: 'Bricolage Grotesque',   weight: 800 },
  { id: 'Big Shoulders Display', weight: 900 },
  { id: 'Archivo Black',         weight: 400 },
  { id: 'Bebas Neue',            weight: 400 },
  { id: 'Anton',                 weight: 400 },
  { id: 'Fraunces',              weight: 800 },
  { id: 'Space Grotesk',         weight: 700 },
]

const fontMeta = (family) => FONT_OPTIONS.find((f) => f.id === family) || FONT_OPTIONS[0]

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel)

const apiUrl = (path) => path  // same-origin via ingress

const apiFetch = async (path, options = {}, token = null) => {
  const headers = Object.assign({}, options.headers || {})
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(apiUrl(path), { ...options, headers })
  const ct = res.headers.get('content-type') || ''
  const data = ct.includes('application/json') ? await res.json() : await res.text()
  if (!res.ok) {
    const detail = (data && data.detail) || (typeof data === 'string' ? data : 'Request failed')
    const message = Array.isArray(detail)
      ? detail.map((d) => d && d.msg ? d.msg : JSON.stringify(d)).join(' ')
      : String(detail)
    throw new Error(message)
  }
  return data
}

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => resolve(img)
  img.onerror = (e) => reject(e)
  img.src = src
})

const adjustAccentSoft = (hex) => {
  const h = hex.replace('#', '')
  const v = h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h
  const r = parseInt(v.slice(0, 2), 16)
  const g = parseInt(v.slice(2, 4), 16)
  const b = parseInt(v.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, 0.18)`
}

/**
 * Build a 1024×1024 white-on-transparent canvas from any image URL or data URL.
 * Works for PNGs (any color) and SVGs (any color). The cube shaders apply
 * gradient color on top, so the texture only needs to act as an alpha mask.
 */
const buildLogoCanvas = async (url, size = 1024) => {
  const img = await loadImage(url)
  const w = img.naturalWidth || size
  const h = img.naturalHeight || size
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  // Contain + 85% scale for breathing room
  const scale = Math.min(size / w, size / h) * 0.86
  const drawW = Math.max(1, w * scale)
  const drawH = Math.max(1, h * scale)
  const x = (size - drawW) / 2
  const y = (size - drawH) / 2
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, x, y, drawW, drawH)
  // Force RGB → white wherever alpha > 0
  try {
    const data = ctx.getImageData(0, 0, size, size)
    const arr = data.data
    for (let i = 0; i < arr.length; i += 4) {
      if (arr[i + 3] > 0) {
        arr[i] = 255; arr[i + 1] = 255; arr[i + 2] = 255
      }
    }
    ctx.putImageData(data, 0, 0)
  } catch (err) {
    // Cross-origin canvases can't getImageData. Server-side images are same-origin,
    // so this should never fire; just log if it does.
    // eslint-disable-next-line no-console
    console.warn('Could not recolor logo canvas:', err)
  }
  return canvas
}

/**
 * Ensure a Google Font is available on the canvas before drawing text with it.
 * The <link> tag in index.html preloads the *.css and the woff2 files, but the
 * browser only fetches the actual font binary lazily — so we explicitly call
 * document.fonts.load() to wait for it.
 */
const ensureFontLoaded = async (family, weight = 700) => {
  if (!document.fonts || !document.fonts.load) return
  try {
    // Trigger load at multiple sizes so that any subsequent measureText call
    // doesn't fall back to the system font.
    await document.fonts.load(`${weight} 200px "${family}"`)
    await document.fonts.load(`${weight} 100px "${family}"`)
    await document.fonts.ready
  } catch (_) { /* font may not exist; canvas will fall back gracefully */ }
}

/**
 * Render multi-line text to a 1024×1024 white-on-transparent canvas.
 * Lines are split on \n. Font size is auto-fitted so the widest line stays
 * within ~88% of the canvas and the stack height stays within ~80%.
 */
const buildTextCanvas = (rawText, family = DEFAULTS.cube_font, size = 1024) => {
  const meta = fontMeta(family)
  const text = String(rawText == null ? '' : rawText)
  // Split on newlines, normalize blanks, cap at 4 lines for sanity
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 4)

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (lines.length === 0) return canvas

  const safeW = size * 0.88
  const safeH = size * 0.84
  const lineHeightFactor = 1.05  // Boldonse is heavy; tight line-height reads better
  const fontWeight = meta.weight

  // Auto-fit: pick largest font size where every line fits horizontally and
  // the total stacked height fits vertically.
  let fontSize = 480
  while (fontSize > 60) {
    ctx.font = `${fontWeight} ${fontSize}px "${family}", "Archivo Black", sans-serif`
    const widest = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0)
    const totalH = lines.length * fontSize * lineHeightFactor
    if (widest <= safeW && totalH <= safeH) break
    fontSize -= 16
  }
  ctx.font = `${fontWeight} ${fontSize}px "${family}", "Archivo Black", sans-serif`

  // Vertical centering for the line stack
  const lineH = fontSize * lineHeightFactor
  const stackH = lines.length * lineH
  const startY = (size - stackH) / 2 + lineH / 2
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], size / 2, startY + i * lineH)
  }
  return canvas
}

// ---------- main module ----------
export const initAdmin = ({ logoTexture, text1Texture, text2Texture }) => {
  // ----- DOM refs -----
  const launcher = $('[data-testid="admin-launcher"]')
  const loginModal = $('[data-testid="admin-login-modal"]')
  const loginBackdrop = $('[data-testid="admin-login-backdrop"]')
  const loginCloseBtn = $('[data-testid="admin-login-close"]')
  const loginForm = $('[data-testid="admin-login-form"]')
  const loginInput = $('[data-testid="admin-password"]')
  const loginStatus = $('[data-testid="admin-login-status"]')
  const loginSubmit = $('[data-testid="admin-login-submit"]')

  const panel = $('[data-testid="admin-panel"]')
  const panelClose = $('[data-testid="admin-panel-close"]')
  const inputCubeText1 = $('[data-testid="admin-cube-text-1"]')
  const inputCubeText2 = $('[data-testid="admin-cube-text-2"]')
  const inputCubeFont = $('[data-testid="admin-cube-font"]')
  const fontPreviewEl = $('[data-testid="admin-font-preview"]')
  const inputBrandTitle = $('[data-testid="admin-brand-title"]')
  const inputBrandTagline = $('[data-testid="admin-brand-tagline"]')
  const inputWelcomeHeading = $('[data-testid="admin-welcome-heading"]')
  const inputWelcomeSub = $('[data-testid="admin-welcome-sub"]')
  const inputAccentPicker = $('[data-testid="admin-accent-picker"]')
  const inputAccentHex = $('[data-testid="admin-accent-hex"]')
  const swatches = panel.querySelectorAll('.admin-color__swatch')
  const uploadInput = $('[data-testid="admin-upload-input"]')
  const uploadLabel = $('[data-testid="admin-upload-label"]')
  const uploadTitle = $('[data-testid="admin-upload-title"]')
  const uploadSub = $('[data-testid="admin-upload-sub"]')
  const uploadProgress = $('[data-testid="admin-upload-progress"]')
  const previewBtn = $('[data-testid="admin-preview-btn"]')
  const publishBtn = $('[data-testid="admin-publish-btn"]')
  const resetBtn = $('[data-testid="admin-reset-btn"]')
  const logoutBtn = $('[data-testid="admin-logout-btn"]')
  const panelStatus = $('[data-testid="admin-panel-status"]')

  const brandTitleEl = $('[data-testid="brand-title"]')
  const brandTaglineEl = $('[data-testid="brand-tagline"]')
  const welcomeBrandEl = document.querySelector('.welcome-overlay__brand')
  const welcomeSubEl = document.querySelector('.welcome-overlay__sub')

  // ----- state -----
  let token = (() => {
    try { return localStorage.getItem(STORAGE_KEY) } catch (_) { return null }
  })()
  let published = {}      // last fetched server settings
  let pendingLogoUrl = null  // not yet published

  // ----- UI helpers -----
  const setPanelStatus = (text, kind = '') => {
    panelStatus.textContent = text || ''
    panelStatus.classList.remove('is-error', 'is-success')
    if (kind) panelStatus.classList.add(`is-${kind}`)
  }

  const setLoginStatus = (text) => { loginStatus.textContent = text || '' }

  const openLogin = () => {
    loginModal.classList.add('is-active')
    loginModal.setAttribute('aria-hidden', 'false')
    setLoginStatus('')
    setTimeout(() => loginInput && loginInput.focus(), 250)
  }

  const closeLogin = () => {
    loginModal.classList.remove('is-active')
    loginModal.setAttribute('aria-hidden', 'true')
  }

  const openPanel = () => {
    panel.classList.add('is-active')
    panel.setAttribute('aria-hidden', 'false')
  }
  const closePanel = () => {
    panel.classList.remove('is-active')
    panel.setAttribute('aria-hidden', 'true')
  }

  // ----- apply settings to UI + textures -----
  const applyAccent = (hex) => {
    document.documentElement.style.setProperty('--accent', hex)
    document.documentElement.style.setProperty('--accent-soft', adjustAccentSoft(hex))
    inputAccentPicker.value = hex
    inputAccentHex.value = hex.toUpperCase()
  }

  const applyTextDOM = (s) => {
    brandTitleEl.textContent = s.brand_title || DEFAULTS.brand_title
    brandTaglineEl.textContent = s.brand_tagline || DEFAULTS.brand_tagline
    if (welcomeBrandEl) {
      // welcome heading + the orange "!" span (preserved markup)
      welcomeBrandEl.innerHTML = `${s.welcome_heading || DEFAULTS.welcome_heading}<span class="welcome-overlay__bang">!</span>`
    }
    if (welcomeSubEl) {
      welcomeSubEl.textContent = s.welcome_sub || DEFAULTS.welcome_sub
    }
  }

  const applyCubeTextures = async (s) => {
    // Cube text labels — multi-line aware
    const family = s.cube_font || DEFAULTS.cube_font
    await ensureFontLoaded(family, fontMeta(family).weight)
    const t1 = (s.cube_text_1 || '').trim()
    const t2 = (s.cube_text_2 || '').trim()
    if (t1) {
      try { text1Texture.reload(buildTextCanvas(t1.toUpperCase(), family)) } catch (e) { /* */ }
    }
    if (t2) {
      try { text2Texture.reload(buildTextCanvas(t2.toUpperCase(), family)) } catch (e) { /* */ }
    }
    // If only the font changed (no custom text yet), still re-render the
    // bundled defaults with the new face so the preview reflects the choice.
    if (!t1 && s.cube_font) {
      try { text1Texture.reload(buildTextCanvas(DEFAULTS.cube_text_1, family)) } catch (e) { /* */ }
    }
    if (!t2 && s.cube_font) {
      try { text2Texture.reload(buildTextCanvas(DEFAULTS.cube_text_2, family)) } catch (e) { /* */ }
    }
    // Logo
    if (s.logo_url) {
      try {
        const canvas = await buildLogoCanvas(s.logo_url)
        logoTexture.reload(canvas)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Logo apply failed', err)
      }
    }
  }

  const applySettings = async (s) => {
    applyAccent(s.accent_color || DEFAULTS.accent_color)
    applyTextDOM(s)
    await applyCubeTextures(s)
  }

  const fillFormFromSettings = (s) => {
    inputCubeText1.value = s.cube_text_1 || ''
    inputCubeText2.value = s.cube_text_2 || ''
    inputCubeFont.value = s.cube_font || DEFAULTS.cube_font
    if (fontPreviewEl) {
      fontPreviewEl.style.fontFamily = `"${inputCubeFont.value}", sans-serif`
      fontPreviewEl.style.fontWeight = String(fontMeta(inputCubeFont.value).weight)
    }
    inputBrandTitle.value = s.brand_title || ''
    inputBrandTagline.value = s.brand_tagline || ''
    inputWelcomeHeading.value = s.welcome_heading || ''
    inputWelcomeSub.value = s.welcome_sub || ''
    const accent = s.accent_color || DEFAULTS.accent_color
    inputAccentPicker.value = accent
    inputAccentHex.value = accent.toUpperCase()
    if (s.logo_url) {
      uploadLabel.classList.add('is-uploaded')
      uploadTitle.textContent = 'Custom logo set'
      uploadSub.textContent = 'Click to replace'
    } else {
      uploadLabel.classList.remove('is-uploaded')
      uploadTitle.textContent = 'Click to upload'
      uploadSub.textContent = 'Replaces previous file on the server'
    }
  }

  const collectFormSettings = () => ({
    cube_text_1: inputCubeText1.value.trim() || null,
    cube_text_2: inputCubeText2.value.trim() || null,
    cube_font: inputCubeFont.value || null,
    brand_title: inputBrandTitle.value.trim() || null,
    brand_tagline: inputBrandTagline.value.trim() || null,
    welcome_heading: inputWelcomeHeading.value.trim() || null,
    welcome_sub: inputWelcomeSub.value.trim() || null,
    accent_color: inputAccentHex.value.trim() || null,
    logo_url: pendingLogoUrl || published.logo_url || null,
  })

  // ----- token / session -----
  const setToken = (t) => {
    token = t
    try {
      if (t) localStorage.setItem(STORAGE_KEY, t)
      else localStorage.removeItem(STORAGE_KEY)
    } catch (_) { /* */ }
    launcher.classList.toggle('is-authed', !!t)
  }

  const verifyToken = async () => {
    if (!token) return false
    try {
      await apiFetch('/api/admin/me', {}, token)
      return true
    } catch (_) {
      setToken(null)
      return false
    }
  }

  // ----- public bootstrap (load published settings on page load) -----
  const bootstrapPublic = async () => {
    try {
      const s = await apiFetch('/api/settings')
      published = s || {}
      await applySettings(published)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Failed to load public settings', err)
    }
  }

  // ----- handlers -----
  launcher.addEventListener('click', async () => {
    const ok = await verifyToken()
    if (ok) {
      fillFormFromSettings(published)
      openPanel()
    } else {
      openLogin()
    }
  })

  loginCloseBtn.addEventListener('click', closeLogin)
  loginBackdrop.addEventListener('click', closeLogin)

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    setLoginStatus('')
    const password = loginInput.value
    if (!password) { setLoginStatus('Enter your password.'); return }
    loginSubmit.disabled = true
    try {
      const data = await apiFetch('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setToken(data.token)
      loginInput.value = ''
      closeLogin()
      // Load fresh server-side state into the panel
      try {
        const s = await apiFetch('/api/admin/settings', {}, token)
        published = s
        fillFormFromSettings(published)
        await applySettings(published)
      } catch (_) { fillFormFromSettings(published) }
      openPanel()
    } catch (err) {
      setLoginStatus(err.message || 'Login failed')
    } finally {
      loginSubmit.disabled = false
    }
  })

  panelClose.addEventListener('click', closePanel)

  // Font picker — update preview swatch + live-render the cube text
  inputCubeFont.addEventListener('change', async () => {
    const family = inputCubeFont.value
    if (fontPreviewEl) {
      fontPreviewEl.style.fontFamily = `"${family}", sans-serif`
      fontPreviewEl.style.fontWeight = String(fontMeta(family).weight)
    }
    await ensureFontLoaded(family, fontMeta(family).weight)
    const t1 = inputCubeText1.value.trim() || DEFAULTS.cube_text_1
    const t2 = inputCubeText2.value.trim() || DEFAULTS.cube_text_2
    try { text1Texture.reload(buildTextCanvas(t1.toUpperCase(), family)) } catch (_) { /* */ }
    try { text2Texture.reload(buildTextCanvas(t2.toUpperCase(), family)) } catch (_) { /* */ }
    setPanelStatus(`Font: ${family} · click Publish to save.`, 'success')
  })

  // Live-render cube text on each keystroke (so Shift+Enter feels instant)
  const liveRenderCubeText = (() => {
    let t = null
    return () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        const family = inputCubeFont.value || DEFAULTS.cube_font
        const t1 = inputCubeText1.value.trim() || DEFAULTS.cube_text_1
        const t2 = inputCubeText2.value.trim() || DEFAULTS.cube_text_2
        try { text1Texture.reload(buildTextCanvas(t1.toUpperCase(), family)) } catch (_) { /* */ }
        try { text2Texture.reload(buildTextCanvas(t2.toUpperCase(), family)) } catch (_) { /* */ }
      }, 220)
    }
  })()
  inputCubeText1.addEventListener('input', liveRenderCubeText)
  inputCubeText2.addEventListener('input', liveRenderCubeText)

  // accent picker sync
  inputAccentPicker.addEventListener('input', (e) => {
    const v = e.target.value
    inputAccentHex.value = v.toUpperCase()
    applyAccent(v)
  })
  inputAccentHex.addEventListener('input', (e) => {
    const v = (e.target.value || '').trim()
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
      inputAccentPicker.value = v
      applyAccent(v)
    }
  })
  swatches.forEach((sw) => {
    sw.addEventListener('click', () => {
      const c = sw.getAttribute('data-color')
      inputAccentPicker.value = c
      inputAccentHex.value = c.toUpperCase()
      applyAccent(c)
    })
  })

  // Upload
  uploadInput.addEventListener('change', async () => {
    const file = uploadInput.files && uploadInput.files[0]
    if (!file) return
    if (file.size > 4 * 1024 * 1024) {
      setPanelStatus('Logo too large (max 4 MB).', 'error')
      uploadInput.value = ''
      return
    }
    uploadProgress.hidden = false
    uploadProgress.textContent = `Uploading ${file.name}…`
    setPanelStatus('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const data = await apiFetch('/api/admin/upload/logo', { method: 'POST', body: fd }, token)
      pendingLogoUrl = data.logo_url
      // Apply immediately as a live preview
      const canvas = await buildLogoCanvas(pendingLogoUrl)
      logoTexture.reload(canvas)
      uploadLabel.classList.add('is-uploaded')
      uploadTitle.textContent = 'Custom logo set'
      uploadSub.textContent = 'Click to replace'
      uploadProgress.textContent = `Uploaded ${(data.size / 1024).toFixed(1)} KB`
      setPanelStatus('Logo applied (already saved · publish to update visitors).', 'success')
      // The upload route already persists logo_url server-side, so clearing the
      // pending pointer is fine — we keep it set just to highlight that the
      // panel state has uncommitted text/color edits.
    } catch (err) {
      setPanelStatus(err.message || 'Upload failed', 'error')
      uploadProgress.textContent = ''
    } finally {
      uploadInput.value = ''
      setTimeout(() => { uploadProgress.hidden = true }, 1800)
    }
  })

  // Preview button — apply current form values locally without saving
  previewBtn.addEventListener('click', async () => {
    setPanelStatus('Previewing…')
    const s = collectFormSettings()
    await applySettings(s)
    setPanelStatus('Preview applied · click Publish to save.', 'success')
  })

  publishBtn.addEventListener('click', async () => {
    setPanelStatus('Publishing…')
    publishBtn.disabled = true
    const s = collectFormSettings()
    try {
      const saved = await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(s),
      }, token)
      published = saved
      pendingLogoUrl = null
      await applySettings(saved)
      setPanelStatus('Published — visitors will see this now.', 'success')
    } catch (err) {
      setPanelStatus(err.message || 'Publish failed', 'error')
    } finally {
      publishBtn.disabled = false
    }
  })

  resetBtn.addEventListener('click', async () => {
    if (!window.confirm('Reset all settings to defaults? This deletes your uploaded logo.')) return
    setPanelStatus('Resetting…')
    try {
      const saved = await apiFetch('/api/admin/settings/reset', { method: 'POST' }, token)
      published = saved
      pendingLogoUrl = null
      // Reload bundled defaults for cube logo + texts
      try { logoTexture.reload(require('~assets/logo.png').default || require('~assets/logo.png')) } catch (_) { /* */ }
      try { text1Texture.reload(require('~assets/text-1.png').default || require('~assets/text-1.png')) } catch (_) { /* */ }
      try { text2Texture.reload(require('~assets/text-2.png').default || require('~assets/text-2.png')) } catch (_) { /* */ }
      fillFormFromSettings(saved)
      await applySettings(saved)
      setPanelStatus('All settings reset to defaults.', 'success')
    } catch (err) {
      setPanelStatus(err.message || 'Reset failed', 'error')
    }
  })

  logoutBtn.addEventListener('click', async () => {
    try { await apiFetch('/api/admin/logout', { method: 'POST' }, token) } catch (_) { /* */ }
    setToken(null)
    closePanel()
    setPanelStatus('')
  })

  // Esc closes
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (loginModal.classList.contains('is-active')) closeLogin()
    else if (panel.classList.contains('is-active')) closePanel()
  })

  // Initial state — visit launcher pill & load public settings
  bootstrapPublic()
  if (token) {
    verifyToken().then((ok) => { if (!ok) setToken(null) })
  }
}
