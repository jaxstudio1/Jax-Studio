/**
 * Returns a regl texture that can be reloaded later by calling
 * reload(srcOrHTMLImage). On first call we still load the bundled asset
 * so the cube has a default texture before the public settings arrive.
 */
export default (regl, src) => {
  const texture = regl.texture()

  const apply = (image) => {
    try {
      texture({ data: image, flipY: true, min: 'mipmap' })
    } catch (err) {
      // pad to power-of-two if needed (regl is forgiving but mipmap requires it)
      try {
        texture({ data: image, flipY: true })
      } catch (err2) {
        // eslint-disable-next-line no-console
        console.warn('Texture upload failed', err2)
      }
    }
  }

  const loadFromUrl = (url) => new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      apply(image)
      resolve(image)
    }
    image.onerror = (e) => reject(e)
    image.src = url
  })

  // Initial bundled load via webpack file-loader
  if (src) {
    const image = new Image()
    image.src = require(`~assets/${src}`)
    image.onload = () => apply(image)
  }

  // Public method: swap the texture data with a URL or canvas element.
  texture.reload = (urlOrCanvas) => {
    if (urlOrCanvas instanceof HTMLCanvasElement || urlOrCanvas instanceof HTMLImageElement) {
      apply(urlOrCanvas)
      return Promise.resolve(urlOrCanvas)
    }
    if (typeof urlOrCanvas === 'string') {
      return loadFromUrl(urlOrCanvas)
    }
    return Promise.reject(new Error('Texture.reload: expected string URL or Canvas/Image element'))
  }

  return texture
}
