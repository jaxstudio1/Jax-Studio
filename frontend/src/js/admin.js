/**
 * Jax Studio — admin control panel
 * Login / settings / live preview & publish.
 */

import {
  setGradientState,
  resetGradientState,
  composeGradient,
  GRADIENT_PRESETS,
} from '~js/gradient-state'

const STORAGE_KEY = 'jax_admin_token'
const PANEL_WIDTH_KEY = 'jax_admin_panel_width'
const PANEL_PAGE_KEY = 'jax_admin_panel_page'
const INBOX_COLLAPSED_KEY = 'jax_admin_inbox_collapsed'
const DEFAULTS = {
  cube_text_1: 'COMING',
  cube_text_2: 'SOON',
  cube_font: 'Boldonse',
  cube_letter_spacing: 0.06,
  cube_line_spacing: 1.05,
  gradient_preset: 'default',
  gradient_color_a: null,
  gradient_color_b: null,
  brand_title: 'Jax Studio',
  brand_tagline: 'Coming Soon',
  welcome_heading: 'Jax Studio',
  welcome_sub: 'Graphic Design · Portfolio & Studio',
  welcome_letter_spacing: -0.02,
  welcome_line_spacing: 0.95,
  accent_color: '#ff5722',
  ripple_speed: 1.8,
  ripple_tint: 20,
  ripple_ring_count: 4,
  welcome_letter_effect: '',
  welcome_letter_speed: 1.0,
  welcome_letter_stagger: 0,
  welcome_letter_density: 'normal',
  welcome_letter_shapes: 'mix',
  welcome_letter_fill: true,
  welcome_letter_use_accent: false,
  welcome_letter_apply_to: 'heading',
  swipe_threshold: 36,
  wheel_threshold: 12,
}

const PANEL_WIDTH_MIN = 320
const PANEL_WIDTH_MAX = 600
const PANEL_WIDTH_DEFAULT = 380

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
const buildTextCanvas = (rawText, family = DEFAULTS.cube_font, opts = {}, size = 1024) => {
  const meta = fontMeta(family)
  const text = String(rawText == null ? '' : rawText)
  const letterSpacingEm = typeof opts.letterSpacing === 'number' ? opts.letterSpacing : DEFAULTS.cube_letter_spacing
  const lineHeightFactor = typeof opts.lineSpacing === 'number' ? opts.lineSpacing : DEFAULTS.cube_line_spacing

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
  const fontWeight = meta.weight

  // Auto-fit
  let fontSize = 480
  while (fontSize > 60) {
    ctx.font = `${fontWeight} ${fontSize}px "${family}", "Archivo Black", sans-serif`
    if ('letterSpacing' in ctx) {
      try { ctx.letterSpacing = `${(letterSpacingEm * fontSize).toFixed(2)}px` } catch (_) { /* */ }
    }
    const widest = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0)
    const totalH = lines.length * fontSize * lineHeightFactor
    if (widest <= safeW && totalH <= safeH) break
    fontSize -= 16
  }
  ctx.font = `${fontWeight} ${fontSize}px "${family}", "Archivo Black", sans-serif`
  if ('letterSpacing' in ctx) {
    try { ctx.letterSpacing = `${(letterSpacingEm * fontSize).toFixed(2)}px` } catch (_) { /* */ }
  }

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
  const panelResizer = $('[data-testid="admin-panel-resizer"]')
  const inputCubeText1 = $('[data-testid="admin-cube-text-1"]')
  const inputCubeText2 = $('[data-testid="admin-cube-text-2"]')
  const inputCubeFont = $('[data-testid="admin-cube-font"]')
  const fontPreviewEl = $('[data-testid="admin-font-preview"]')
  const inputLetterSpacing = $('[data-testid="admin-letter-spacing"]')
  const labelLetterSpacing = $('[data-testid="admin-letter-spacing-value"]')
  const inputLineSpacing = $('[data-testid="admin-line-spacing"]')
  const labelLineSpacing = $('[data-testid="admin-line-spacing-value"]')
  const inputGradientPreset = $('[data-testid="admin-gradient-preset"]')
  const inputGradColorA = $('[data-testid="admin-gradient-color-a"]')
  const inputGradColorAHex = $('[data-testid="admin-gradient-color-a-hex"]')
  const btnGradColorAClear = $('[data-testid="admin-gradient-color-a-clear"]')
  const inputGradColorB = $('[data-testid="admin-gradient-color-b"]')
  const inputGradColorBHex = $('[data-testid="admin-gradient-color-b-hex"]')
  const btnGradColorBClear = $('[data-testid="admin-gradient-color-b-clear"]')
  const inputBrandTitle = $('[data-testid="admin-brand-title"]')
  const inputBrandTagline = $('[data-testid="admin-brand-tagline"]')
  const inputWelcomeHeading = $('[data-testid="admin-welcome-heading"]')
  const inputWelcomeSub = $('[data-testid="admin-welcome-sub"]')
  const inputWelcomeLetterSpacing = $('[data-testid="admin-welcome-letter-spacing"]')
  const labelWelcomeLetterSpacing = $('[data-testid="admin-welcome-letter-spacing-value"]')
  const inputWelcomeLineSpacing = $('[data-testid="admin-welcome-line-spacing"]')
  const labelWelcomeLineSpacing = $('[data-testid="admin-welcome-line-spacing-value"]')
  const inputRippleSpeed = $('[data-testid="admin-ripple-speed"]')
  const labelRippleSpeed = $('[data-testid="admin-ripple-speed-value"]')
  const inputRippleTint = $('[data-testid="admin-ripple-tint"]')
  const labelRippleTint = $('[data-testid="admin-ripple-tint-value"]')
  const inputRippleRings = $('[data-testid="admin-ripple-rings"]')
  const rippleEl = document.querySelector('.welcome-overlay__ripple')

  // Letter FX refs (page 2 — decorative letter animation)
  const inputLetterEffect = $('[data-testid="admin-letter-effect"]')
  const inputLetterSpeed = $('[data-testid="admin-letter-speed"]')
  const labelLetterSpeed = $('[data-testid="admin-letter-speed-value"]')
  const inputLetterStagger = $('[data-testid="admin-letter-stagger"]')
  const labelLetterStagger = $('[data-testid="admin-letter-stagger-value"]')
  const inputLetterDensity = $('[data-testid="admin-letter-density"]')
  const inputLetterShapes = $('[data-testid="admin-letter-shapes"]')
  const inputLetterFill = $('[data-testid="admin-letter-fill"]')
  const inputLetterUseAccent = $('[data-testid="admin-letter-use-accent"]')
  const inputLetterApplyTo = $('[data-testid="admin-letter-apply-to"]')
  const inputSwipeThreshold = $('[data-testid="admin-swipe-threshold"]')
  const labelSwipeThreshold = $('[data-testid="admin-swipe-threshold-value"]')
  const inputWheelThreshold = $('[data-testid="admin-wheel-threshold"]')
  const labelWheelThreshold = $('[data-testid="admin-wheel-threshold-value"]')

  // Projects (page 4)
  const projectsList = $('[data-testid="admin-projects-list"]')
  const projectsAddBtn = $('[data-testid="admin-projects-add"]')
  const projectsEmpty = $('[data-testid="admin-projects-empty"]')

  // About (page 5)
  const aboutEyebrow = $('[data-testid="admin-about-eyebrow"]')
  const aboutHeadingPre = $('[data-testid="admin-about-heading-pre"]')
  const aboutHeadingEm = $('[data-testid="admin-about-heading-emphasis"]')
  const aboutBody = $('[data-testid="admin-about-body"]')
  const aboutPhotoPreview = $('[data-testid="admin-about-photo-preview"]')
  const aboutPhotoInput = $('[data-testid="admin-about-photo-input"]')
  const aboutName = $('[data-testid="admin-about-name"]')
  const aboutRole = $('[data-testid="admin-about-role"]')
  const aboutYears = $('[data-testid="admin-about-years"]')
  const aboutSkills = $('[data-testid="admin-about-skills"]')
  const aboutTools = $('[data-testid="admin-about-tools"]')
  // About transition (Page 5 — separate effect for scroll-to-about)
  const aboutTransitionEffect = $('[data-testid="admin-about-transition-effect"]')
  const aboutTransitionSpeed = $('[data-testid="admin-about-transition-speed"]')
  const aboutTransitionSpeedLbl = $('[data-testid="admin-about-transition-speed-value"]')
  // Site access switch (top of panel, persistent across pages)
  const accessToggle = $('[data-testid="admin-access-toggle"]')
  const accessStatus = $('[data-testid="admin-access-status"]')
  const accessBar = $('[data-testid="admin-access-bar"]')
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

  // Inbox refs
  const inboxList = $('[data-testid="admin-inbox-list"]')
  const inboxBadge = $('[data-testid="admin-inbox-badge"]')
  const inboxMeta = $('[data-testid="admin-inbox-meta"]')
  const inboxEmpty = $('[data-testid="admin-inbox-empty"]')
  const inboxRefreshBtn = $('[data-testid="admin-inbox-refresh"]')
  const inboxToggle = $('[data-testid="admin-inbox-toggle"]')
  const inboxSection = $('[data-testid="admin-inbox-section"]')

  // Pager refs
  const pagerPrev = $('[data-testid="admin-pager-prev"]')
  const pagerNext = $('[data-testid="admin-pager-next"]')
  const pagerIndicator = $('[data-testid="admin-pager-indicator"]')
  const pages = panel.querySelectorAll('.admin-panel__page')

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
    // Welcome overlay heading typography (CSS vars on :root)
    const wls = (typeof s.welcome_letter_spacing === 'number') ? s.welcome_letter_spacing : DEFAULTS.welcome_letter_spacing
    const wlh = (typeof s.welcome_line_spacing === 'number') ? s.welcome_line_spacing : DEFAULTS.welcome_line_spacing
    document.documentElement.style.setProperty('--welcome-brand-ls', `${wls}em`)
    document.documentElement.style.setProperty('--welcome-brand-lh', String(wlh))
  }

  const applyCubeTextures = async (s) => {
    // Cube text labels — multi-line aware, with letter & line spacing
    const family = s.cube_font || DEFAULTS.cube_font
    const ls = (typeof s.cube_letter_spacing === 'number') ? s.cube_letter_spacing : DEFAULTS.cube_letter_spacing
    const lh = (typeof s.cube_line_spacing === 'number') ? s.cube_line_spacing : DEFAULTS.cube_line_spacing
    const opts = { letterSpacing: ls, lineSpacing: lh }
    await ensureFontLoaded(family, fontMeta(family).weight)
    const t1 = (s.cube_text_1 || '').trim()
    const t2 = (s.cube_text_2 || '').trim()
    if (t1) {
      try { text1Texture.reload(buildTextCanvas(t1.toUpperCase(), family, opts)) } catch (e) { /* */ }
    }
    if (t2) {
      try { text2Texture.reload(buildTextCanvas(t2.toUpperCase(), family, opts)) } catch (e) { /* */ }
    }
    if (!t1 && (s.cube_font || ls !== DEFAULTS.cube_letter_spacing || lh !== DEFAULTS.cube_line_spacing)) {
      try { text1Texture.reload(buildTextCanvas(DEFAULTS.cube_text_1, family, opts)) } catch (e) { /* */ }
    }
    if (!t2 && (s.cube_font || ls !== DEFAULTS.cube_letter_spacing || lh !== DEFAULTS.cube_line_spacing)) {
      try { text2Texture.reload(buildTextCanvas(DEFAULTS.cube_text_2, family, opts)) } catch (e) { /* */ }
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

  const applyGradient = (s) => {
    const preset = s.gradient_preset || DEFAULTS.gradient_preset
    const colors = composeGradient(preset, s.gradient_color_a, s.gradient_color_b)
    setGradientState(colors)
  }

  const applyRippleEffects = (s) => {
    const speed = (typeof s.ripple_speed === 'number') ? s.ripple_speed : DEFAULTS.ripple_speed
    const tint = (typeof s.ripple_tint === 'number') ? s.ripple_tint : DEFAULTS.ripple_tint
    const rings = (typeof s.ripple_ring_count === 'number') ? s.ripple_ring_count : DEFAULTS.ripple_ring_count
    document.documentElement.style.setProperty('--ripple-speed', String(speed))
    document.documentElement.style.setProperty('--ripple-tint', `${tint}%`)
    if (rippleEl) rippleEl.setAttribute('data-rings', String(rings))
  }

  const applyLetterFx = (s) => {
    if (window.__welcomeFx && typeof window.__welcomeFx.applyWelcomeLetterFxSettings === 'function') {
      window.__welcomeFx.applyWelcomeLetterFxSettings(s || {})
    }
  }

  const applyMotion = (s) => {
    const sw = (typeof s.swipe_threshold === 'number') ? s.swipe_threshold : DEFAULTS.swipe_threshold
    const wh = (typeof s.wheel_threshold === 'number') ? s.wheel_threshold : DEFAULTS.wheel_threshold
    window.__motion = window.__motion || {}
    window.__motion.swipeThresh = sw
    window.__motion.wheelThresh = wh
  }

  const applyAbout = (s) => {
    if (window.__about && typeof window.__about.applyAboutSettings === 'function') {
      window.__about.applyAboutSettings(s || {})
    }
    if (window.__welcomeFx && typeof window.__welcomeFx.setAboutTransitionSettings === 'function') {
      window.__welcomeFx.setAboutTransitionSettings(s || {})
    }
  }

  const applySettings = async (s) => {
    applyAccent(s.accent_color || DEFAULTS.accent_color)
    applyGradient(s)
    applyTextDOM(s)
    applyRippleEffects(s)
    applyLetterFx(s)
    applyMotion(s)
    applyAbout(s)
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
    const ls = (typeof s.cube_letter_spacing === 'number') ? s.cube_letter_spacing : DEFAULTS.cube_letter_spacing
    const lh = (typeof s.cube_line_spacing === 'number') ? s.cube_line_spacing : DEFAULTS.cube_line_spacing
    inputLetterSpacing.value = ls
    labelLetterSpacing.textContent = `${ls.toFixed(2)} em`
    inputLineSpacing.value = lh
    labelLineSpacing.textContent = `${lh.toFixed(2)}×`

    inputGradientPreset.value = s.gradient_preset || DEFAULTS.gradient_preset
    inputGradColorAHex.value = s.gradient_color_a ? s.gradient_color_a.toUpperCase() : ''
    inputGradColorBHex.value = s.gradient_color_b ? s.gradient_color_b.toUpperCase() : ''
    if (s.gradient_color_a) inputGradColorA.value = s.gradient_color_a
    if (s.gradient_color_b) inputGradColorB.value = s.gradient_color_b

    inputBrandTitle.value = s.brand_title || ''
    inputBrandTagline.value = s.brand_tagline || ''
    inputWelcomeHeading.value = s.welcome_heading || ''
    inputWelcomeSub.value = s.welcome_sub || ''
    const wls = (typeof s.welcome_letter_spacing === 'number') ? s.welcome_letter_spacing : DEFAULTS.welcome_letter_spacing
    const wlh = (typeof s.welcome_line_spacing === 'number') ? s.welcome_line_spacing : DEFAULTS.welcome_line_spacing
    if (inputWelcomeLetterSpacing) {
      inputWelcomeLetterSpacing.value = wls
      labelWelcomeLetterSpacing.textContent = `${wls.toFixed(2)} em`
    }
    if (inputWelcomeLineSpacing) {
      inputWelcomeLineSpacing.value = wlh
      labelWelcomeLineSpacing.textContent = `${wlh.toFixed(2)}×`
    }
    const rspeed = (typeof s.ripple_speed === 'number') ? s.ripple_speed : DEFAULTS.ripple_speed
    const rtint = (typeof s.ripple_tint === 'number') ? s.ripple_tint : DEFAULTS.ripple_tint
    const rrings = (typeof s.ripple_ring_count === 'number') ? s.ripple_ring_count : DEFAULTS.ripple_ring_count
    if (inputRippleSpeed) {
      inputRippleSpeed.value = rspeed
      labelRippleSpeed.textContent = `${rspeed.toFixed(2)}×`
    }
    if (inputRippleTint) {
      inputRippleTint.value = rtint
      labelRippleTint.textContent = `${rtint}%`
    }
    if (inputRippleRings) {
      inputRippleRings.value = String(rrings)
    }
    // Letter FX form fill
    if (inputLetterEffect) inputLetterEffect.value = s.welcome_letter_effect || ''
    if (inputLetterSpeed) {
      const v = (typeof s.welcome_letter_speed === 'number') ? s.welcome_letter_speed : DEFAULTS.welcome_letter_speed
      inputLetterSpeed.value = v
      labelLetterSpeed.textContent = `${v.toFixed(2)}×`
    }
    if (inputLetterStagger) {
      const v = (typeof s.welcome_letter_stagger === 'number') ? s.welcome_letter_stagger : DEFAULTS.welcome_letter_stagger
      inputLetterStagger.value = v
      labelLetterStagger.textContent = v === 0 ? 'preset' : `${v} ms`
    }
    if (inputLetterDensity) inputLetterDensity.value = s.welcome_letter_density || DEFAULTS.welcome_letter_density
    if (inputLetterShapes) inputLetterShapes.value = s.welcome_letter_shapes || DEFAULTS.welcome_letter_shapes
    if (inputLetterFill) inputLetterFill.checked = (typeof s.welcome_letter_fill === 'boolean') ? s.welcome_letter_fill : DEFAULTS.welcome_letter_fill
    if (inputLetterUseAccent) inputLetterUseAccent.checked = (typeof s.welcome_letter_use_accent === 'boolean') ? s.welcome_letter_use_accent : DEFAULTS.welcome_letter_use_accent
    if (inputLetterApplyTo) inputLetterApplyTo.value = s.welcome_letter_apply_to || DEFAULTS.welcome_letter_apply_to
    const swipe = (typeof s.swipe_threshold === 'number') ? s.swipe_threshold : DEFAULTS.swipe_threshold
    const wheel = (typeof s.wheel_threshold === 'number') ? s.wheel_threshold : DEFAULTS.wheel_threshold
    if (inputSwipeThreshold) {
      inputSwipeThreshold.value = swipe
      labelSwipeThreshold.textContent = `${swipe} px`
    }
    if (inputWheelThreshold) {
      inputWheelThreshold.value = wheel
      labelWheelThreshold.textContent = `${wheel} px`
    }

    // About fields (page 5)
    if (aboutEyebrow) aboutEyebrow.value = s.about_eyebrow || ''
    if (aboutHeadingPre) aboutHeadingPre.value = s.about_heading_pre || ''
    if (aboutHeadingEm) aboutHeadingEm.value = s.about_heading_emphasis || ''
    if (aboutBody) aboutBody.value = s.about_body || ''
    if (aboutName) aboutName.value = s.about_person_name || ''
    if (aboutRole) aboutRole.value = s.about_person_role || ''
    if (aboutYears) aboutYears.value = (typeof s.about_years === 'number') ? s.about_years : ''
    if (aboutSkills) {
      const list = Array.isArray(s.about_skills) ? s.about_skills : []
      aboutSkills.value = list.map((sk) => `${sk.name} : ${sk.pct}`).join('\n')
    }
    if (aboutTools) {
      const list = Array.isArray(s.about_tools) ? s.about_tools : []
      aboutTools.value = list.join(', ')
    }
    if (aboutTransitionEffect) aboutTransitionEffect.value = s.about_transition_effect || ''
    if (aboutTransitionSpeed) {
      const v = (typeof s.about_transition_speed === 'number') ? s.about_transition_speed : 1.0
      aboutTransitionSpeed.value = String(v)
      if (aboutTransitionSpeedLbl) aboutTransitionSpeedLbl.textContent = `${v.toFixed(2)}×`
    }
    // Site access — null/undefined means default true
    if (accessToggle) {
      const enabled = s.access_enabled !== false
      accessToggle.checked = enabled
      updateAccessBarUI(enabled)
    }
    if (aboutPhotoPreview) {
      const url = s.about_photo_url
      if (url) {
        aboutPhotoPreview.style.backgroundImage = `url('${url}')`
        aboutPhotoPreview.classList.add('has-image')
        aboutPhotoPreview.querySelector('.admin-logo__placeholder')?.remove()
      } else {
        aboutPhotoPreview.style.backgroundImage = ''
        aboutPhotoPreview.classList.remove('has-image')
        if (!aboutPhotoPreview.querySelector('.admin-logo__placeholder')) {
          const span = document.createElement('span')
          span.className = 'admin-logo__placeholder'
          span.textContent = 'No photo'
          aboutPhotoPreview.appendChild(span)
        }
      }
    }
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

  const collectFormSettings = () => {
    const base = {
    cube_text_1: inputCubeText1.value.trim() || null,
    cube_text_2: inputCubeText2.value.trim() || null,
    cube_font: inputCubeFont.value || null,
    cube_letter_spacing: parseFloat(inputLetterSpacing.value),
    cube_line_spacing: parseFloat(inputLineSpacing.value),
    gradient_preset: inputGradientPreset.value || null,
    gradient_color_a: inputGradColorAHex.value.trim() || null,
    gradient_color_b: inputGradColorBHex.value.trim() || null,
    brand_title: inputBrandTitle.value.trim() || null,
    brand_tagline: inputBrandTagline.value.trim() || null,
    welcome_heading: inputWelcomeHeading.value.trim() || null,
    welcome_sub: inputWelcomeSub.value.trim() || null,
    welcome_letter_spacing: inputWelcomeLetterSpacing ? parseFloat(inputWelcomeLetterSpacing.value) : DEFAULTS.welcome_letter_spacing,
    welcome_line_spacing: inputWelcomeLineSpacing ? parseFloat(inputWelcomeLineSpacing.value) : DEFAULTS.welcome_line_spacing,
    ripple_speed: inputRippleSpeed ? parseFloat(inputRippleSpeed.value) : DEFAULTS.ripple_speed,
    ripple_tint: inputRippleTint ? parseInt(inputRippleTint.value, 10) : DEFAULTS.ripple_tint,
    ripple_ring_count: inputRippleRings ? parseInt(inputRippleRings.value, 10) : DEFAULTS.ripple_ring_count,
    welcome_letter_effect: inputLetterEffect ? (inputLetterEffect.value || null) : null,
    welcome_letter_speed: inputLetterSpeed ? parseFloat(inputLetterSpeed.value) : DEFAULTS.welcome_letter_speed,
    welcome_letter_stagger: inputLetterStagger ? parseInt(inputLetterStagger.value, 10) : DEFAULTS.welcome_letter_stagger,
    welcome_letter_density: inputLetterDensity ? inputLetterDensity.value : DEFAULTS.welcome_letter_density,
    welcome_letter_shapes: inputLetterShapes ? inputLetterShapes.value : DEFAULTS.welcome_letter_shapes,
    welcome_letter_fill: inputLetterFill ? !!inputLetterFill.checked : DEFAULTS.welcome_letter_fill,
    welcome_letter_use_accent: inputLetterUseAccent ? !!inputLetterUseAccent.checked : DEFAULTS.welcome_letter_use_accent,
    welcome_letter_apply_to: inputLetterApplyTo ? inputLetterApplyTo.value : DEFAULTS.welcome_letter_apply_to,
    swipe_threshold: inputSwipeThreshold ? parseInt(inputSwipeThreshold.value, 10) : DEFAULTS.swipe_threshold,
    wheel_threshold: inputWheelThreshold ? parseInt(inputWheelThreshold.value, 10) : DEFAULTS.wheel_threshold,
    accent_color: inputAccentHex.value.trim() || null,
    logo_url: pendingLogoUrl || published.logo_url || null,
    }
    // About — page 5
    if (aboutEyebrow) base.about_eyebrow = aboutEyebrow.value.trim() || null
    if (aboutHeadingPre) base.about_heading_pre = aboutHeadingPre.value.trim() || null
    if (aboutHeadingEm) base.about_heading_emphasis = aboutHeadingEm.value.trim() || null
    if (aboutBody) base.about_body = aboutBody.value || null
    if (aboutName) base.about_person_name = aboutName.value.trim() || null
    if (aboutRole) base.about_person_role = aboutRole.value.trim() || null
    if (aboutYears) base.about_years = aboutYears.value === '' ? null : parseInt(aboutYears.value, 10)
    if (aboutSkills) {
      const lines = aboutSkills.value.split(/\n+/).map((l) => l.trim()).filter(Boolean)
      base.about_skills = lines.map((line) => {
        const [name, pctRaw] = line.split(':').map((x) => x.trim())
        const pct = Math.max(0, Math.min(100, parseInt(pctRaw, 10) || 0))
        return { name: name || 'Skill', pct }
      })
    }
    if (aboutTools) {
      base.about_tools = aboutTools.value.split(',').map((t) => t.trim()).filter(Boolean)
    }
    if (aboutTransitionEffect) base.about_transition_effect = aboutTransitionEffect.value || null
    if (aboutTransitionSpeed) base.about_transition_speed = parseFloat(aboutTransitionSpeed.value)
    if (accessToggle) base.access_enabled = !!accessToggle.checked
    return base
  }

  // ----- Access toggle UI helper -----
  const updateAccessBarUI = (enabled) => {
    if (accessStatus) accessStatus.textContent = enabled ? 'Visitors can enter' : 'Site is locked'
    if (accessBar) accessBar.classList.toggle('is-locked', !enabled)
  }

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

  // ----- Inbox -----
  const _esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const _relTime = (iso) => {
    if (!iso) return ''
    const t = new Date(iso).getTime()
    if (isNaN(t)) return ''
    const diff = Math.max(0, Date.now() - t)
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    if (d < 7) return `${d}d ago`
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const _eventChip = (status) => {
    const s = String(status || '').toLowerCase()
    const cls = ['delivered', 'open', 'click', 'bounce', 'dropped', 'spamreport'].includes(s) ? `is-${s}` : ''
    return `<span class="inbox-event ${cls}">${_esc(s)}</span>`
  }

  const updateInboxBadge = (unread) => {
    if (!inboxBadge) return
    if (unread > 0) {
      inboxBadge.textContent = unread > 99 ? '99+' : String(unread)
      inboxBadge.hidden = false
    } else {
      inboxBadge.hidden = true
    }
  }

  const renderInbox = (items) => {
    if (!inboxList) return
    inboxList.innerHTML = ''
    if (!items || items.length === 0) {
      if (inboxEmpty) inboxEmpty.hidden = false
      return
    }
    if (inboxEmpty) inboxEmpty.hidden = true
    items.forEach((it) => {
      const el = document.createElement('article')
      el.className = `inbox-item${it.read ? '' : ' is-unread'}`
      el.setAttribute('role', 'listitem')
      el.setAttribute('data-id', it.id)
      el.setAttribute('data-testid', `inbox-item-${it.id}`)
      const events = (it.event_statuses || []).map(_eventChip).join('')
      el.innerHTML = `
        <div class="inbox-item__head">
          <span class="inbox-item__name">${_esc(it.name || 'Anonymous')}</span>
          <span class="inbox-item__time">${_esc(_relTime(it.created_at))}</span>
        </div>
        <div class="inbox-item__email">${_esc(it.email)}</div>
        <p class="inbox-item__snippet">${_esc(it.snippet)}</p>
        ${events ? `<div class="inbox-item__events">${events}</div>` : ''}
      `
      el.addEventListener('click', () => expandInboxItem(el, it))
      inboxList.appendChild(el)
    })
  }

  const expandInboxItem = async (el, summary) => {
    if (el.classList.contains('is-expanded')) return
    // Mark read on the server if needed
    if (!summary.read) {
      try {
        await apiFetch(`/api/admin/contacts/${summary.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ read: true }),
        }, token)
        summary.read = true
        el.classList.remove('is-unread')
        // Decrement unread badge
        const cur = parseInt(inboxBadge && inboxBadge.textContent || '0', 10) || 0
        updateInboxBadge(Math.max(0, cur - 1))
      } catch (_) { /* ignore */ }
    }
    // Fetch full message
    let detail = null
    try { detail = await apiFetch(`/api/admin/contacts/${summary.id}`, {}, token) } catch (_) { detail = null }
    const fullMsg = (detail && detail.message) || summary.snippet || ''
    el.classList.add('is-expanded')
    const existing = el.querySelector('.inbox-item__full')
    if (existing) existing.remove()
    const full = document.createElement('div')
    full.className = 'inbox-item__full'
    full.textContent = fullMsg
    el.appendChild(full)

    const actions = document.createElement('div')
    actions.className = 'inbox-item__actions'
    actions.innerHTML = `
      <a class="is-reply" href="mailto:${_esc(summary.email)}?subject=${encodeURIComponent('Re: your message to Jax Studio')}" data-testid="inbox-reply-${summary.id}" style="text-decoration:none;display:flex;align-items:center;justify-content:center;">Reply</a>
      <button type="button" class="is-mark-unread" data-testid="inbox-unread-${summary.id}">Mark unread</button>
      <button type="button" class="is-delete" data-testid="inbox-delete-${summary.id}">Delete</button>
    `
    actions.addEventListener('click', (e) => e.stopPropagation())
    el.appendChild(actions)

    actions.querySelector('.is-mark-unread').addEventListener('click', async () => {
      try {
        await apiFetch(`/api/admin/contacts/${summary.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ read: false }),
        }, token)
        const cur = parseInt(inboxBadge && inboxBadge.textContent || '0', 10) || 0
        updateInboxBadge(cur + 1)
        loadInbox()
      } catch (err) { setPanelStatus(err.message || 'Could not mark unread', 'error') }
    })

    actions.querySelector('.is-delete').addEventListener('click', async () => {
      if (!window.confirm('Delete this message? This cannot be undone.')) return
      try {
        await apiFetch(`/api/admin/contacts/${summary.id}`, { method: 'DELETE' }, token)
        loadInbox()
      } catch (err) { setPanelStatus(err.message || 'Delete failed', 'error') }
    })
  }

  const loadInbox = async () => {
    if (!inboxList || !token) return
    if (inboxRefreshBtn) inboxRefreshBtn.classList.add('is-spinning')
    if (inboxMeta) inboxMeta.textContent = 'Loading messages…'
    try {
      const data = await apiFetch('/api/admin/contacts?limit=50', {}, token)
      const items = data.items || []
      const total = data.total || 0
      const unread = data.unread || 0
      updateInboxBadge(unread)
      if (inboxMeta) {
        inboxMeta.textContent = total === 0
          ? 'No submissions yet.'
          : `${total} message${total === 1 ? '' : 's'} · ${unread} unread`
      }
      renderInbox(items)
      // First-load default: collapse if no unread + user hasn't set a preference
      if (!loadInbox._initialized) {
        loadInbox._initialized = true
        let stored = null
        try { stored = localStorage.getItem(INBOX_COLLAPSED_KEY) } catch (_) { /* */ }
        if (stored === '1' || stored === '0') {
          setInboxCollapsed(stored === '1', false)
        } else {
          setInboxCollapsed(unread === 0, false)
        }
      }
    } catch (err) {
      if (inboxMeta) inboxMeta.textContent = `Could not load inbox: ${err.message}`
      renderInbox([])
    } finally {
      setTimeout(() => inboxRefreshBtn && inboxRefreshBtn.classList.remove('is-spinning'), 400)
    }
  }

  if (inboxRefreshBtn) {
    inboxRefreshBtn.addEventListener('click', (e) => { e.stopPropagation(); loadInbox() })
  }

  // Inbox collapse / expand
  const setInboxCollapsed = (collapsed, persist = true) => {
    if (!inboxSection) return
    inboxSection.classList.toggle('is-collapsed', !!collapsed)
    if (persist) {
      try { localStorage.setItem(INBOX_COLLAPSED_KEY, collapsed ? '1' : '0') } catch (_) { /* */ }
    }
  }
  if (inboxToggle) {
    inboxToggle.addEventListener('click', (e) => {
      // Don't toggle if the click was on the refresh icon
      if (e.target.closest('.admin-inbox__refresh')) return
      const isCollapsed = inboxSection.classList.contains('is-collapsed')
      setInboxCollapsed(!isCollapsed)
    })
  }

  // Multi-page panel cycler
  const TOTAL_PAGES = pages.length
  const setActivePage = (idx) => {
    const i = Math.max(0, Math.min(TOTAL_PAGES - 1, idx))
    pages.forEach((p, k) => {
      p.classList.toggle('is-active', k === i)
      p.setAttribute('aria-hidden', k === i ? 'false' : 'true')
    })
    if (pagerIndicator) pagerIndicator.textContent = `${i + 1} / ${TOTAL_PAGES}`
    if (pagerPrev) pagerPrev.disabled = (i === 0)
    if (pagerNext) pagerNext.disabled = (i === TOTAL_PAGES - 1)
    try { localStorage.setItem(PANEL_PAGE_KEY, String(i)) } catch (_) { /* */ }
    // Scroll the panel back to the top when switching pages
    const scroll = panel.querySelector('.admin-panel__scroll')
    if (scroll) scroll.scrollTop = 0
  }
  if (pagerPrev) pagerPrev.addEventListener('click', () => {
    const cur = Array.from(pages).findIndex((p) => p.classList.contains('is-active'))
    setActivePage(cur - 1)
  })
  if (pagerNext) pagerNext.addEventListener('click', () => {
    const cur = Array.from(pages).findIndex((p) => p.classList.contains('is-active'))
    setActivePage(cur + 1)
  })
  // Restore last-active page from localStorage (default 0 = page 1)
  try {
    const savedPage = parseInt(localStorage.getItem(PANEL_PAGE_KEY) || '0', 10)
    if (!isNaN(savedPage) && savedPage >= 0 && savedPage < TOTAL_PAGES) {
      setActivePage(savedPage)
    } else {
      setActivePage(0)
    }
  } catch (_) { setActivePage(0) }

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
      loadInbox()
      loadProjects()
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
      loadInbox()
      loadProjects()
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

  // Letter & line spacing sliders — live update (debounced 80ms feels snappy
  // but doesn't thrash the GPU)
  const liveSpacingRender = (() => {
    let t = null
    return () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        const family = inputCubeFont.value || DEFAULTS.cube_font
        const opts = {
          letterSpacing: parseFloat(inputLetterSpacing.value),
          lineSpacing: parseFloat(inputLineSpacing.value),
        }
        const t1 = inputCubeText1.value.trim() || DEFAULTS.cube_text_1
        const t2 = inputCubeText2.value.trim() || DEFAULTS.cube_text_2
        try { text1Texture.reload(buildTextCanvas(t1.toUpperCase(), family, opts)) } catch (_) { /* */ }
        try { text2Texture.reload(buildTextCanvas(t2.toUpperCase(), family, opts)) } catch (_) { /* */ }
      }, 80)
    }
  })()
  inputLetterSpacing.addEventListener('input', () => {
    labelLetterSpacing.textContent = `${parseFloat(inputLetterSpacing.value).toFixed(2)} em`
    liveSpacingRender()
  })
  inputLineSpacing.addEventListener('input', () => {
    labelLineSpacing.textContent = `${parseFloat(inputLineSpacing.value).toFixed(2)}×`
    liveSpacingRender()
  })

  // Welcome overlay typography sliders → CSS vars on :root (live, no rebuild)
  const applyWelcomeSpacingFromForm = () => {
    if (!inputWelcomeLetterSpacing || !inputWelcomeLineSpacing) return
    const ls = parseFloat(inputWelcomeLetterSpacing.value)
    const lh = parseFloat(inputWelcomeLineSpacing.value)
    document.documentElement.style.setProperty('--welcome-brand-ls', `${ls}em`)
    document.documentElement.style.setProperty('--welcome-brand-lh', String(lh))
  }
  if (inputWelcomeLetterSpacing) {
    inputWelcomeLetterSpacing.addEventListener('input', () => {
      labelWelcomeLetterSpacing.textContent = `${parseFloat(inputWelcomeLetterSpacing.value).toFixed(2)} em`
      applyWelcomeSpacingFromForm()
    })
  }
  if (inputWelcomeLineSpacing) {
    inputWelcomeLineSpacing.addEventListener('input', () => {
      labelWelcomeLineSpacing.textContent = `${parseFloat(inputWelcomeLineSpacing.value).toFixed(2)}×`
      applyWelcomeSpacingFromForm()
    })
  }

  // Cube ripple effects — live
  if (inputRippleSpeed) {
    inputRippleSpeed.addEventListener('input', () => {
      const v = parseFloat(inputRippleSpeed.value)
      labelRippleSpeed.textContent = `${v.toFixed(2)}×`
      document.documentElement.style.setProperty('--ripple-speed', String(v))
    })
  }
  if (inputRippleTint) {
    inputRippleTint.addEventListener('input', () => {
      const v = parseInt(inputRippleTint.value, 10)
      labelRippleTint.textContent = `${v}%`
      document.documentElement.style.setProperty('--ripple-tint', `${v}%`)
    })
  }
  if (inputRippleRings) {
    inputRippleRings.addEventListener('change', () => {
      const v = parseInt(inputRippleRings.value, 10)
      if (rippleEl) rippleEl.setAttribute('data-rings', String(v))
    })
  }

  // Letter FX live preview — re-build Word objects when any control changes
  const liveApplyLetterFx = () => {
    const partial = collectFormSettings()
    if (window.__welcomeFx && typeof window.__welcomeFx.applyWelcomeLetterFxSettings === 'function') {
      window.__welcomeFx.applyWelcomeLetterFxSettings(partial)
    }
  }
  if (inputLetterEffect) inputLetterEffect.addEventListener('change', liveApplyLetterFx)
  if (inputLetterSpeed) inputLetterSpeed.addEventListener('input', () => {
    const v = parseFloat(inputLetterSpeed.value)
    if (labelLetterSpeed) labelLetterSpeed.textContent = `${v.toFixed(2)}×`
    liveApplyLetterFx()
  })
  if (inputLetterStagger) inputLetterStagger.addEventListener('input', () => {
    const v = parseInt(inputLetterStagger.value, 10)
    if (labelLetterStagger) labelLetterStagger.textContent = v === 0 ? 'preset' : `${v} ms`
    liveApplyLetterFx()
  })
  if (inputLetterDensity) inputLetterDensity.addEventListener('change', liveApplyLetterFx)
  if (inputLetterShapes) inputLetterShapes.addEventListener('change', liveApplyLetterFx)
  if (inputLetterFill) inputLetterFill.addEventListener('change', liveApplyLetterFx)
  if (inputLetterUseAccent) inputLetterUseAccent.addEventListener('change', liveApplyLetterFx)
  if (inputLetterApplyTo) inputLetterApplyTo.addEventListener('change', liveApplyLetterFx)

  // Scroll & swipe sensitivity — live
  if (inputSwipeThreshold) {
    inputSwipeThreshold.addEventListener('input', () => {
      const v = parseInt(inputSwipeThreshold.value, 10)
      if (labelSwipeThreshold) labelSwipeThreshold.textContent = `${v} px`
      window.__motion = window.__motion || {}
      window.__motion.swipeThresh = v
    })
  }
  if (inputWheelThreshold) {
    inputWheelThreshold.addEventListener('input', () => {
      const v = parseInt(inputWheelThreshold.value, 10)
      if (labelWheelThreshold) labelWheelThreshold.textContent = `${v} px`
      window.__motion = window.__motion || {}
      window.__motion.wheelThresh = v
    })
  }

  // ---- About (Page 5) — live preview ----
  const liveApplyAbout = () => {
    const partial = collectFormSettings()
    if (window.__about && typeof window.__about.applyAboutSettings === 'function') {
      window.__about.applyAboutSettings(partial)
    }
  }
  ;[aboutEyebrow, aboutHeadingPre, aboutHeadingEm, aboutBody, aboutName, aboutRole, aboutYears, aboutSkills, aboutTools].forEach((el) => {
    if (el) el.addEventListener('input', liveApplyAbout)
  })

  // ---- About transition (Page 5) — live preview & speed label ----
  const liveApplyAboutTransition = () => {
    const settings = {
      about_transition_effect: aboutTransitionEffect ? (aboutTransitionEffect.value || null) : null,
      about_transition_speed: aboutTransitionSpeed ? parseFloat(aboutTransitionSpeed.value) : 1.0,
    }
    if (window.__welcomeFx && typeof window.__welcomeFx.setAboutTransitionSettings === 'function') {
      window.__welcomeFx.setAboutTransitionSettings(settings)
    }
  }
  if (aboutTransitionEffect) aboutTransitionEffect.addEventListener('change', liveApplyAboutTransition)
  if (aboutTransitionSpeed) {
    aboutTransitionSpeed.addEventListener('input', () => {
      const v = parseFloat(aboutTransitionSpeed.value)
      if (aboutTransitionSpeedLbl) aboutTransitionSpeedLbl.textContent = `${v.toFixed(2)}×`
      liveApplyAboutTransition()
    })
  }

  // ---- Site access toggle (instant save + live apply) ----
  if (accessToggle) {
    accessToggle.addEventListener('change', async () => {
      const enabled = !!accessToggle.checked
      updateAccessBarUI(enabled)
      // Live apply to the public site immediately
      if (window.__access && typeof window.__access.setAccessEnabled === 'function') {
        window.__access.setAccessEnabled(enabled)
      }
      // Persist
      try {
        await apiFetch('/api/admin/settings', {
          method: 'PUT',
          body: JSON.stringify({ access_enabled: enabled }),
        }, token)
      } catch (e) {
        // Revert UI on failure
        accessToggle.checked = !enabled
        updateAccessBarUI(!enabled)
        if (window.__access) window.__access.setAccessEnabled(!enabled)
      }
    })
  }

  // About photo upload
  if (aboutPhotoInput) {
    aboutPhotoInput.addEventListener('change', async () => {
      if (!aboutPhotoInput.files || !aboutPhotoInput.files[0]) return
      const fd = new FormData()
      fd.append('file', aboutPhotoInput.files[0])
      try {
        const res = await fetch('/api/admin/about/upload', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: fd,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || `Upload failed (${res.status})`)
        }
        const json = await res.json()
        // Persist on settings immediately
        await apiFetch('/api/admin/settings', {
          method: 'PUT',
          body: JSON.stringify({ about_photo_url: json.image_url }),
        }, token)
        published.about_photo_url = json.image_url
        // Update preview thumb
        if (aboutPhotoPreview) {
          aboutPhotoPreview.style.backgroundImage = `url('${json.image_url}')`
          aboutPhotoPreview.classList.add('has-image')
          aboutPhotoPreview.querySelector('.admin-logo__placeholder')?.remove()
        }
        // Live update on the page
        liveApplyAbout()
        setPanelStatus('Photo uploaded', 'success')
      } catch (err) {
        setPanelStatus(err.message || 'Upload failed', 'error')
      }
    })
  }

  // ===================== Page 4 — Projects CRUD =====================
  const _pEsc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const _projectInitial = (t) => {
    const c = String(t || '').trim().replace(/[^A-Za-z0-9]/g, '')
    return c ? c[0].toUpperCase() : '?'
  }

  const renderProjectRow = (project) => {
    const row = document.createElement('div')
    row.className = 'admin-project-row'
    row.setAttribute('data-id', project.id)
    row.setAttribute('data-testid', `admin-project-${project.id}`)
    const thumbStyle = project.image_url
      ? `style="background-image:url('${_pEsc(project.image_url)}');"`
      : ''
    row.innerHTML = `
      <div class="admin-project-row__head">
        <div class="admin-project-row__thumb" ${thumbStyle}>${project.image_url ? '' : _pEsc(_projectInitial(project.title))}</div>
        <div class="admin-project-row__heading">
          <input class="admin-project-row__title-input" data-field="title" value="${_pEsc(project.title || '')}" placeholder="Project title" maxlength="120" />
        </div>
      </div>
      <div class="admin-project-row__meta">
        <input class="admin-project-row__meta-year" data-field="year" type="number" value="${_pEsc(project.year || '')}" placeholder="Year" min="1900" max="2100" />
        <input class="admin-project-row__meta-order" data-field="sort_order" type="number" value="${_pEsc(project.sort_order || '')}" placeholder="Order" min="0" max="9999" />
      </div>
      <textarea class="admin-project-row__desc" data-field="description" placeholder="Short description (max 400 chars)" maxlength="400">${_pEsc(project.description || '')}</textarea>
      <div class="admin-project-row__actions">
        <label class="upload" data-testid="admin-project-upload-${project.id}">
          ${project.image_url ? 'Replace image' : 'Upload image'}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden />
        </label>
        <button type="button" class="is-save" data-testid="admin-project-save-${project.id}">Save</button>
        <button type="button" class="is-delete" data-testid="admin-project-delete-${project.id}">Delete</button>
      </div>
    `
    // Handlers
    const saveBtn = row.querySelector('.is-save')
    const delBtn = row.querySelector('.is-delete')
    const uploadInput = row.querySelector('input[type="file"]')

    const collectRow = () => {
      const fields = {}
      row.querySelectorAll('[data-field]').forEach((el) => {
        const k = el.getAttribute('data-field')
        let v = el.value
        if (k === 'year' || k === 'sort_order') v = v === '' ? null : parseInt(v, 10)
        fields[k] = v
      })
      return fields
    }

    saveBtn.addEventListener('click', async () => {
      const data = collectRow()
      try {
        await apiFetch(`/api/admin/projects/${project.id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }, token)
        setPanelStatus('Saved', 'success')
        loadProjects()
        if (window.__projects) window.__projects.fetchAndRenderProjects()
      } catch (err) {
        setPanelStatus(err.message || 'Save failed', 'error')
      }
    })

    delBtn.addEventListener('click', async () => {
      if (!window.confirm(`Delete "${project.title}"? This cannot be undone.`)) return
      try {
        await apiFetch(`/api/admin/projects/${project.id}`, { method: 'DELETE' }, token)
        loadProjects()
        if (window.__projects) window.__projects.fetchAndRenderProjects()
      } catch (err) {
        setPanelStatus(err.message || 'Delete failed', 'error')
      }
    })

    uploadInput.addEventListener('change', async () => {
      if (!uploadInput.files || !uploadInput.files[0]) return
      const fd = new FormData()
      fd.append('file', uploadInput.files[0])
      try {
        const res = await fetch('/api/admin/projects/upload', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: fd,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || `Upload failed (${res.status})`)
        }
        const json = await res.json()
        // Persist the new image_url on the project immediately
        await apiFetch(`/api/admin/projects/${project.id}`, {
          method: 'PUT',
          body: JSON.stringify({ image_url: json.image_url }),
        }, token)
        setPanelStatus('Image uploaded', 'success')
        loadProjects()
        if (window.__projects) window.__projects.fetchAndRenderProjects()
      } catch (err) {
        setPanelStatus(err.message || 'Upload failed', 'error')
      }
    })
    return row
  }

  const loadProjects = async () => {
    if (!projectsList) return
    try {
      const rows = await apiFetch('/api/projects', {}, token)
      projectsList.innerHTML = ''
      if (!rows || rows.length === 0) {
        if (projectsEmpty) projectsEmpty.hidden = false
        return
      }
      if (projectsEmpty) projectsEmpty.hidden = true
      rows.forEach((p) => projectsList.appendChild(renderProjectRow(p)))
    } catch (err) {
      setPanelStatus(err.message || 'Could not load projects', 'error')
    }
  }

  if (projectsAddBtn) {
    projectsAddBtn.addEventListener('click', async () => {
      try {
        await apiFetch('/api/admin/projects', {
          method: 'POST',
          body: JSON.stringify({
            title: 'New project',
            year: new Date().getFullYear(),
            description: '',
          }),
        }, token)
        loadProjects()
        if (window.__projects) window.__projects.fetchAndRenderProjects()
      } catch (err) {
        setPanelStatus(err.message || 'Add failed', 'error')
      }
    })
  }

  // Gradient preset + color overrides
  const applyGradientFromForm = () => {
    const preset = inputGradientPreset.value || DEFAULTS.gradient_preset
    const a = inputGradColorAHex.value.trim() || null
    const b = inputGradColorBHex.value.trim() || null
    setGradientState(composeGradient(preset, a, b))
  }
  inputGradientPreset.addEventListener('change', () => {
    applyGradientFromForm()
    setPanelStatus('Preset applied · click Publish to save.', 'success')
  })
  const onGradColorChange = (picker, hexInput) => () => {
    hexInput.value = picker.value.toUpperCase()
    applyGradientFromForm()
  }
  const onGradHexChange = (picker, hexInput) => () => {
    const v = (hexInput.value || '').trim()
    if (v === '') { applyGradientFromForm(); return }
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
      picker.value = v
      applyGradientFromForm()
    }
  }
  inputGradColorA.addEventListener('input', onGradColorChange(inputGradColorA, inputGradColorAHex))
  inputGradColorAHex.addEventListener('input', onGradHexChange(inputGradColorA, inputGradColorAHex))
  inputGradColorB.addEventListener('input', onGradColorChange(inputGradColorB, inputGradColorBHex))
  inputGradColorBHex.addEventListener('input', onGradHexChange(inputGradColorB, inputGradColorBHex))
  btnGradColorAClear.addEventListener('click', () => {
    inputGradColorAHex.value = ''
    applyGradientFromForm()
  })
  btnGradColorBClear.addEventListener('click', () => {
    inputGradColorBHex.value = ''
    applyGradientFromForm()
  })

  // Panel resizer — drag right edge to resize, persist width to localStorage
  const applyPanelWidth = (px) => {
    const w = Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.round(px)))
    panel.style.width = `${w}px`
    return w
  }
  // Restore saved width
  try {
    const saved = parseInt(localStorage.getItem(PANEL_WIDTH_KEY), 10)
    if (Number.isFinite(saved)) applyPanelWidth(saved)
  } catch (_) { /* */ }
  let dragState = null
  const onResizeMove = (e) => {
    if (!dragState) return
    const x = (e.touches ? e.touches[0].clientX : e.clientX)
    const next = dragState.startWidth + (x - dragState.startX)
    applyPanelWidth(next)
  }
  const onResizeEnd = () => {
    if (!dragState) return
    panel.classList.remove('is-resizing')
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
    document.removeEventListener('touchmove', onResizeMove)
    document.removeEventListener('touchend', onResizeEnd)
    try { localStorage.setItem(PANEL_WIDTH_KEY, String(panel.getBoundingClientRect().width)) } catch (_) { /* */ }
    dragState = null
  }
  const onResizeStart = (e) => {
    const x = (e.touches ? e.touches[0].clientX : e.clientX)
    dragState = { startX: x, startWidth: panel.getBoundingClientRect().width }
    panel.classList.add('is-resizing')
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup', onResizeEnd)
    document.addEventListener('touchmove', onResizeMove, { passive: true })
    document.addEventListener('touchend', onResizeEnd)
    e.preventDefault()
  }
  panelResizer.addEventListener('mousedown', onResizeStart)
  panelResizer.addEventListener('touchstart', onResizeStart, { passive: false })
  // Double-click to reset width
  panelResizer.addEventListener('dblclick', () => {
    applyPanelWidth(PANEL_WIDTH_DEFAULT)
    try { localStorage.setItem(PANEL_WIDTH_KEY, String(PANEL_WIDTH_DEFAULT)) } catch (_) { /* */ }
  })

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
      resetGradientState()
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
