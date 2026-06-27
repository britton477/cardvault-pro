'use client'
// =============================================================================
// ObjectivesBoard — todo/objectives panel beside the calendar
// Scope toggle: Everyone (org-wide) | Mine (personal)
// =============================================================================
import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { Plus, Trash2, CheckCircle2, Circle }          from 'lucide-react'
import {
  useObjectives,
  useCreateObjective,
  useToggleObjective,
  useDeleteObjective,
} from '@/hooks/useObjectives'
import { useToast }          from '@/components/ui/Toast'
import { cn }                from '@/lib/utils'
import type { Objective, ObjectiveScope } from '@/types'

// ── Objective row ─────────────────────────────────────────────────────────────

interface ObjectiveRowProps {
  obj:       Objective
  onToggle:  (id: string, complete: boolean) => void
  onDelete:  (id: string) => void
  toggling:  boolean
  deleting:  boolean
}

function ObjectiveRow({ obj, onToggle, onDelete, toggling, deleting }: ObjectiveRowProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 px-3 py-2 rounded-md transition-colors group',
        hovered ? 'bg-secondary/30' : 'bg-transparent',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Checkbox */}
      <button
        onClick={() => onToggle(obj.id, !obj.is_complete)}
        disabled={toggling}
        className="mt-0.5 flex-shrink-0 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
        aria-label={obj.is_complete ? 'Mark incomplete' : 'Mark complete'}
      >
        {obj.is_complete
          ? <CheckCircle2 className="h-4 w-4 text-green-400" />
          : <Circle       className="h-4 w-4" />
        }
      </button>

      {/* Title */}
      <p className={cn(
        'flex-1 text-sm leading-snug min-w-0 break-words',
        obj.is_complete && 'line-through text-muted-foreground/60',
      )}>
        {obj.title}
      </p>

      {/* Delete — visible on hover */}
      <button
        onClick={() => onDelete(obj.id)}
        disabled={deleting}
        className={cn(
          'flex-shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50',
          hovered ? 'visible' : 'invisible',
        )}
        aria-label="Delete objective"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ObjectivesBoard() {
  const [scope,    setScope]    = useState<ObjectiveScope>('org')
  const [newTitle, setNewTitle] = useState('')
  const inputRef                = useRef<HTMLInputElement>(null)
  const { toast }               = useToast()

  const { data: objectives = [], isLoading } = useObjectives(scope)
  const create = useCreateObjective(scope)
  const toggle = useToggleObjective(scope)
  const remove = useDeleteObjective(scope)

  // Separate incomplete and complete for display ordering
  const incomplete = objectives.filter(o => !o.is_complete)
  const complete   = objectives.filter(o =>  o.is_complete)

  async function handleAdd() {
    const title = newTitle.trim()
    if (!title) return
    try {
      await create.mutateAsync({ title, is_personal: scope === 'personal' })
      setNewTitle('')
      inputRef.current?.focus()
    } catch {
      toast.error('Failed to add objective')
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void handleAdd()
  }

  async function handleToggle(id: string, is_complete: boolean) {
    try {
      await toggle.mutateAsync({ id, is_complete })
    } catch {
      toast.error('Failed to update objective')
    }
  }

  async function handleDelete(id: string) {
    try {
      await remove.mutateAsync(id)
    } catch {
      toast.error('Failed to delete objective')
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-border">
        <h2 className="text-sm font-semibold mb-3">Objectives</h2>

        {/* Scope toggle */}
        <div className="flex rounded-md border border-border overflow-hidden text-xs">
          {(['org', 'personal'] as ObjectiveScope[]).map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={cn(
                'flex-1 py-1.5 font-medium transition-colors',
                scope === s
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
              )}
            >
              {s === 'org' ? 'Everyone' : 'Mine'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Add input ──────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
        <input
          ref={inputRef}
          type="text"
          placeholder="Add an objective…"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={500}
          disabled={create.isPending}
          className="flex-1 text-sm bg-transparent placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={() => void handleAdd()}
          disabled={!newTitle.trim() || create.isPending}
          className="rounded p-1 text-muted-foreground hover:text-primary hover:bg-secondary transition-colors disabled:opacity-30"
          aria-label="Add objective"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* ── List ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-1.5 min-h-0">

        {isLoading && (
          <div className="flex justify-center py-6">
            <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        )}

        {!isLoading && objectives.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No objectives yet.<br />
            <span className="opacity-60">Type above and press Enter to add one.</span>
          </p>
        )}

        {/* Incomplete */}
        {incomplete.map(obj => (
          <ObjectiveRow
            key={obj.id}
            obj={obj}
            onToggle={(id, c) => void handleToggle(id, c)}
            onDelete={(id)    => void handleDelete(id)}
            toggling={toggle.isPending}
            deleting={remove.isPending}
          />
        ))}

        {/* Divider between incomplete and complete */}
        {incomplete.length > 0 && complete.length > 0 && (
          <div className="mx-3 my-1.5 border-t border-border/60" />
        )}

        {/* Complete */}
        {complete.map(obj => (
          <ObjectiveRow
            key={obj.id}
            obj={obj}
            onToggle={(id, c) => void handleToggle(id, c)}
            onDelete={(id)    => void handleDelete(id)}
            toggling={toggle.isPending}
            deleting={remove.isPending}
          />
        ))}
      </div>

      {/* ── Footer count ───────────────────────────────────────────────── */}
      {objectives.length > 0 && (
        <div className="flex-shrink-0 px-3 py-2 border-t border-border">
          <p className="text-[10px] text-muted-foreground">
            {complete.length}/{objectives.length} complete
          </p>
        </div>
      )}
    </div>
  )
}
