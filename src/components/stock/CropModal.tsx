'use client'
// =============================================================================
// CropModal — browser-native image cropper. Zero dependencies.
//
// TWO MODES:
//   file     — src is a blob: URL (same-origin). Apply draws to canvas → Blob.
//              Used for NEW photos before they've been uploaded.
//   existing — src is an external URL (R2 / Supabase). Apply returns percentage
//              crop coordinates; the server crops & re-uploads via PATCH endpoint.
//              Canvas is never tainted — no CORS issue.
//
// Crop UI:
//   SVG overlay creates the dark mask outside the crop rect (clean, no overflow).
//   Corner handles (4) for resize. Body drag to move.
//   Global mouse listeners capture drags that leave the modal.
// =============================================================================
import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Crop, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CropCoords {
  x:      number   // fraction 0–1 of natural image width
  y:      number
  width:  number
  height: number
}

type DragType = 'move' | 'nw' | 'ne' | 'sw' | 'se'

interface Rect { x: number; y: number; w: number; h: number }

interface BaseCropModalProps {
  open:      boolean
  onCancel:  () => void
  title?:    string
}

interface FileModeProps extends BaseCropModalProps {
  mode:          'file'
  file:          File
  onConfirmFile: (blob: Blob) => void
}

interface ExistingModeProps extends BaseCropModalProps {
  mode:             'existing'
  photoUrl:         string
  onConfirmCrop:    (coords: CropCoords) => void
}

type CropModalProps = FileModeProps | ExistingModeProps

const MIN_CROP_PX = 30

// ── Component ─────────────────────────────────────────────────────────────────

export function CropModal(props: CropModalProps) {
  const { open, onCancel, title = 'Crop Photo' } = props

  const [src,        setSrc]        = useState<string | null>(null)
  const [imgSize,    setImgSize]    = useState<{ w: number; h: number } | null>(null)
  const [crop,       setCrop]       = useState<Rect>({ x: 0, y: 0, w: 200, h: 200 })
  const [applying,   setApplying]   = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef       = useRef<HTMLImageElement>(null)
  const dragRef      = useRef<{
    type:       DragType
    startMX:    number
    startMY:    number
    startCrop:  Rect
  } | null>(null)

  // ── Build src URL ─────────────────────────────────────────────────────────

  // Extract stable values for the effect dependency
  const fileRef    = props.mode === 'file'     ? (props as FileModeProps).file       : undefined
  const photoUrlRef = props.mode === 'existing' ? (props as ExistingModeProps).photoUrl : undefined

  useEffect(() => {
    if (!open) { setSrc(null); setImgSize(null); dragRef.current = null; return }

    if (fileRef) {
      const url = URL.createObjectURL(fileRef)
      setSrc(url)
      return () => URL.revokeObjectURL(url)
    } else if (photoUrlRef) {
      setSrc(photoUrlRef)
    }
  }, [open, fileRef, photoUrlRef])

  // ── On image load — initialise crop to full image ─────────────────────────

  function handleImageLoad() {
    const img = imgRef.current
    if (!img) return
    const { offsetWidth: w, offsetHeight: h } = img
    setImgSize({ w, h })
    setCrop({ x: 0, y: 0, w, h })
  }

  // ── Mouse event handlers ──────────────────────────────────────────────────

  function startDrag(e: React.MouseEvent, type: DragType) {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { type, startMX: e.clientX, startMY: e.clientY, startCrop: { ...crop } }
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current || !imgSize) return
    const { type, startMX, startMY, startCrop: sc } = dragRef.current
    const dx = e.clientX - startMX
    const dy = e.clientY - startMY
    const { w: iw, h: ih } = imgSize

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

    let next: Rect
    switch (type) {
      case 'move':
        next = {
          x: clamp(sc.x + dx, 0, iw - sc.w),
          y: clamp(sc.y + dy, 0, ih - sc.h),
          w: sc.w, h: sc.h,
        }
        break
      case 'se':
        next = {
          x: sc.x, y: sc.y,
          w: clamp(sc.w + dx, MIN_CROP_PX, iw - sc.x),
          h: clamp(sc.h + dy, MIN_CROP_PX, ih - sc.y),
        }
        break
      case 'sw': {
        const newW = clamp(sc.w - dx, MIN_CROP_PX, sc.x + sc.w)
        next = {
          x: sc.x + sc.w - newW, y: sc.y,
          w: newW,
          h: clamp(sc.h + dy, MIN_CROP_PX, ih - sc.y),
        }
        break
      }
      case 'ne': {
        const newH = clamp(sc.h - dy, MIN_CROP_PX, sc.y + sc.h)
        next = {
          x: sc.x,
          y: sc.y + sc.h - newH,
          w: clamp(sc.w + dx, MIN_CROP_PX, iw - sc.x),
          h: newH,
        }
        break
      }
      case 'nw': {
        const newW = clamp(sc.w - dx, MIN_CROP_PX, sc.x + sc.w)
        const newH = clamp(sc.h - dy, MIN_CROP_PX, sc.y + sc.h)
        next = {
          x: sc.x + sc.w - newW,
          y: sc.y + sc.h - newH,
          w: newW, h: newH,
        }
        break
      }
    }
    setCrop(next!)
  }, [imgSize])

  const handleMouseUp = useCallback(() => { dragRef.current = null }, [])

  useEffect(() => {
    if (!open) return
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup',   handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup',   handleMouseUp)
    }
  }, [open, handleMouseMove, handleMouseUp])

  // ── Apply crop ────────────────────────────────────────────────────────────

  async function handleApply() {
    const img = imgRef.current
    if (!img || !imgSize) return
    setApplying(true)

    try {
      if (props.mode === 'file') {
        // Canvas crop — blob URL is same-origin, canvas.toBlob() is allowed
        const scaleX = img.naturalWidth  / imgSize.w
        const scaleY = img.naturalHeight / imgSize.h
        const canvas = document.createElement('canvas')
        const sw = Math.max(1, Math.round(crop.w * scaleX))
        const sh = Math.max(1, Math.round(crop.h * scaleY))
        canvas.width  = sw
        canvas.height = sh
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(
          img,
          Math.round(crop.x * scaleX), Math.round(crop.y * scaleY), sw, sh,
          0, 0, sw, sh,
        )
        await new Promise<void>((resolve, reject) => {
          canvas.toBlob(blob => {
            if (!blob) { reject(new Error('Crop failed')); return }
            props.onConfirmFile(blob)
            resolve()
          }, 'image/jpeg', 0.92)
        })
      } else {
        // Existing photo — return percentage coords (server does the crop)
        props.onConfirmCrop({
          x:      crop.x / imgSize.w,
          y:      crop.y / imgSize.h,
          width:  crop.w / imgSize.w,
          height: crop.h / imgSize.h,
        })
      }
    } finally {
      setApplying(false)
    }
  }

  if (!open) return null

  // ── Corner handle helper ──────────────────────────────────────────────────

  const handle = (type: Exclude<DragType, 'move'>, posStyle: React.CSSProperties) => (
    <div
      onMouseDown={e => startDrag(e, type)}
      style={{
        position:    'absolute',
        width:       12,
        height:      12,
        background:  'white',
        border:      '1.5px solid rgba(0,0,0,0.4)',
        borderRadius: 2,
        ...posStyle,
        cursor: `${type}-resize`,
        zIndex: 10,
      }}
    />
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative z-10 w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <Crop className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{title}</h3>
          </div>
          <button onClick={onCancel} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Image area */}
        <div className="flex items-center justify-center bg-zinc-950 min-h-[200px]" style={{ maxHeight: 480 }}>
          {src && (
            <div
              ref={containerRef}
              className="relative select-none"
              style={{ display: 'inline-block', lineHeight: 0 }}
            >
              <img
                ref={imgRef}
                src={src}
                alt="Crop preview"
                onLoad={handleImageLoad}
                style={{
                  display:    'block',
                  maxWidth:   640,
                  maxHeight:  420,
                  userSelect: 'none',
                  pointerEvents: 'none',
                }}
                draggable={false}
              />

              {imgSize && (
                <>
                  {/* SVG mask — dark overlay with a transparent hole for the crop area */}
                  <svg
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <defs>
                      <mask id="crop-hole">
                        <rect width="100%" height="100%" fill="white" />
                        <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} fill="black" />
                      </mask>
                    </defs>
                    <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#crop-hole)" />
                    {/* Crop border */}
                    <rect
                      x={crop.x} y={crop.y} width={crop.w} height={crop.h}
                      fill="none" stroke="white" strokeWidth={1.5}
                    />
                    {/* Rule-of-thirds grid */}
                    {[1/3, 2/3].map(f => (
                      <g key={f} opacity={0.3}>
                        <line x1={crop.x + crop.w * f} y1={crop.y} x2={crop.x + crop.w * f} y2={crop.y + crop.h} stroke="white" strokeWidth={0.5} />
                        <line x1={crop.x} y1={crop.y + crop.h * f} x2={crop.x + crop.w} y2={crop.y + crop.h * f} stroke="white" strokeWidth={0.5} />
                      </g>
                    ))}
                  </svg>

                  {/* Crop interaction layer: contains body drag + corner handles.
                      Corner handles are children so their top/left are relative
                      to the crop box, not the image container. */}
                  <div
                    style={{
                      position: 'absolute',
                      left:     crop.x, top:    crop.y,
                      width:    crop.w, height: crop.h,
                    }}
                  >
                    {/* Body — drag to move */}
                    <div
                      onMouseDown={e => startDrag(e, 'move')}
                      style={{ position: 'absolute', inset: 0, cursor: 'move' }}
                    />
                    {/* Corner handles — drag to resize */}
                    {handle('nw', { top: -6, left: -6 })}
                    {handle('ne', { top: -6, right: -6 })}
                    {handle('sw', { bottom: -6, left: -6 })}
                    {handle('se', { bottom: -6, right: -6 })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-secondary/20">
          <p className="text-xs text-muted-foreground">
            Drag corners to resize · drag inside to move
          </p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { void handleApply() }}
              disabled={applying || !imgSize}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                applying || !imgSize
                  ? 'bg-secondary text-muted-foreground cursor-not-allowed'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              <Check className="h-3.5 w-3.5" />
              {applying ? 'Applying…' : 'Apply crop'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
