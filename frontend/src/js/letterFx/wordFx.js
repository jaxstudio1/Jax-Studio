/**
 * wordFx — adapted from codrops/DecorativeLetterAnimations (MIT-licensed)
 * Original by Codrops (Manoela Ilic), 2018.
 * https://github.com/codrops/DecorativeLetterAnimations
 *
 * Adapted to ES modules: imports anime.js + charming directly (no globals).
 * Adds a `density` multiplier so we can control the number of decorative shapes per letter.
 */

// anime.js v3 — webpack 4 + babel-loader interop quirks: handle both shapes
const _animeImported = require('animejs')
const anime = (typeof _animeImported === 'function')
  ? _animeImported
  : (_animeImported && typeof _animeImported.default === 'function')
    ? _animeImported.default
    : _animeImported
import charming from 'charming'

const debounce = (func, wait, immediate) => {
  let timeout
  return function () {
    const ctx = this
    const args = arguments
    const later = () => {
      timeout = null
      if (!immediate) func.apply(ctx, args)
    }
    const callNow = immediate && !timeout
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
    if (callNow) func.apply(ctx, args)
  }
}

const randomBetween = (min, max, precision = 2) => {
  return parseFloat(Math.min(min + Math.random() * (max - min), max).toFixed(precision))
}

let winsize = { width: window.innerWidth, height: window.innerHeight }

class Shape {
  constructor(type, letterRect, options) {
    this.DOM = {}
    this.options = {
      shapeTypes: ['circle', 'rect', 'polygon'],
      shapeColors: ['#e07272', '#0805b5', '#49c6ff', '#8bc34a', '#1e1e21', '#e24e81', '#e0cd24'],
      shapeFill: true,
      shapeStrokeWidth: 1,
      types: ['circle', 'rect', 'polygon'],
    }
    Object.assign(this.options, options)
    this.type = type || this.options.shapeTypes[0]
    if (this.type !== 'random' && !this.options.types.includes(this.type)) return
    if (this.type === 'random') {
      this.type = this.options.shapeTypes[randomBetween(0, this.options.shapeTypes.length - 1, 0)]
    }
    this.letterRect = letterRect
    this.init()
  }
  init() {
    this.DOM.el = document.createElementNS('http://www.w3.org/2000/svg', this.type)
    this.DOM.el.style.opacity = 0
    this.configureShapeType()
    if (this.options.shapeFill) {
      this.DOM.el.setAttribute('fill', this.options.shapeColors[randomBetween(0, this.options.shapeColors.length - 1, 0)])
    } else {
      this.DOM.el.setAttribute('fill', 'none')
      this.DOM.el.setAttribute('stroke-width', this.options.shapeStrokeWidth)
      this.DOM.el.setAttribute('stroke', this.options.shapeColors[randomBetween(0, this.options.shapeColors.length - 1, 0)])
    }
  }
  configureShapeType() {
    const lr = this.letterRect
    this.DOM.el.style.transformOrigin = `${lr.left + lr.width / 2}px ${lr.top + lr.height / 2}px`
    if (this.type === 'circle') {
      const r = 0.5 * lr.width
      this.DOM.el.setAttribute('r', r)
      this.DOM.el.setAttribute('cx', lr.left + lr.width / 2)
      this.DOM.el.setAttribute('cy', lr.top + lr.height / 2)
    } else if (this.type === 'rect') {
      const w = randomBetween(0.05, 0.5, 3) * lr.width
      const h = randomBetween(0.05, 0.5, 3) * lr.height
      this.DOM.el.setAttribute('width', w)
      this.DOM.el.setAttribute('height', h)
      this.DOM.el.setAttribute('x', lr.left + (lr.width - w) / 2)
      this.DOM.el.setAttribute('y', lr.top + (lr.height - h) / 2)
    } else if (this.type === 'polygon') {
      this.DOM.el.setAttribute('points', `${lr.left} ${lr.top + lr.height}, ${lr.left + lr.width / 2} ${lr.bottom - lr.width}, ${lr.left + lr.width} ${lr.top + lr.height}`)
    }
  }
  onResize(letterRect) {
    this.letterRect = letterRect
    this.configureShapeType()
  }
}

class Letter {
  constructor(el, svg, options) {
    this.DOM = { el, svg }
    this.options = { totalShapes: 10 }
    Object.assign(this.options, options)
    this.rect = this.DOM.el.getBoundingClientRect()
    this.totalShapes = this.options.totalShapes
    this.init()
    this.initEvents()
  }
  init() {
    this.shapes = []
    for (let i = 0; i <= this.totalShapes - 1; ++i) {
      const shape = new Shape('random', this.rect, this.options)
      this.shapes.push(shape)
      this.DOM.svg.appendChild(shape.DOM.el)
    }
  }
  initEvents() {
    this._resizeHandler = debounce(() => {
      this.rect = this.DOM.el.getBoundingClientRect()
      for (let i = 0; i <= this.totalShapes - 1; ++i) {
        this.shapes[i].onResize(this.rect)
      }
    }, 20)
    window.addEventListener('resize', this._resizeHandler)
  }
  destroy() {
    window.removeEventListener('resize', this._resizeHandler)
    this.shapes.forEach((s) => s.DOM.el.remove())
  }
}

export class Word {
  constructor(el, options) {
    this.DOM = { el }
    this.options = { shapesOnTop: false }
    Object.assign(this.options, options)
    this.init()
    this.initEvents()
  }
  init() {
    this.createSVG()
    charming(this.DOM.el)
    this.letters = []
    Array.from(this.DOM.el.querySelectorAll('span')).forEach((letter) => {
      this.letters.push(new Letter(letter, this.DOM.svg, this.options))
    })
  }
  initEvents() {
    this._resizeHandler = debounce(() => {
      winsize = { width: window.innerWidth, height: window.innerHeight }
      this.DOM.svg.setAttribute('width', `${winsize.width}px`)
      this.DOM.svg.setAttribute('height', `${winsize.height}px`)
      this.DOM.svg.setAttribute('viewBox', `0 0 ${winsize.width} ${winsize.height}`)
    }, 20)
    window.addEventListener('resize', this._resizeHandler)
  }
  createSVG() {
    this.DOM.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.DOM.svg.setAttribute('class', 'shapes')
    this.DOM.svg.setAttribute('width', `${winsize.width}px`)
    this.DOM.svg.setAttribute('height', `${winsize.height}px`)
    this.DOM.svg.setAttribute('viewBox', `0 0 ${winsize.width} ${winsize.height}`)
    this.DOM.svg.style.position = 'absolute'
    this.DOM.svg.style.inset = '0'
    this.DOM.svg.style.pointerEvents = 'none'
    this.DOM.svg.style.zIndex = this.options.shapesOnTop ? '3' : '1'
    if (this.options.shapesOnTop) {
      this.DOM.el.parentNode.insertBefore(this.DOM.svg, this.DOM.el.nextSibling)
    } else {
      this.DOM.el.parentNode.insertBefore(this.DOM.svg, this.DOM.el)
    }
  }
  show(config) {
    return this.toggle('show', config)
  }
  hide(config) {
    return this.toggle('hide', config)
  }
  toggle(action = 'show', config) {
    return new Promise((resolve) => {
      const toggleNow = () => {
        for (let i = 0; i < this.letters.length; ++i) {
          this.letters[i].DOM.el.style.opacity = action === 'show' ? 1 : 0
        }
        resolve()
      }
      if (config && Object.keys(config).length !== 0) {
        if (config.shapesAnimationOpts) {
          for (let i = 0; i < this.letters.length; ++i) {
            const letter = this.letters[i]
            const stagger = config.lettersAnimationOpts && config.lettersAnimationOpts.delay
              ? config.lettersAnimationOpts.delay(letter.DOM.el, i)
              : 0
            setTimeout(((l) => () => {
              const opts = Object.assign({}, config.shapesAnimationOpts)
              opts.targets = l.shapes.map((s) => s.DOM.el)
              anime.remove(opts.targets)
              anime(opts)
            })(letter), stagger)
          }
        }
        if (config.lettersAnimationOpts) {
          const opts = Object.assign({}, config.lettersAnimationOpts)
          opts.targets = this.letters.map((l) => l.DOM.el)
          opts.complete = () => {
            if (action === 'hide') {
              for (let i = 0; i < opts.targets.length; ++i) {
                opts.targets[i].style.transform = 'none'
              }
            }
            resolve()
          }
          anime(opts)
        } else {
          toggleNow()
        }
      } else {
        toggleNow()
      }
    })
  }
  destroy() {
    window.removeEventListener('resize', this._resizeHandler)
    if (this.DOM.svg && this.DOM.svg.parentNode) this.DOM.svg.parentNode.removeChild(this.DOM.svg)
    this.letters.forEach((l) => l.destroy())
    this.letters = []
  }
}
