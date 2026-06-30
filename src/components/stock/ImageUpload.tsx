'use client'
// =============================================================================
// ImageUpload — drag-drop, crop, and reorder card photos
//
// Features:
//   • Drag-and-drop file upload (JPEG / PNG / WebP, max 10MB, max 8 photos)
//   • Crop modal opens for each new file before it is uploaded (file mode:
//     canvas toBlob → same-origin, no CORS issue)
//   • Crop existing saved photos (existing mode: sends % coords to PATCH API,
//     server re-crops via sharp — no client-side canvas taint)
//   • Drag-to-reorder saved photos (HTML5 DnD → POST /api/images/reorder)
//   • "Cover" badge on first photo (position 0 = eBay listing cover image)
//   • GripVertical drag handle visible on hover
//
// Architecture / no-duplicate guarantee:
//   • New uploads: each file gets a random hex key in storage (uploadCardImage)
//   • Crop existing: server fetches original, uploads NEW key, updates DB in-place,
//     deletes OLD key — no duplicates, no CDN cache collisions
//   • Reorder: position-only DB update, zero storage changes
// =============================================================================
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Upload, Trash2, Loader2, AlertCircle, ImagePlus,
  GripVertical, X, Crop as CropIcon,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast }       from '@/components/ui/Toast'
import { cn }             from '@/lib/utils'
import { CropModal }      from '@/components/stock/CropModal'
import type { CardPhoto } from '@/types'
import type { CropCoords } from '@/components/stock/CropModal'

const MAX_PHOTOS    = 8
const MAX_MB        = 10
const MAX_BYTES     = MAX_MB * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// ── Local upload state (files in-progress) ────────────────────────────────────

interface UploadItem {
  id:      string       // temp client ID
  file:    File
  preview: string       // object URL
  status:  'uploading' | 'done' | 'error'
  error?:  string
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ImageUploadProps {
  cardId:    string
  photos:    CardPhoto[]   // saved photos from DB (sorted by position externally)
  disabled?: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ImageUpload({ cardId, photos, disabled }: ImageUploadProps) {
  const qc        = useQueryClient()
  const { toast } = useToast()

  // ── Drag-to-reorder state — MUST be declared before the useEffect that
  //    references dragSourceId in its dependency array to avoid TDZ crash ──────
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dragOverId,   setDragOverId]   = useState<string | null>(null)

  // ── Sorted saved-photo order (optimistic during reorder) ──────────────────
  const [orderedPhotos, setOrderedPhotos] = useState<CardPhoto[]>([])
  useEffect(() => {
    // Guard: don't reset order while a drag-reorder is in flight.
    // dragSourceId stays set until the reorder API call resolves,
    // preventing the effect from reverting the optimistic update.
    if (dragSourceId) return
    setOrderedPhotos([...photos].sort((a, b) => a.position - b.position))
  }, [photos, dragSourceId])

  // ── Upload queue ──────────────────────────────────────────────────────────
  const [uploads, setUploads] = useState<UploadItem[]>([])

  // ── Crop queue for NEW files ───────────────────────────────────────────────
  const [cropQueue,    setCropQueue]    = useState<File[]>([])
  const [cropFile,     setCropFile]     = useState<File | null>(null)  // file in crop modal

  // ── Crop for EXISTING saved photos ────────────────────────────────────────
  const [cropExisting,    setCropExisting]    = useState<CardPhoto | null>(null)
  const [croppingPhotoId, setCroppingPhotoId] = useState<string | null>(null)

  // ── Delete state ──────────────────────────────────────────────────────────
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── File picker ref ───────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Derived counts ────────────────────────────────────────────────────────
  const activeUploads = uploads.filter(u => u.status !== 'done')
  const totalCount    = orderedPhotos.length + activeUploads.length + cropQueue.length + (cropFile ? 1 : 0)
  const canAddMore    = totalCount < MAX_PHOTOS && !disabled

  // ── Auto-advance crop queue ───────────────────────────────────────────────

  useEffect(() => {
    if (cropFile === null && cropQueue.length > 0) {
      const [next, ...rest] = cropQueue
      setCropFile(next)
      setCropQueue(rest)
    }
  }, [cropFile, cropQueue])

  // ── File validation ───────────────────────────────────────────────────────

  function validateFile(file: File): string | null {
    if (!ALLOWED_TYPES.includes(file.type)) return `${file.name}: only JPEG, PNG and WebP`
    if (file.size > MAX_BYTES)              return `${file.name}: exceeds ${MAX_MB}MB limit`
    return null
  }

  // ── Upload a blob (after crop confirm, or original if skipped) ────────────

  async function uploadBlob(blob: Blob, originalFile: File) {
    const file   = new File([blob], originalFile.name, { type: 'image/jpeg' })
    const preview = URL.createObjectURL(blob)
    const item: UploadItem = { id: crypto.randomUUID(), file, preview, status: 'uploading' }
    const position = photos.length + uploads.filter(u => u.status !== 'error').length + cropQueue.length

    setUploads(prev => [...prev, item])

    const form = new FormData()
    form.append('file',     file)
    form.append('card_id',  cardId)
    form.append('position', String(position))

    try {
      const res = await fetch('/api/images/upload', { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? `Upload failed (${res.status})`)
      }
      setUploads(prev => prev.map(u => u.id === item.id ? { ...u, status: 'done' } : u))
      qc.invalidateQueries({ queryKey: ['cards'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setUploads(prev => prev.map(u => u.id === item.id ? { ...u, status: 'error', error: msg } : u))
      toast.error('Upload failed', msg)
    }
  }

  // ── Crop confirm handlers ─────────────────────────────────────────────────

  function handleNewCropConfirm(blob: Blob) {
    if (!cropFile) return
    void uploadBlob(blob, cropFile)
    setCropFile(null)   // triggers useEffect → next in queue
  }

  function handleNewCropCancel() {
    // Upload original without crop
    if (cropFile) {
      void uploadBlob(cropFile, cropFile)
    }
    setCropFile(null)
  }

  async function handleExistingCropConfirm(coords: CropCoords) {
    if (!cropExisting) return
    const photoId = cropExisting.id
    setCropExisting(null)
    setCroppingPhotoId(photoId)

    try {
      const res = await fetch(`/api/images/${photoId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ crop: coords }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? 'Crop failed')
      }
      qc.invalidateQueries({ queryKey: ['cards'] })
      toast.success('Photo cropped')
    } catch (err) {
      toast.error('Crop failed', err instanceof Error ? err.message : undefined)
    } finally {
      setCroppingPhotoId(null)
    }
  }

  // ── Enqueue new files for crop ────────────────────────────────────────────

  function enqueueFiles(files: FileList | File[]) {
    if (!canAddMore) return
    const fileArr  = Array.from(files)
    const slots    = MAX_PHOTOS - totalCount
    const toAdd    = fileArr.slice(0, slots)

    if (toAdd.length < fileArr.length) {
      toast.info(`Only ${slots} more photo${slots !== 1 ? 's' : ''} can be added (max ${MAX_PHOTOS})`)
    }

    const valid:  File[]   = []
    const errors: string[] = []
    toAdd.forEach(file => {
      const err = validateFile(file)
      if (err) errors.push(err)
      else     valid.push(file)
    })
    if (errors.length) toast.error('Some files were rejected', errors.join(', '))
    if (!valid.length) return

    // Push to crop queue — the useEffect will open the modal for each
    setCropQueue(prev => [...prev, ...valid])
  }

  // ── Drag-and-drop zone ────────────────────────────────────────────────────

  const [isDraggingOver, setIsDraggingOver] = useState(false)

  const handleZoneDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (canAddMore) setIsDraggingOver(true)
  }, [canAddMore])

  const handleZoneDragLeave = useCallback(() => setIsDraggingOver(false), [])

  const handleZoneDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOver(false)
    enqueueFiles(e.dataTransfer.files)
  }, [canAddMore, totalCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Retry failed upload ───────────────────────────────────────────────────

  function retryUpload(item: UploadItem) {
    void uploadBlob(item.file, item.file)
    setUploads(prev => prev.filter(u => u.id !== item.id))
  }

  // ── Delete saved photo ────────────────────────────────────────────────────

  async function deletePhoto(photoId: string) {
    setDeletingId(photoId)
    try {
      const res = await fetch(`/api/images/${photoId}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? 'Delete failed')
      }
      qc.invalidateQueries({ queryKey: ['cards'] })
      toast.success('Photo removed')
    } catch (err) {
      toast.error('Failed to delete photo', err instanceof Error ? err.message : undefined)
    } finally {
      setDeletingId(null)
    }
  }

  // ── Drag-to-reorder handlers ──────────────────────────────────────────────

  async function handleReorderDrop(targetId: string) {
    if (!dragSourceId || dragSourceId === targetId) return

    const current = [...orderedPhotos]
    const srcIdx  = current.findIndex(p => p.id === dragSourceId)
    const tgtIdx  = current.findIndex(p => p.id === targetId)
    if (srcIdx === -1 || tgtIdx === -1) return

    const newOrder = [...current]
    const [moved]  = newOrder.splice(srcIdx, 1)
    newOrder.splice(tgtIdx, 0, moved)

    // Optimistic update — keep dragSourceId set until API resolves so the
    // useEffect guard doesn't reset orderedPhotos back to old positions.
    setOrderedPhotos(newOrder)
    setDragOverId(null)

    const updates = newOrder.map((p, i) => ({ id: p.id, position: i }))
    try {
      const res = await fetch('/api/images/reorder', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ updates }),
      })
      if (!res.ok) throw new Error('Reorder failed')
      qc.invalidateQueries({ queryKey: ['cards'] })
    } catch (err) {
      setOrderedPhotos(current)  // revert on failure
      toast.error('Failed to reorder photos', err instanceof Error ? err.message : undefined)
    } finally {
      setDragSourceId(null)  // clear only after API resolves
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">

      {/* ── Saved photos grid ──────────────────────────────────────────────── */}
      {orderedPhotos.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {orderedPhotos.map((photo, idx) => {
            const isDeleting  = deletingId     === photo.id
            const isCropping  = croppingPhotoId === photo.id
            const isDragSrc   = dragSourceId   === photo.id
            const isDragTarget = dragOverId    === photo.id

            return (
              <div
                key={photo.id}
                draggable={!disabled && !isDeleting && !isCropping}
                onDragStart={() => { setDragSourceId(photo.id); setDragOverId(null) }}
                onDragOver={e  => { e.preventDefault(); if (dragSourceId && dragSourceId !== photo.id) setDragOverId(photo.id) }}
                onDrop={e      => { e.preventDefault(); void handleReorderDrop(photo.id) }}
                onDragEnd={()  => { setDragSourceId(null); setDragOverId(null) }}
                className={cn(
                  'relative aspect-square rounded-md overflow-hidden border group cursor-grab active:cursor-grabbing',
                  isDragTarget  ? 'border-primary ring-2 ring-primary/40' : 'border-border',
                  isDragSrc     ? 'opacity-40 scale-95' : '',
                  'transition-all duration-100',
                )}
              >
                <img
                  src={photo.thumb_url ?? photo.url}
                  alt="Card photo"
                  className="object-cover w-full h-full"
                  loading="lazy"
                  draggable={false}
                />

                {/* Cover badge (first photo = eBay listing cover image) */}
                {idx === 0 && (
                  <span className="absolute top-1 left-1 rounded px-1 py-0.5 text-[9px] font-semibold tracking-wide bg-black/70 text-white uppercase">
                    Cover
                  </span>
                )}

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/35 transition-colors pointer-events-none" />

                {/* Drag handle */}
                {!disabled && (
                  <div className="absolute bottom-1 left-1 rounded bg-black/60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <GripVertical className="h-3 w-3 text-white" />
                  </div>
                )}

                {/* Cropping spinner */}
                {isCropping && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  </div>
                )}

                {/* Deleting spinner */}
                {isDeleting && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  </div>
                )}

                {/* Action buttons (crop + delete) — show on hover */}
                {!disabled && !isDeleting && !isCropping && (
                  <>
                    {/* Crop */}
                    <button
                      onClick={e => { e.stopPropagation(); setCropExisting(photo) }}
                      className="absolute top-1 left-1 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 hover:bg-primary/80 transition-all"
                      aria-label="Crop photo"
                    >
                      <CropIcon className="h-2.5 w-2.5" />
                    </button>
                    {/* Delete */}
                    <button
                      onClick={e => { e.stopPropagation(); void deletePhoto(photo.id) }}
                      className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 hover:bg-destructive transition-all"
                      aria-label="Delete photo"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── In-progress uploads ────────────────────────────────────────────── */}
      {activeUploads.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {activeUploads.map(item => (
            <div
              key={item.id}
              className={cn(
                'relative aspect-square rounded-md overflow-hidden border',
                item.status === 'error' ? 'border-destructive' : 'border-border',
              )}
            >
              <img src={item.preview} alt="Upload preview" className="object-cover w-full h-full" />

              {item.status === 'uploading' && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                </div>
              )}

              {item.status === 'error' && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1 p-2">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  <p className="text-[10px] text-white text-center leading-tight line-clamp-2">{item.error}</p>
                  <button onClick={() => retryUpload(item)} className="text-[10px] text-primary underline">
                    Retry
                  </button>
                </div>
              )}

              {item.status === 'error' && (
                <button
                  onClick={() => setUploads(prev => prev.filter(u => u.id !== item.id))}
                  className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 transition-colors"
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Drop zone ──────────────────────────────────────────────────────── */}
      {canAddMore && (
        <div
          onDragOver={handleZoneDragOver}
          onDragLeave={handleZoneDragLeave}
          onDrop={handleZoneDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
          aria-label="Upload photos"
          className={cn(
            'flex flex-col items-center justify-center gap-2',
            'rounded-lg border-2 border-dashed px-6 py-8',
            'cursor-pointer transition-colors',
            isDraggingOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-secondary/30',
          )}
        >
          {isDraggingOver ? (
            <Upload className="h-6 w-6 text-primary" />
          ) : (
            <ImagePlus className="h-6 w-6 text-muted-foreground" />
          )}
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              {isDraggingOver ? 'Drop to upload' : 'Drop photos here'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              or click to browse · JPEG, PNG, WebP · up to {MAX_MB}MB each
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {totalCount}/{MAX_PHOTOS} photos
          </p>
        </div>
      )}

      {!canAddMore && !disabled && (
        <p className="text-xs text-muted-foreground text-center">
          Maximum {MAX_PHOTOS} photos per card reached
        </p>
      )}

      {/* ── Hidden file input ───────────────────────────────────────────────── */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_TYPES.join(',')}
        multiple
        className="sr-only"
        onChange={e => {
          if (e.target.files) enqueueFiles(e.target.files)
          e.target.value = ''
        }}
        aria-hidden
      />

      {/* ── Crop modal — new file (client-side canvas, blob URL = same-origin) */}
      {cropFile && (
        <CropModal
          open
          mode="file"
          file={cropFile}
          title="Crop new photo"
          onConfirmFile={handleNewCropConfirm}
          onCancel={handleNewCropCancel}
        />
      )}

      {/* ── Crop modal — existing saved photo (server-side crop via PATCH API) */}
      {cropExisting && (
        <CropModal
          open
          mode="existing"
          photoUrl={cropExisting.url}
          title="Crop photo"
          onConfirmCrop={coords => { void handleExistingCropConfirm(coords) }}
          onCancel={() => setCropExisting(null)}
        />
      )}
    </div>
  )
}
