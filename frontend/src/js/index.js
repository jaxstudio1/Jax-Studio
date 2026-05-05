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
 * Click → ripple + welcome overlay
 */
const overlay = document.querySelector('.welcome-overlay')
const ripple = overlay.querySelector('.welcome-overlay__ripple')
const closeBtn = overlay.querySelector('.welcome-overlay__close')
const hintEl = document.querySelector('.hint')

const triggerWelcome = (clientX, clientY) => {
  if (overlay.classList.contains('is-active')) return
  // position ripple origin
  ripple.style.setProperty('--ripple-x', `${clientX}px`)
  ripple.style.setProperty('--ripple-y', `${clientY}px`)
  // ensure animation restarts: remove + force reflow + add
  overlay.classList.remove('is-active')
  // eslint-disable-next-line no-unused-expressions
  overlay.offsetHeight
  overlay.classList.add('is-active')
  if (hintEl) hintEl.style.opacity = '0'
}

const dismissWelcome = () => {
  overlay.classList.remove('is-active')
  if (hintEl) hintEl.style.opacity = ''
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismissWelcome()
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
 */
const textures = [
  {
    texture: Texture(regl, 'logo.png'),
    typeId: ContentTypes.RAINBOW,
    maskId: CubeMasks.M1,
  },
  {
    texture: Texture(regl, 'logo.png'),
    typeId: ContentTypes.BLUE,
    maskId: CubeMasks.M2,
  },
  {
    texture: Texture(regl, 'logo.png'),
    typeId: ContentTypes.RED,
    maskId: CubeMasks.M3,
  },
  {
    texture: Texture(regl, 'text-1.png'),
    typeId: ContentTypes.BLUE,
    maskId: CubeMasks.M4,
  },
  {
    texture: Texture(regl, 'text-2.png'),
    typeId: ContentTypes.RED,
    maskId: CubeMasks.M5,
  },
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

  // Advance phase based on current speed multiplier
  phase += CONFIG.velocity * speedMultiplier

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
}

init()
