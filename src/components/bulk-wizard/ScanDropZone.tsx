'use client'
// =============================================================================
// ScanDropZone — Drag-and-drop / click-to-browse / camera image picker
//
// Accepts JPEG, PNG, WebP. Filters non-image files silently.
// Camera input (capture="environment") works on mobile — shows camera roll
// picker on desktop browsers that don't support direct camera access.
// =============================================================================
import { useRef, useState, useCallback } from 'react'
import { Camera, Upload, ImagePlus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ScanDropZoneProps {
  onFiles: (files: File[]) => void
  disabled?: boolean
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

function filterImages(files: FileList | File[]): File[] {
  return Array.from(files).filter(f => ACCEPTED.includes(f.type))
}

export function ScanDropZone({ onFiles, disabled }: ScanDropZoneProps) {
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging]   = useState(false)

  const handleFiles = useCallback((files: FileList | File[]) => {
    const valid = filterImages(files)
    if (valid.length) onFiles(valid)
  }, [onFiles])

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (!disabled) setIsDragging(true)
  }
  const onDragLeave = () => setIsDragging(false)
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (!disabled) handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Drop card images or click to browse"
        onClick={() => !disabled && fileInputRef.current?.click()}
        onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) fileInputRef.current?.click() }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'relative flex flex-col items-center justify-center gap-3',
          'rounded-xl border-2 border-dashed transition-colors cursor-pointer',
          'min-h-[180px] px-6 py-8 text-center select-none',
          isDragging
            ? 'border-primary bg-primary/8 scale-[1.01] transition-transform'
            : 'border-border hover:border-primary/50 hover:bg-secondary/40',
          disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
        )}
      >
        <div className={cn(
          'flex items-center justify-center rounded-full p-3 transition-colors',
          isDragging ? 'bg-primary/15' : 'bg-secondary',
        )}>
          <ImagePlus className={cn('h-6 w-6', isDragging ? 'text-primary' : 'text-muted-foreground')} />
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">
            {isDragging ? 'Drop to add cards' : 'Drop photos here or click to browse'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            One photo per card · JPEG, PNG, or WebP
          </p>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      {/* Camera shortcut — useful on mobile, visible on all */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => cameraInputRef.current?.click()}
        className={cn(
          'flex items-center justify-center gap-2 w-full rounded-lg border border-border',
          'px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary',
          'transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        )}
      >
        <Camera className="h-4 w-4" aria-hidden />
        Use camera
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }}
        />
      </button>

      {/* Multi-file button alternative */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'flex items-center justify-center gap-2 w-full rounded-lg',
          'px-4 py-2.5 text-sm font-medium',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          'transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        )}
      >
        <Upload className="h-4 w-4" aria-hidden />
        Select files
      </button>
    </div>
  )
}
