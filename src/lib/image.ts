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

// 1200px gives the vision model ~50% more pixels on each axis versus 800px.
// The bottom-left set code text on modern Pokémon cards is tiny (~2mm on a real
// card); at 800px it renders ~16px tall — hard to OCR reliably. At 1200px it's
// ~24px, which is meaningfully better without ballooning the payload.
const MAX_DIM = 1200
const QUALITY = 0.75

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
 * Read a File or Blob as a data-URL (for preview thumbnails and crop output).
 * Includes the data-URL prefix, making it suitable for <img src={...}>.
 */
export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Convert a base64 data-URL back into a File object.
 *
 * Two uses:
 *   1. Feed a scanned card's data-URL preview into CropModal (file mode)
 *   2. Convert cropped/scanned images to File for the /api/images/upload route
 *
 * Browser-only — uses atob. Safe to call from React event handlers / hooks.
 */
export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, base64] = dataUrl.split(',')
  const mime    = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg'
  const binary  = atob(base64)
  const bytes   = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], filename, { type: mime })
}
