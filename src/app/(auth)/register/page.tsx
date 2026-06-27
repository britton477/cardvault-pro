'use client'
// =============================================================================
// /register — Sign-up page
// Creates a new CardVault Pro account + organisation in one step.
// =============================================================================
import { useState, useTransition } from 'react'
import Link        from 'next/link'
import { useRouter } from 'next/navigation'
import { cn }     from '@/lib/utils'

interface FormState {
  name:      string
  email:     string
  password:  string
  shop_name: string
}

interface FieldErrors {
  name?:      string
  email?:     string
  password?:  string
  shop_name?: string
  _form?:     string
}

export default function RegisterPage() {
  const router = useRouter()
  const [form,   setForm]   = useState<FormState>({ name: '', email: '', password: '', shop_name: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [isPending, startTransition] = useTransition()

  function set(k: keyof FormState, v: string) {
    setForm(f => ({ ...f, [k]: v }))
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined, _form: undefined }))
  }

  function validate(): boolean {
    const e: FieldErrors = {}
    if (!form.name.trim())                 e.name      = 'Your name is required'
    if (!form.email)                       e.email     = 'Email is required'
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Enter a valid email'
    if (form.password.length < 8)          e.password  = 'Password must be at least 8 characters'
    if (!form.shop_name.trim())            e.shop_name = 'Shop name is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    startTransition(async () => {
      try {
        const res = await fetch('/api/auth/register', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(form),
        })

        const data = await res.json() as { message?: string; redirect?: string; error?: string }

        if (!res.ok) {
          setErrors({ _form: data.error ?? 'Registration failed. Please try again.' })
          return
        }

        // Pass email via query param so the check-email page can display it
        const dest = data.redirect ?? '/dashboard'
        const url  = dest === '/register/check-email' && data.email
          ? `${dest}?email=${encodeURIComponent(data.email as string)}`
          : dest
        router.push(url)
      } catch {
        setErrors({ _form: 'Network error — check your connection and try again.' })
      }
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm space-y-6">

        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="text-5xl">🃏</div>
          <h1 className="text-2xl font-bold tracking-tight">CardVault Pro</h1>
          <p className="text-sm text-muted-foreground">Create your account — it&apos;s free</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>

          {/* Name */}
          <Field
            id="name" label="Your name" type="text"
            autoComplete="name" value={form.name} error={errors.name}
            onChange={e => set('name', e.target.value)}
            placeholder="Jane Smith"
          />

          {/* Shop name */}
          <Field
            id="shop_name" label="Shop name" type="text"
            autoComplete="organization" value={form.shop_name} error={errors.shop_name}
            onChange={e => set('shop_name', e.target.value)}
            placeholder="e.g. VaultHunters TCG"
          />

          {/* Email */}
          <Field
            id="email" label="Email address" type="email"
            autoComplete="email" value={form.email} error={errors.email}
            onChange={e => set('email', e.target.value)}
            placeholder="you@example.com"
          />

          {/* Password */}
          <Field
            id="password" label="Password" type="password"
            autoComplete="new-password" value={form.password} error={errors.password}
            onChange={e => set('password', e.target.value)}
            placeholder="Min. 8 characters"
          />

          {/* Form-level error */}
          {errors._form && (
            <p className="text-sm text-destructive rounded-md bg-destructive/10 px-3 py-2" role="alert">
              {errors._form}
            </p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className={cn(
              'w-full py-2.5 px-4 rounded-md font-semibold text-primary-foreground',
              'bg-primary hover:bg-primary/90 transition-colors text-sm',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {isPending ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        {/* Switch to login */}
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="text-primary hover:underline font-medium">
            Sign in
          </Link>
        </p>

        <p className="text-center text-xs text-muted-foreground">
          By creating an account you agree to our{' '}
          <a href="/terms" className="underline">Terms of Service</a>
          {' '}and{' '}
          <a href="/privacy" className="underline">Privacy Policy</a>
        </p>

      </div>
    </div>
  )
}

// ── Field helper ──────────────────────────────────────────────────────────────

function Field({
  id, label, type, value, onChange, placeholder, autoComplete, error,
}: {
  id:           string
  label:        string
  type:         string
  value:        string
  onChange:     React.ChangeEventHandler<HTMLInputElement>
  placeholder?: string
  autoComplete?: string
  error?:       string
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        required
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          'w-full px-3 py-2 rounded-md border bg-input text-foreground text-sm',
          'focus:outline-none focus:ring-2 focus:ring-ring',
          'placeholder:text-muted-foreground',
          error ? 'border-destructive' : 'border-border',
        )}
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
