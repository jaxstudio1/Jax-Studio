/**
 * welcomeFx — manages the decorative letter animation on the welcome overlay
 * and the scroll-down → projects transition.
 *
 * - Holds Word instances for the heading (.welcome-overlay__brand) and
 *   optionally the sub-heading (.welcome-overlay__sub).
 * - Knows how to (re)build them from current admin settings.
 * - Plays show/hide animations from the codrops EFFECT_PRESETS.
 */
import { Word } from './letterFx/wordFx'
import { EFFECT_PRESETS, customizeEffect } from './letterFx/effects'

const PRESET_BY_NAME = Object.fromEntries(EFFECT_PRESETS.map((p) => [p.name, p]))

const overlay = document.querySelector('.welcome-overlay')
const headingEl = overlay && overlay.querySelector('.welcome-overlay__brand')
const subEl = overlay && overlay.querySelector('.welcome-overlay__sub')

let _state = {
  effectName: null,            // null = no letter animation
  speedMul: 1.0,
  staggerMs: 0,                // 0 = use preset
  density: 'normal',
  shapesMode: 'mix',           // 'mix' | 'circle' | 'rect' | 'polygon'
  fill: true,
  useAccent: false,
  applyTo: 'heading',          // 'heading' | 'sub' | 'both'
}

let _headingWord = null
let _subWord = null
let _origHeading = null  // raw text fallback
let _origSub = null

const captureOriginal = () => {
  if (headingEl && _origHeading === null) {
    // strip the !-span and store text + bang separately
    const bang = headingEl.querySelector('.welcome-overlay__bang')
    const bangText = bang ? bang.textContent : ''
    const headingText = headingEl.textContent.replace(bangText, '').trim()
    _origHeading = { text: headingText, bang: bangText }
  }
  if (subEl && _origSub === null) {
    _origSub = subEl.textContent
  }
}

const restorePlainHeading = () => {
  if (!headingEl) return
  if (_headingWord) { _headingWord.destroy(); _headingWord = null }
  captureOriginal()
  headingEl.classList.remove('is-letterfx')
  headingEl.innerHTML = `${_origHeading.text}<span class="welcome-overlay__bang">${_origHeading.bang}</span>`
}

const restorePlainSub = () => {
  if (!subEl) return
  if (_subWord) { _subWord.destroy(); _subWord = null }
  captureOriginal()
  subEl.textContent = _origSub
}

const restoreAll = () => {
  restorePlainHeading()
  restorePlainSub()
}

/** Pick the shapeTypes array based on the user's choice. */
const resolveShapeTypes = (mode) => {
  if (mode === 'circle') return ['circle']
  if (mode === 'rect') return ['rect']
  if (mode === 'polygon') return ['polygon']
  return ['circle', 'rect', 'polygon']
}

/** Resolve an effect config from current state (returns null if effect disabled). */
const resolveEffect = () => {
  if (!_state.effectName) return null
  const preset = PRESET_BY_NAME[_state.effectName]
  if (!preset) return null
  const overrides = {
    speedMul: _state.speedMul,
    stagger: _state.staggerMs > 0 ? _state.staggerMs : null,
    shapeTypes: resolveShapeTypes(_state.shapesMode),
    shapeFill: _state.fill,
    density: _state.density,
  }
  if (_state.useAccent) {
    const accent = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#ff5722').trim()
    overrides.shapeColors = [accent, '#ffffff', '#1a1a1c']
  }
  return customizeEffect(preset, overrides)
}

/**
 * Apply current state — destroys existing Word instances and re-creates
 * Word for the relevant elements with the chosen effect's options.
 */
export const applyWelcomeLetterFxSettings = (settings = {}) => {
  Object.assign(_state, {
    effectName: settings.welcome_letter_effect || null,
    speedMul: typeof settings.welcome_letter_speed === 'number' ? settings.welcome_letter_speed : 1.0,
    staggerMs: typeof settings.welcome_letter_stagger === 'number' ? settings.welcome_letter_stagger : 0,
    density: settings.welcome_letter_density || 'normal',
    shapesMode: settings.welcome_letter_shapes || 'mix',
    fill: typeof settings.welcome_letter_fill === 'boolean' ? settings.welcome_letter_fill : true,
    useAccent: typeof settings.welcome_letter_use_accent === 'boolean' ? settings.welcome_letter_use_accent : false,
    applyTo: settings.welcome_letter_apply_to || 'heading',
  })
  // Always tear down before rebuilding
  restoreAll()
  if (!_state.effectName) return  // plain markup only
  const effect = resolveEffect()
  if (!effect) return
  // Build Word for chosen targets
  if ((_state.applyTo === 'heading' || _state.applyTo === 'both') && headingEl) {
    captureOriginal()
    headingEl.classList.add('is-letterfx')
    // Charming will split the title text into per-letter spans.
    // Keep the orange "!" as a separate, un-split sibling that doesn't animate
    // (otherwise charming would split it too and lose the .welcome-overlay__bang class).
    // Replace ASCII spaces with NBSP so charming doesn't collapse them between inline-block spans.
    headingEl.innerHTML = (_origHeading.text || '').replace(/ /g, '\u00a0')
    _headingWord = new Word(headingEl, effect.options)
    Array.from(headingEl.querySelectorAll('span')).forEach((s) => { s.style.opacity = 0 })
    if (_origHeading.bang) {
      const bang = document.createElement('span')
      bang.className = 'welcome-overlay__bang'
      bang.textContent = _origHeading.bang
      headingEl.appendChild(bang)
    }
  }
  if ((_state.applyTo === 'sub' || _state.applyTo === 'both') && subEl) {
    captureOriginal()
    subEl.textContent = (_origSub || '').replace(/ /g, '\u00a0')
    _subWord = new Word(subEl, Object.assign({}, effect.options, { totalShapes: Math.round((effect.options.totalShapes || 10) * 0.6) }))
    Array.from(subEl.querySelectorAll('span')).forEach((s) => { s.style.opacity = 0 })
  }
}

/** Run the entrance animation on the currently configured elements. */
export const playWelcomeEntrance = () => {
  if (!_state.effectName) return Promise.resolve()
  const effect = resolveEffect()
  if (!effect || !effect.show) return Promise.resolve()
  const promises = []
  if (_headingWord) promises.push(_headingWord.show(effect.show))
  if (_subWord) promises.push(_subWord.show(effect.show))
  return Promise.all(promises)
}

/** Run the exit animation. Resolves when done. */
export const playWelcomeExit = () => {
  if (!_state.effectName) return Promise.resolve()
  const effect = resolveEffect()
  if (!effect || !effect.hide) return Promise.resolve()
  const promises = []
  if (_headingWord) promises.push(_headingWord.hide(effect.hide))
  if (_subWord) promises.push(_subWord.hide(effect.hide))
  return Promise.all(promises)
}
