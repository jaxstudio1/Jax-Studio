/**
 * Jax Studio — adapted from Apple Fifth Avenue WebGL demo by Lorenzo Cadamuro
 */

import {mat4} from 'gl-matrix'
import stats from '~js/helpers/stats'
import gui from '~js/helpers/gui'
import Texture from '~js/helpers/Texture'
import {regl, play} from '~js/renderer'
import camera from '~js/camera'
import cube, {Types as CubeTypes, Faces as CubeFaces, Masks as CubeMasks} from '~js/components/cube'
import content, {Types as ContentTypes} from '~js/components/content'
import reflection from '~js/components/reflection'
import {initAdmin} from '~js/admin'
import {applyWelcomeLetterFxSettings, playWelcomeEntrance, playWelcomeExit, setAboutTransitionSettings, playAboutExit, playAboutEntrance} from '~js/welcomeFx'
import {fetchAndRenderProjects, revealProjectsSection, hideProjectsSection} from '~js/projects'
import {applyAboutSettings, revealAboutSection, hideAboutSection} from '~js/about'

import '~css/main.css'

const CONFIG = {
  cameraX: 0,
  cameraY: 0,
  cameraZ: 5.7,
  rotation: 4.8,
  rotateX: 1,
  rotateY: 1,
  rotateZ: 1,
  velocity: 0.009,
}

/**
 * Pointer state — drives parallax + slow-down-near-center.
 * pointer.x / pointer.y range: [-1, 1], (0,0) = center of screen.
 * pointer.active = true while mouse is over the stage / finger touching.
 */
const pointer = {
  x: 0,
  y: 0,
  active: false,
  // smoothed values used in render loop (lerped toward raw)
  smX: 0,
  smY: 0,
  smActive: 0,
}

const stageEl = document.querySelector('.content')

const updatePointerFromEvent = (clientX, clientY) => {
  const rect = stageEl.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  // normalised offset from center, clamped to [-1, 1]
  const nx = Math.max(-1, Math.min(1, (clientX - cx) / (rect.width / 2)))
  const ny = Math.max(-1, Math.min(1, (clientY - cy) / (rect.height / 2)))
  pointer.x = nx
  pointer.y = ny
}

stageEl.addEventListener('mousemove', (e) => {
  pointer.active = true
  updatePointerFromEvent(e.clientX, e.clientY)
})

stageEl.addEventListener('mouseleave', () => {
  pointer.active = false
})

stageEl.addEventListener('mouseenter', () => {
  pointer.active = true
})

stageEl.addEventListener('touchstart', (e) => {
  if (e.touches.length === 0) return
  pointer.active = true
  updatePointerFromEvent(e.touches[0].clientX, e.touches[0].clientY)
}, {passive: true})

stageEl.addEventListener('touchmove', (e) => {
  if (e.touches.length === 0) return
  pointer.active = true
  updatePointerFromEvent(e.touches[0].clientX, e.touches[0].clientY)
}, {passive: true})

stageEl.addEventListener('touchend', () => {
  pointer.active = false
})

stageEl.addEventListener('touchcancel', () => {
  pointer.active = false
})

/**
 * Device-orientation tilt parallax (mobile)
 * - gamma: left-right tilt, range ~[-90, 90]    → pointer.x
 * - beta : front-back tilt, range ~[-180, 180]  → pointer.y
 * Calibration: capture the visitor's resting orientation as the origin.
 * iOS 13+ requires a permission gesture, so we wire the request to the
 * first user interaction with the page and silently fall back if denied.
 */
const orientation = {
  enabled: false,
  baseGamma: null,
  baseBeta: null,
  // sensitivity: how many degrees of tilt = full deflection
  range: 22,
}

const isCoarsePointer = (() => {
  try {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
  } catch (_) {
    return false
  }
})()

const handleOrientation = (event) => {
  if (event.gamma == null || event.beta == null) return
  // first reading → calibrate to a neutral pose
  if (orientation.baseGamma == null) {
    orientation.baseGamma = event.gamma
    orientation.baseBeta = event.beta
    return
  }
  const dGamma = event.gamma - orientation.baseGamma
  const dBeta = event.beta - orientation.baseBeta
  const nx = Math.max(-1, Math.min(1, dGamma / orientation.range))
  // beta tilt: tilting top of phone forward (negative beta) should pull cube up
  const ny = Math.max(-1, Math.min(1, dBeta / orientation.range))
  pointer.x = nx
  pointer.y = ny
  pointer.active = true
}

const enableOrientation = () => {
  if (orientation.enabled) return
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return

  const attach = () => {
    window.addEventListener('deviceorientation', handleOrientation, true)
    orientation.enabled = true
  }

  // iOS 13+ permission flow
  const Req = window.DeviceOrientationEvent && window.DeviceOrientationEvent.requestPermission
  if (typeof Req === 'function') {
    Req()
      .then((state) => {
        if (state === 'granted') attach()
      })
      .catch(() => {
        /* user denied or context not supported — silently fall back to touch */
      })
  } else {
    attach()
  }
}

// Try to enable on first user gesture (required for iOS).
if (isCoarsePointer) {
  const oneShotEnable = () => {
    enableOrientation()
    enableMotion()
    window.removeEventListener('touchstart', oneShotEnable, true)
    window.removeEventListener('click', oneShotEnable, true)
  }
  window.addEventListener('touchstart', oneShotEnable, {capture: true, passive: true})
  window.addEventListener('click', oneShotEnable, {capture: true})
}

// Re-calibrate when device orientation changes (portrait <-> landscape)
window.addEventListener('orientationchange', () => {
  orientation.baseGamma = null
  orientation.baseBeta = null
})

/**
 * Device-motion shake-to-spin (mobile easter egg)
 * Compute jitter from `accelerationIncludingGravity`. On a still device the
 * delta between consecutive frames is tiny (~0.5). A real shake produces
 * deltas well above 18 m/s². When that happens, kick `shakeBoost` up to a
 * cap; otherwise it decays back to 1.0 each frame.
 */
const motion = {
  enabled: false,
  lastX: 0, lastY: 0, lastZ: 0,
  hasLast: false,
  // dynamic boost applied to the cube's velocity in animate()
  boost: 1,
  boostTarget: 1,
  // tunables
  threshold: 18,    // m/s² delta needed to register a shake tick
  maxBoost: 7,      // cap multiplier (≈7× rotation speed during a vigorous shake)
  decay: 0.92,      // how fast boost relaxes per ~16ms frame
}

const handleMotion = (event) => {
  const a = event.accelerationIncludingGravity
  if (!a || a.x == null || a.y == null || a.z == null) return
  if (!motion.hasLast) {
    motion.lastX = a.x; motion.lastY = a.y; motion.lastZ = a.z
    motion.hasLast = true
    return
  }
  const dx = a.x - motion.lastX
  const dy = a.y - motion.lastY
  const dz = a.z - motion.lastZ
  motion.lastX = a.x; motion.lastY = a.y; motion.lastZ = a.z
  const delta = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (delta > motion.threshold) {
    // map shake intensity (threshold..40) to (1..maxBoost), additive on top
    const intensity = Math.min(1, (delta - motion.threshold) / 22)
    const target = 1 + intensity * (motion.maxBoost - 1)
    if (target > motion.boostTarget) motion.boostTarget = target
  }
}

const enableMotion = () => {
  if (motion.enabled) return
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return

  const attach = () => {
    window.addEventListener('devicemotion', handleMotion, true)
    motion.enabled = true
  }

  const Req = window.DeviceMotionEvent && window.DeviceMotionEvent.requestPermission
  if (typeof Req === 'function') {
    Req()
      .then((state) => { if (state === 'granted') attach() })
      .catch(() => { /* denied → silently skip */ })
  } else {
    attach()
  }
}

/**
 * Click → ripple + welcome overlay
 */
const overlay = document.querySelector('.welcome-overlay')
const ripple = overlay.querySelector('.welcome-overlay__ripple')
const closeBtn = overlay.querySelector('[data-testid="welcome-close"]')
const hintEl = document.querySelector('.hint')

const triggerWelcome = (clientX, clientY) => {
  if (overlay.classList.contains('is-active')) return
  // position ripple origin
  ripple.style.setProperty('--ripple-x', `${clientX}px`)
  ripple.style.setProperty('--ripple-y', `${clientY}px`)
  // ensure animation restarts: remove + force reflow + add
  overlay.classList.remove('is-active', 'is-revealed', 'is-scrolling-out')
  // eslint-disable-next-line no-unused-expressions
  overlay.offsetHeight
  overlay.classList.add('is-active')
  if (hintEl) hintEl.style.opacity = '0'
  // After the fill completes, kick off the letter animation + show scroll arrow.
  // When a letter effect is active, the parent text fades in fast at speed×1.4s,
  // so we trigger the letter entrance at the SAME instant — no double-motion stutter.
  // Without a letter effect, the parent's natural CSS transition (delay speed×1.85s + 0.7s)
  // handles the entrance and we don't need to fire anything.
  const speed = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ripple-speed').trim() || '1.8')
  const hasLetterFx = overlay.classList.contains('has-letterfx')
  const enterDelay = hasLetterFx
    ? Math.max(400, speed * 1400)             // letter mode — start right when parent reveals
    : Math.max(600, speed * 1850 + 200)       // plain mode — wait until parent fade nearly done
  setTimeout(() => {
    overlay.classList.add('is-revealed')
    playWelcomeEntrance()
    // Hybrid scroll mode: enable body scrolling + reveal about ~600 ms after
    // the letter entrance starts. The user can then scroll naturally; the
    // global scroll listener fires letter exit/entrance at threshold crossings.
    setTimeout(() => { enterAboutScrollMode() }, 600)
  }, enterDelay)
}

const dismissWelcome = () => {
  overlay.classList.remove('is-active', 'is-revealed', 'is-scrolling-out')
  if (hintEl) hintEl.style.opacity = ''
  playWelcomeExit().catch(() => {})
}

// Generic "leave the welcome overlay and reveal a target section"
let _scrolling = false
const _exitOverlay = async () => {
  if (_scrolling) return false
  _scrolling = true
  // Add is-exiting BEFORE the letter-FX exit so the static "Welcome to" + "!"
  // (and sub-heading) animate out in sync with the letter swirl, rather than
  // sitting frozen until the parent slides up.
  overlay.classList.add('is-exiting')
  try { await playWelcomeExit() } catch (_) {}
  overlay.classList.add('is-scrolling-out')
  setTimeout(() => {
    overlay.classList.remove('is-active', 'is-revealed', 'is-scrolling-out', 'is-exiting')
    _scrolling = false
  }, 950)
  return true
}

// === HYBRID Welcome ↔ About scroll ====================================
// The page is a single continuous scroll: welcome is `position: fixed`
// covering the first viewport, about is `position: relative` flowing below
// at `margin-top: 100vh` with z-index higher so it scrolls UP OVER the
// fixed welcome. Letter FX exit fires once when the user scrolls past
// THRESHOLD_DOWN (~30vh); entrance fires once when scrolling back below
// THRESHOLD_UP (~10vh). Welcome stays at full opacity throughout — the
// about's solid background covers the cube as it rises, no flash.

let _aboutFxState = 'entrance' // 'entrance' = welcome letters visible, 'exit' = letters hidden
let _scrollTicking = false

const enterAboutScrollMode = () => {
  // Called once after the welcome entrance animation completes. Reveals
  // about in flow + enables body scroll. Idempotent.
  if (document.body.classList.contains('is-scrollable')) return
  document.documentElement.classList.add('is-scrollable')
  document.body.classList.add('is-scrollable')
  revealAboutSection()
}

const exitAboutScrollMode = () => {
  document.documentElement.classList.remove('is-scrollable')
  document.body.classList.remove('is-scrollable')
  hideAboutSection()
  window.scrollTo({ top: 0, behavior: 'instant' })
  _aboutFxState = 'entrance'
}

const onScrollHybrid = () => {
  if (_scrollTicking) return
  _scrollTicking = true
  requestAnimationFrame(() => {
    _scrollTicking = false
    if (!overlay.classList.contains('is-revealed')) return
    if (!document.body.classList.contains('is-scrollable')) return
    const y = window.scrollY
    const vh = window.innerHeight
    const downAt = vh * 0.30
    const upAt = vh * 0.10
    if (_aboutFxState === 'entrance' && y > downAt) {
      _aboutFxState = 'exit'
      playAboutExit().catch(() => {})
    } else if (_aboutFxState === 'exit' && y < upAt) {
      _aboutFxState = 'entrance'
      playAboutEntrance().catch(() => {})
    }
  })
}
window.addEventListener('scroll', onScrollHybrid, { passive: true })

// Scroll arrow click → smooth scroll down to the about section
const goToAbout = () => {
  enterAboutScrollMode()
  // Two rAFs so display:block + body.is-scrollable settle, then scroll smooth
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const target = document.querySelector('[data-testid="about-section"]')
      if (!target) return
      const top = target.getBoundingClientRect().top + window.scrollY
      try { window.scrollTo({ top, behavior: 'smooth' }) }
      catch (_) { window.scrollTo(0, top) }
    })
  })
  if (window.history && window.history.pushState) {
    try { window.history.pushState({ route: 'about' }, '', '#about') } catch (_) {}
  }
}

// "Past Projects" button → dedicated route (welcome's existing exit + slide-up).
const goToProjects = async () => {
  if (_scrolling) return
  exitAboutScrollMode()
  await _exitOverlay()
  hideAboutSection()
  revealProjectsSection()
  if (window.history && window.history.pushState) {
    try { window.history.pushState({ route: 'projects' }, '', '#projects') } catch (_) {}
  }
}

// Back button on welcome — animate to cube
const backToCube = () => {
  exitAboutScrollMode()
  overlay.classList.remove('is-active', 'is-revealed', 'is-scrolling-out', 'is-exiting')
  if (hintEl) hintEl.style.opacity = ''
  playWelcomeExit().catch(() => {})
}

// Back button on projects/about — return to home (cube + welcome dismissed)
const backToHome = () => {
  hideProjectsSection()
  exitAboutScrollMode()
  overlay.classList.remove('is-active', 'is-revealed', 'is-scrolling-out', 'is-exiting')
  if (hintEl) hintEl.style.opacity = ''
  if (window.history && window.history.pushState) {
    try { window.history.pushState({ route: 'home' }, '', window.location.pathname) } catch (_) {}
  }
}

// "Back" button on About — smooth scroll to top so the welcome letter FX
// entrance plays naturally as the threshold is crossed.
const aboutBackToTop = () => {
  try { window.scrollTo({ top: 0, behavior: 'smooth' }) }
  catch (_) { window.scrollTo(0, 0) }
}

const scrollBtn = overlay.querySelector('[data-testid="welcome-scroll"]')
const projectsBtn = overlay.querySelector('[data-testid="welcome-projects-btn"]')
const welcomeBackBtn = overlay.querySelector('[data-testid="welcome-close"]')
const projectsBackBtn = document.querySelector('[data-testid="projects-back"]')
const aboutBackBtn = document.querySelector('[data-testid="about-back"]')
if (scrollBtn) scrollBtn.addEventListener('click', goToAbout)
if (projectsBtn) projectsBtn.addEventListener('click', goToProjects)
if (welcomeBackBtn) welcomeBackBtn.addEventListener('click', backToCube)
if (projectsBackBtn) projectsBackBtn.addEventListener('click', backToHome)
if (aboutBackBtn) aboutBackBtn.addEventListener('click', aboutBackToTop)

// Hash-deeplink — open /projects or /about directly
window.addEventListener('popstate', (e) => {
  const hash = (window.location.hash || '').replace('#', '')
  if (hash === 'projects') {
    hideAboutSection()
    revealProjectsSection()
  }
  else if (hash === 'about') {
    hideProjectsSection()
    overlay.classList.add('is-active', 'is-revealed')
    enterAboutScrollMode()
  }
  else {
    hideProjectsSection()
    exitAboutScrollMode()
    overlay.classList.remove('is-active', 'is-revealed')
    window.scrollTo({ top: 0 })
  }
})

// In hybrid mode the welcome enables `body.is-scrollable` after the entrance
// completes (see triggerWelcome below). Native scroll then drives everything
// — the global scroll listener (onScrollHybrid) plays the letter FX exit
// when the user crosses ~30vh down and the entrance when crossing back below
// ~10vh. No manual wheel/touch handlers needed for the welcome→about path.

// Touch swipe-up — primary path on mobile (no wheel events)
let _touchStartY = null
overlay.addEventListener('touchstart', (e) => {
  if (!overlay.classList.contains('is-revealed')) return
  if (e.touches && e.touches.length > 0) _touchStartY = e.touches[0].clientY
}, { passive: true })
overlay.addEventListener('touchend', () => { _touchStartY = null }, { passive: true })

// Public API for admin live-preview & published settings
window.__welcomeFx = { applyWelcomeLetterFxSettings, setAboutTransitionSettings }
window.__projects = { fetchAndRenderProjects }
window.__about = { applyAboutSettings }

// Initial render of past projects + about (background prep so they're ready when user navigates)
fetchAndRenderProjects()
;(async () => {
  try {
    const res = await fetch('/api/settings')
    const s = await res.json()
    applyAboutSettings(s)
    setAboutTransitionSettings(s)
  } catch (e) {}
})()

// Hash-deeplink on initial load
const _initialHash = (window.location.hash || '').replace('#', '')
if (_initialHash === 'projects') {
  overlay.classList.remove('is-active', 'is-revealed')
  setTimeout(() => revealProjectsSection(), 100)
} else if (_initialHash === 'about') {
  overlay.classList.add('is-active', 'is-revealed')
  setTimeout(() => {
    enterAboutScrollMode()
    const t = document.querySelector('[data-testid="about-section"]')
    if (t) {
      const top = t.getBoundingClientRect().top + window.scrollY
      try { window.scrollTo({ top, behavior: 'instant' }) } catch (_) { window.scrollTo(0, top) }
    }
  }, 100)
}

stageEl.addEventListener('click', (e) => {
  triggerWelcome(e.clientX, e.clientY)
})

// also trigger on quick tap (in case touchend on mobile didn't fire click)
let touchStart = null
stageEl.addEventListener('touchstart', (e) => {
  if (e.touches.length > 0) {
    touchStart = {x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now()}
  }
}, {passive: true})

stageEl.addEventListener('touchend', (e) => {
  if (!touchStart) return
  const dt = Date.now() - touchStart.t
  const last = e.changedTouches[0]
  if (last && dt < 350) {
    const dx = Math.abs(last.clientX - touchStart.x)
    const dy = Math.abs(last.clientY - touchStart.y)
    if (dx < 12 && dy < 12) {
      triggerWelcome(last.clientX, last.clientY)
    }
  }
  touchStart = null
})

closeBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  dismissWelcome()
})

/**
 * Contact modal
 */
const contactModal = document.querySelector('.contact-modal')
const contactBackdrop = contactModal.querySelector('.contact-modal__backdrop')
const contactCloseBtn = contactModal.querySelector('.contact-modal__close')
const contactForm = contactModal.querySelector('.contact-form')
const contactSuccess = contactModal.querySelector('.contact-form__success')
const contactStatus = contactModal.querySelector('.contact-form__status')
const contactSubmitBtn = contactForm.querySelector('.contact-form__submit')
const contactSubmitLabel = contactSubmitBtn.querySelector('.contact-form__submit-label')

const openContact = () => {
  contactModal.classList.add('is-active')
  contactModal.setAttribute('aria-hidden', 'false')
  // ensure form is visible (if previously success was shown)
  contactForm.hidden = false
  contactSuccess.hidden = true
  setTimeout(() => {
    const firstInput = contactForm.querySelector('input[name="name"]')
    if (firstInput) firstInput.focus()
  }, 300)
}

const closeContact = () => {
  contactModal.classList.remove('is-active')
  contactModal.setAttribute('aria-hidden', 'true')
}

document.querySelector('[data-testid="open-contact-btn"]').addEventListener('click', openContact)
document.querySelector('[data-testid="welcome-contact-btn"]').addEventListener('click', () => {
  dismissWelcome()
  setTimeout(openContact, 200)
})
contactCloseBtn.addEventListener('click', closeContact)
contactBackdrop.addEventListener('click', closeContact)
contactModal.querySelector('[data-testid="contact-success-close"]').addEventListener('click', closeContact)

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (contactModal.classList.contains('is-active')) {
      closeContact()
    } else {
      dismissWelcome()
    }
  }
})

const API_BASE = (typeof window !== 'undefined' && window.__API_BASE__) || ''

const apiUrl = (path) => {
  // If REACT_APP_BACKEND_URL is set at build time we'd inject it, but for this
  // vanilla setup we use same-origin relative routing — Kubernetes ingress
  // routes `/api/*` to the backend on port 8001 automatically.
  return path
}

contactForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  contactStatus.textContent = ''
  const fd = new FormData(contactForm)
  const payload = {
    name: (fd.get('name') || '').toString().trim(),
    email: (fd.get('email') || '').toString().trim(),
    message: (fd.get('message') || '').toString().trim(),
    website: (fd.get('website') || '').toString(),
  }

  // Basic client-side validation
  if (!payload.name || !payload.email || payload.message.length < 4) {
    contactStatus.textContent = 'Please fill in all fields.'
    return
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRe.test(payload.email)) {
    contactStatus.textContent = 'Please enter a valid email.'
    return
  }

  contactSubmitBtn.disabled = true
  const originalLabel = contactSubmitLabel.textContent
  contactSubmitLabel.textContent = 'Sending…'

  try {
    const res = await fetch(apiUrl('/api/contact'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      let detail = 'Something went wrong. Please try again.'
      try {
        const err = await res.json()
        if (err && err.detail) detail = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
      } catch (_) { /* ignore */ }
      throw new Error(detail)
    }
    // Success
    contactForm.reset()
    contactForm.hidden = true
    contactSuccess.hidden = false
  } catch (err) {
    contactStatus.textContent = err.message || 'Network error — please try again.'
  } finally {
    contactSubmitBtn.disabled = false
    contactSubmitLabel.textContent = originalLabel
  }
})

/**
 * Fbos
 */
const displacementFbo = regl.framebuffer()
const maskFbo = regl.framebuffer()
const contentFbo = regl.framebuffer()
const reflectionFbo = regl.framebufferCube(1024)

/**
 * Textures
 * Logo texture is shared across the 3 logo faces (single GPU resource, reloads
 * cheaply). text-1 and text-2 each have their own.
 */
const logoTexture = Texture(regl, 'logo.png')
const text1Texture = Texture(regl, 'text-1.png')
const text2Texture = Texture(regl, 'text-2.png')

const textures = [
  { texture: logoTexture,  typeId: ContentTypes.RAINBOW, maskId: CubeMasks.M1 },
  { texture: logoTexture,  typeId: ContentTypes.BLUE,    maskId: CubeMasks.M2 },
  { texture: logoTexture,  typeId: ContentTypes.RED,     maskId: CubeMasks.M3 },
  { texture: text1Texture, typeId: ContentTypes.BLUE,    maskId: CubeMasks.M4 },
  { texture: text2Texture, typeId: ContentTypes.RED,     maskId: CubeMasks.M5 },
]

/**
 * Tick accumulator — we drive auto-rotation manually so we can vary speed
 * without breaking the visual continuity (preventing jumps when speed changes).
 */
let phase = 0

const lerp = (a, b, t) => a + (b - a) * t

const animate = ({viewportWidth, viewportHeight}) => {
  stats.begin()

  // Smooth pointer state (frame-rate-ish independent enough for 60fps preview)
  pointer.smX = lerp(pointer.smX, pointer.x, 0.08)
  pointer.smY = lerp(pointer.smY, pointer.y, 0.08)
  pointer.smActive = lerp(pointer.smActive, pointer.active ? 1 : 0, 0.06)

  // Distance from center (0 = center, 1 = edge of stage)
  const distFromCenter = Math.min(1, Math.hypot(pointer.smX, pointer.smY))

  // Slow-down factor: when active and near center → speed multiplier ~0.25,
  // far from center → ~1.0, when not active → 1.0
  const proximityToCenter = pointer.smActive * (1 - distFromCenter)
  const speedMultiplier = lerp(1.0, 0.22, proximityToCenter)

  // Parallax on camera position — gentle, only when pointer is active
  const parallaxStrength = 0.45 * pointer.smActive
  const cameraX = CONFIG.cameraX + pointer.smX * parallaxStrength
  const cameraY = CONFIG.cameraY - pointer.smY * parallaxStrength
  const cameraZ = CONFIG.cameraZ

  // Advance phase based on current speed multiplier × shake boost
  // boost decays toward boostTarget; boostTarget itself decays toward 1.
  motion.boost = lerp(motion.boost, motion.boostTarget, 0.18)
  motion.boostTarget = Math.max(1, motion.boostTarget * motion.decay)
  phase += CONFIG.velocity * speedMultiplier * motion.boost

  /**
   * Resize Fbos
   */
  displacementFbo.resize(viewportWidth, viewportHeight)
  maskFbo.resize(viewportWidth, viewportHeight)
  contentFbo.resize(viewportWidth, viewportHeight)

  /**
   * Rotation Matrix
   */
  const factor = phase
  const rotationMatrix = mat4.create()

  mat4.rotate(rotationMatrix, rotationMatrix, CONFIG.rotation, [CONFIG.rotateX, CONFIG.rotateY, CONFIG.rotateZ])
  mat4.rotate(rotationMatrix, rotationMatrix, factor, [Math.cos(factor), Math.sin(factor), 0.5])

  /**
   * Camera config
   */
  const cameraConfig = {
    eye: [cameraX, cameraY, cameraZ],
    target: [0, 0, 0],
  }

  /**
   * Clear context
   */
  regl.clear({
    color: [0, 0, 0, 0],
    depth: 1,
  })

  camera(cameraConfig, () => {
    cube([
      {
        fbo: displacementFbo,
        cullFace: CubeFaces.BACK,
        typeId: CubeTypes.DISPLACEMENT,
        matrix: rotationMatrix,
      },
      {
        fbo: maskFbo,
        cullFace: CubeFaces.BACK,
        typeId: CubeTypes.MASK,
        matrix: rotationMatrix,
      },
    ])

    contentFbo.use(() => {
      content({
        textures,
        displacement: displacementFbo,
        mask: maskFbo,
      })
    })
  })

  reflection({
    reflectionFbo,
    cameraConfig,
    rotationMatrix,
    texture: contentFbo,
  })

  camera(cameraConfig, () => {
    cube([
      {
        cullFace: CubeFaces.FRONT,
        typeId: CubeTypes.FINAL,
        reflection: reflectionFbo,
        matrix: rotationMatrix,
      },
      {
        cullFace: CubeFaces.BACK,
        typeId: CubeTypes.FINAL,
        texture: contentFbo,
        matrix: rotationMatrix,
      },
    ])
  })

  stats.end()
}

const init = () => {
  play(animate)
  // Admin panel — login, settings, live preview, publish.
  // Receives our shared GPU textures so admin edits hot-swap them in place.
  initAdmin({ logoTexture, text1Texture, text2Texture })
}

init()
