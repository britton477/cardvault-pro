// =============================================================================
// CardVault Pro — Client-side image utilities
//
// resizeImageToBase64: Shrinks an image to at most MAX_DIM on its longest side
// using the Canvas API, encodes to JPEG at QUALITY, and returns a raw base64
// string (no "data:image/…" prefix). This is run entirely in the browser —
// no server round-trip until the result is sent to the identify endpoint.
//
// Typical savings: 4 MB phone JPEG → ~80 KB = 50× smaller Anthropic payload.
// =============================================================================

const MAX_DIM = 800
const QUALITY = 0.72

/**
 * Resize a File/Blob to at most MAX_DIM px on its longest side, encode as JPEG,
 * and return a raw base64 string (no data-URL prefix).
 *
 * Browser-only — uses HTMLCanvasElement. Safe to call from React event handlers.
 */
export function resizeImageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url) // release the object URL immediately

      // Compute scaled dimensions, preserving aspect ratio
      let { width, height } = img
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width >= height) {
          height = Math.round((height / width)  * MAX_DIM)
          width  = MAX_DIM
        } else {
          width  = Math.round((width  / height) * MAX_DIM)
          height = MAX_DIM
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width  = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canvas 2D context unavailable'))

      ctx.drawImage(img, 0, 0, width, height)

      // toDataURL returns "data:image/jpeg;base64,<data>" — strip the prefix
      const dataUrl = canvas.toDataURL('image/jpeg', QUALITY)
      const base64  = dataUrl.split(',')[1]
      if (!base64) return reject(new Error('Failed to encode image'))

      resolve(base64)
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image for resizing'))
    }

    img.src = url
  })
}

/**
 * Read a File as a data-URL (for preview thumbnails).
 * Unlike resizeImageToBase64, this preserves the full image and includes the
 * data-URL prefix, making it suitable for <img src={...}> without further processing.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
