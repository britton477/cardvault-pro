'use client'
// =============================================================================
// ImageUpload — drag-drop image uploader for card photos
// - Drag-and-drop zone + file picker
// - Shows existing photos as a preview grid with delete (X) on hover
// - Uploads to /api/images/upload (multipart)
// - Deletes via DELETE /api/images/[photoId]
// - Per-file upload progress (tracked locally)
// - Max 8 photos per card, 10MB each, JPEG/PNG/WebP only
// =============================================================================
import { useState, useRef, useCallback } from 'react'
// next/image not used — card photos use plain <img> to support any storage URL
import { Upload, X, Loader2, AlertCircle, ImagePlus, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import type { CardPhoto } from '@/types'

const MAX_PHOTOS    = 8
const MAX_MB        = 10
const MAX_BYTES     = MAX_MB * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

interface UploadItem {
  id:       string       // temp client ID
  file:     File
  preview:  string       // object URL
  status:   'pending' | 'uploading' | 'done' | 'error'
  error?:   string
}

interface ImageUploadProps {
  cardId:   string
  photos:   CardPhoto[]  // already-saved photos from DB
  disabled?: boolean
}

export function ImageUpload({ cardId, photos, disabled }: ImageUploadProps) {
  const [uploads,    setUploads]    = useState<UploadItem[]>([])
  const [isDragging, setDragging]   = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRef                = useRef<HTMLInputElement>(null)
  const qc                          = useQueryClient()
  const { toast }                   = useToast()

  // Only count pending/uploading items — 'done' uploads will appear in `photos`
  // after the query refetches, so counting them would cause double-counting.
  const totalCount = photos.length + uploads.filter(u => u.status === 'pending' || u.status === 'uploading').length
  const canAddMore = totalCount < MAX_PHOTOS && !disabled

  // ── File validation ───────────────────────────────────────────────────────────

  function validateFile(file: File): string | null {
    if (!ALLOWED_TYPES.includes(file.type)) return `${file.name}: only JPEG, PNG and WebP`
    if (file.size > MAX_BYTES)             return `${file.name}: exceeds ${MAX_MB}MB limit`
    return null
  }

  // ── Upload a single file ──────────────────────────────────────────────────────

  async function uploadFile(item: UploadItem, position: number) {
    setUploads(prev =>
      prev.map(u => u.id === item.id ? { ...u, status: 'uploading' } : u),
    )

    const form = new FormData()
    form.append('file',     item.file)
    form.append('card_id',  cardId)
    form.append('position', String(position))

    try {
      const res = await fetch('/api/images/upload', { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? `Upload failed (${res.status})`)
      }
      setUploads(prev =>
        prev.map(u => u.id === item.id ? { ...u, status: 'done' } : u),
      )
      // Invalidate card data so new photo appears in SlideOver
      qc.invalidateQueries({ queryKey: ['cards'] })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setUploads(prev =>
        prev.map(u => u.id === item.id ? { ...u, status: 'error', error: msg } : u),
      )
      toast.error('Upload failed', msg)
    }
  }

  // ── Queue files ───────────────────────────────────────────────────────────────

  function enqueueFiles(files: FileList | File[]) {
    const fileArr = Array.from(files)
    const remaining = MAX_PHOTOS - totalCount
    const toAdd = fileArr.slice(0, remaining)

    if (toAdd.length < fileArr.length) {
      toast.info(`Only ${remaining} more photo${remaining !== 1 ? 's' : ''} can be added (max ${MAX_PHOTOS})`)
    }

    const valid: UploadItem[] = []
    const errors: string[] = []

    toAdd.forEach(file => {
      const err = validateFile(file)
      if (err) {
        errors.push(err)
      } else {
        valid.push({
          id:      crypto.randomUUID(),
          file,
          preview: URL.createObjectURL(file),
          status:  'pending',
        })
      }
    })

    if (errors.length) {
      toast.error('Some files were rejected', errors.join(', '))
    }

    if (!valid.length) return

    setUploads(prev => [...prev, ...valid])

    // Upload each in sequence (position = existing count + index)
    const startPosition = photos.length + uploads.filter(u => u.status !== 'error').length
    valid.forEach((item, i) => {
      uploadFile(item, startPosition + i)
    })
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!canAddMore) return
    setDragging(true)
  }, [canAddMore])

  const handleDragLeave = useCallback(() => setDragging(false), [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (!canAddMore) return
    enqueueFiles(e.dataTransfer.files)
  }, [canAddMore, totalCount]) // eslint-disable-line

  // ── Remove a pending/errored upload ──────────────────────────────────────────

  function removeUpload(id: string) {
    setUploads(prev => {
      const item = prev.find(u => u.id === id)
      if (item) URL.revokeObjectURL(item.preview)
      return prev.filter(u => u.id !== id)
    })
  }

  // ── Retry a failed upload ─────────────────────────────────────────────────────

  function retryUpload(item: UploadItem) {
    const position = photos.length + uploads.filter(u => u.status === 'done').length
    uploadFile(item, position)
  }

  // ── Delete a saved photo ──────────────────────────────────────────────────────

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

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Existing photos grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {photos
            .sort((a, b) => a.position - b.position)
            .map(photo => {
              const isDeleting = deletingId === photo.id
              return (
                <div
                  key={photo.id}
                  className="relative aspect-square rounded-md overflow-hidden border border-border group"
                >
                  <img
                    src={photo.thumb_url ?? photo.url}
                    alt="Card photo"
                    className="object-cover w-full h-full"
                    loading="lazy"
                  />
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />

                  {/* Delete button */}
                  {!disabled && (
                    isDeleting ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Loader2 className="h-4 w-4 animate-spin text-white" />
                      </div>
                    ) : (
                      <button
                        onClick={() => { void deletePhoto(photo.id) }}
                        className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 hover:bg-destructive transition-all"
                        aria-label="Delete photo"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )
                  )}
                </div>
              )
            })}
        </div>
      )}

      {/* In-progress uploads grid — 'done' items are excluded here because
          invalidateQueries will cause them to appear in the `photos` prop above.
          Showing them in both grids is what causes the double-display bug. */}
      {uploads.some(u => u.status !== 'done') && (
        <div className="grid grid-cols-4 gap-2">
          {uploads.filter(u => u.status !== 'done').map(item => (
            <div
              key={item.id}
              className={cn(
                'relative aspect-square rounded-md overflow-hidden border',
                item.status === 'error' ? 'border-destructive' : 'border-border',
              )}
            >
              {/* Preview */}
              <img src={item.preview} alt="Upload preview" className="object-cover w-full h-full" />

              {/* Overlay for uploading */}
              {item.status === 'uploading' && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                </div>
              )}

              {/* Error overlay */}
              {item.status === 'error' && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1 p-2">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  <p className="text-[10px] text-white text-center leading-tight line-clamp-2">{item.error}</p>
                  <button
                    onClick={() => retryUpload(item)}
                    className="text-[10px] text-primary underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Remove button (for pending/error only) */}
              {(item.status === 'pending' || item.status === 'error') && (
                <button
                  onClick={() => removeUpload(item.id)}
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

      {/* Drop zone */}
      {canAddMore && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
          aria-label="Upload photos"
          className={cn(
            'flex flex-col items-center justify-center gap-2',
            'rounded-lg border-2 border-dashed px-6 py-8',
            'cursor-pointer transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-secondary/30',
          )}
        >
          {isDragging ? (
            <Upload className="h-6 w-6 text-primary" />
          ) : (
            <ImagePlus className="h-6 w-6 text-muted-foreground" />
          )}
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              {isDragging ? 'Drop to upload' : 'Drop photos here'}
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

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_TYPES.join(',')}
        multiple
        className="sr-only"
        onChange={e => {
          if (e.target.files) enqueueFiles(e.target.files)
          e.target.value = '' // allow re-selecting same file
        }}
        aria-hidden
      />

      {!canAddMore && !disabled && (
        <p className="text-xs text-muted-foreground text-center">
          Maximum {MAX_PHOTOS} photos per card reached
        </p>
      )}
    </div>
  )
}
