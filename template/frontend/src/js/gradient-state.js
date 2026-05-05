/**
 * Mutable cube gradient color state.
 *
 * The content fragment shader reads its gradient colors from these values
 * via `regl.prop`-style uniforms. Mutating any field is enough — the next
 * frame rendered by `play()` picks them up. This keeps the change cost at
 * ~zero and avoids recompiling shaders.
 */

// Default palette = the original Apple-Fifth-Avenue look.
// gradient1 → 4-color radial used on the "hero" RAINBOW logo face
// gradient2 → 2-color used on a logo face + the "COMING" text face
// gradient3 → 2-color used on a logo face + the "SOON" text face
// outline   → 5-color used on the cube wireframe edges (radial-rainbow.glsl)
//             NOTE: outline_* are vec4 (RGBA, alpha = 1.0)
export const DEFAULT_GRADIENT = {
  g1c1: [0.98, 0.71, 0.0],
  g1c2: [0.95, 0.20, 0.14],
  g1c3: [0.89, 0.12, 0.78],
  g1c4: [0.30, 0.24, 0.96],
  g2c1: [1.00, 0.80, 0.20],
  g2c2: [0.92, 0.20, 0.14],
  g3c1: [0.89, 0.12, 0.78],
  g3c2: [0.29, 0.68, 0.95],
  outline_a: [0.15, 0.58, 0.96, 1.0],
  outline_b: [0.29, 1.00, 0.55, 1.0],
  outline_c: [1.00, 0.00, 0.85, 1.0],
  outline_d: [0.92, 0.20, 0.14, 1.0],
  outline_e: [1.00, 0.96, 0.32, 1.0],
}

// Current state (mutable, read each frame). Frozen-shape, mutable values.
export const gradientState = { ...DEFAULT_GRADIENT }

export const setGradientState = (next) => {
  Object.assign(gradientState, next)
}

export const resetGradientState = () => {
  Object.assign(gradientState, DEFAULT_GRADIENT)
}

// Helpers — convert hex (#rrggbb) → [r,g,b] in 0-1
export const hexToVec3 = (hex) => {
  if (!hex || typeof hex !== 'string') return [1, 1, 1]
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return [
    Number.isFinite(r) ? r : 1,
    Number.isFinite(g) ? g : 1,
    Number.isFinite(b) ? b : 1,
  ]
}

export const vec3ToHex = (v) => {
  const to = (x) => {
    const n = Math.max(0, Math.min(255, Math.round(x * 255)))
    return n.toString(16).padStart(2, '0')
  }
  return `#${to(v[0])}${to(v[1])}${to(v[2])}`.toUpperCase()
}

const toRGBA = (v3) => [v3[0], v3[1], v3[2], 1.0]

/**
 * Build the 5-stop outline rainbow from the preset's existing 8 color stops.
 * Picks distinct, well-spaced colors from across the palette so the wireframe
 * still feels rainbowy but matches the preset's mood.
 */
const deriveOutline = (g) => ({
  outline_a: toRGBA(g.g3c2),
  outline_b: toRGBA(g.g1c1),
  outline_c: toRGBA(g.g3c1 || g.g1c3),
  outline_d: toRGBA(g.g2c2 || g.g1c2),
  outline_e: toRGBA(g.g1c4),
})

const presetWithOutline = (g) => ({ ...g, ...deriveOutline(g) })

/**
 * Curated gradient presets. Each preset defines all 8 color stops.
 * Two-color override (Color A, Color B) lets the user re-tint gradient2
 * and gradient3 over any preset.
 */
export const GRADIENT_PRESETS = [
  {
    id: 'default',
    name: 'Original — apple rainbow',
    colors: { ...DEFAULT_GRADIENT },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    colors: presetWithOutline({
      g1c1: hexToVec3('#fef3c7'),
      g1c2: hexToVec3('#fb923c'),
      g1c3: hexToVec3('#ec4899'),
      g1c4: hexToVec3('#7c3aed'),
      g2c1: hexToVec3('#fbbf24'),
      g2c2: hexToVec3('#dc2626'),
      g3c1: hexToVec3('#f472b6'),
      g3c2: hexToVec3('#7c3aed'),
    }),
  },
  {
    id: 'ocean',
    name: 'Ocean',
    colors: presetWithOutline({
      g1c1: hexToVec3('#a7f3d0'),
      g1c2: hexToVec3('#22d3ee'),
      g1c3: hexToVec3('#3b82f6'),
      g1c4: hexToVec3('#1e1b4b'),
      g2c1: hexToVec3('#67e8f9'),
      g2c2: hexToVec3('#1d4ed8'),
      g3c1: hexToVec3('#06b6d4'),
      g3c2: hexToVec3('#0f172a'),
    }),
  },
  {
    id: 'mono-white',
    name: 'Mono — white',
    colors: presetWithOutline({
      g1c1: hexToVec3('#ffffff'),
      g1c2: hexToVec3('#d4d4d4'),
      g1c3: hexToVec3('#a3a3a3'),
      g1c4: hexToVec3('#525252'),
      g2c1: hexToVec3('#ffffff'),
      g2c2: hexToVec3('#737373'),
      g3c1: hexToVec3('#e5e5e5'),
      g3c2: hexToVec3('#404040'),
    }),
  },
  {
    id: 'acid',
    name: 'Acid',
    colors: presetWithOutline({
      g1c1: hexToVec3('#a3e635'),
      g1c2: hexToVec3('#22d3ee'),
      g1c3: hexToVec3('#fde047'),
      g1c4: hexToVec3('#f43f5e'),
      g2c1: hexToVec3('#bef264'),
      g2c2: hexToVec3('#0ea5e9'),
      g3c1: hexToVec3('#fde047'),
      g3c2: hexToVec3('#e11d48'),
    }),
  },
  {
    id: 'vaporwave',
    name: 'Vaporwave',
    colors: presetWithOutline({
      g1c1: hexToVec3('#fbcfe8'),
      g1c2: hexToVec3('#f0abfc'),
      g1c3: hexToVec3('#a78bfa'),
      g1c4: hexToVec3('#22d3ee'),
      g2c1: hexToVec3('#f9a8d4'),
      g2c2: hexToVec3('#7c3aed'),
      g3c1: hexToVec3('#22d3ee'),
      g3c2: hexToVec3('#9333ea'),
    }),
  },
  {
    id: 'noir',
    name: 'Noir — punch of accent',
    colors: presetWithOutline({
      g1c1: hexToVec3('#fafafa'),
      g1c2: hexToVec3('#525252'),
      g1c3: hexToVec3('#0a0a0a'),
      g1c4: hexToVec3('#ff5722'),
      g2c1: hexToVec3('#ffffff'),
      g2c2: hexToVec3('#ff5722'),
      g3c1: hexToVec3('#0a0a0a'),
      g3c2: hexToVec3('#fafafa'),
    }),
  },
  {
    id: 'forest',
    name: 'Forest',
    colors: presetWithOutline({
      g1c1: hexToVec3('#bbf7d0'),
      g1c2: hexToVec3('#22c55e'),
      g1c3: hexToVec3('#15803d'),
      g1c4: hexToVec3('#1f2937'),
      g2c1: hexToVec3('#a7f3d0'),
      g2c2: hexToVec3('#065f46'),
      g3c1: hexToVec3('#fde68a'),
      g3c2: hexToVec3('#166534'),
    }),
  },
]

/**
 * Build the next gradient state from a preset id + optional color A / B
 * overrides (which replace the dominant tones of gradient2 / gradient3 and
 * also bleed into the wireframe outline so the cube stays cohesive).
 */
export const composeGradient = (presetId, colorAHex, colorBHex) => {
  const preset = GRADIENT_PRESETS.find((p) => p.id === presetId) || GRADIENT_PRESETS[0]
  const next = { ...preset.colors }
  if (colorAHex) {
    const a = hexToVec3(colorAHex)
    next.g2c2 = a
    next.g1c2 = a
    next.outline_b = toRGBA(a)
    next.outline_d = toRGBA(a)
  }
  if (colorBHex) {
    const b = hexToVec3(colorBHex)
    next.g3c1 = b
    next.g1c3 = b
    next.outline_a = toRGBA(b)
    next.outline_c = toRGBA(b)
  }
  return next
}
