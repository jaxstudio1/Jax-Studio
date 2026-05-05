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
  brand_title: 'Jax Studio',
  brand_tagline: 'Coming Soon',
  welcome_heading: 'Jax Studio',
  welcome_sub: 'Graphic Design · Portfolio & Studio',
  accent_color: '#ff5722',
}

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
 * Render a piece of text to a 1024×1024 white-on-transparent canvas using the
 * Boldonse display face (already loaded for the welcome screen). Letter
 * spacing is widened to read clearly inside the cube.
 */
const buildTextCanvas = (text, size = 1024) => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Try increasingly smaller sizes until the text fits the safe area (90% wide)
  const safe = size * 0.9
  const tryFonts = ['Boldonse', 'Archivo Black', 'Arial Black', 'sans-serif']
  for (let f of tryFonts) {
    let fontSize = 360
    while (fontSize > 60) {
      ctx.font = `${fontSize}px "${f}", sans-serif`
      const w = ctx.measureText(text).width
      if (w <= safe) break
      fontSize -= 20
    }
    // Use the first font that didn't bottom out
    ctx.font = `${fontSize}px "${f}", sans-serif`
    if (ctx.measureText(text).width <= safe) {
      ctx.fillText(text, size / 2, size / 2)
      return canvas
    }
  }
  // Fallback — draw whatever we got
  ctx.fillText(text, size / 2, size / 2)
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
    // Cube text labels
    const t1 = (s.cube_text_1 || '').trim()
    const t2 = (s.cube_text_2 || '').trim()
    if (t1) {
      try { text1Texture.reload(buildTextCanvas(t1.toUpperCase())) } catch (e) { /* */ }
    }
    if (t2) {
      try { text2Texture.reload(buildTextCanvas(t2.toUpperCase())) } catch (e) { /* */ }
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
