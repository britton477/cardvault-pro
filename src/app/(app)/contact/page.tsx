'use client'
// =============================================================================
// /contact — Contact form → POST /api/contact → Resend → info@vaulthunters.co.uk
// =============================================================================
import { useState } from 'react'
import { Mail, Send, CheckCircle2, AlertCircle } from 'lucide-react'

type Status = 'idle' | 'sending' | 'sent' | 'error'

export default function ContactPage() {
  const [name,    setName]    = useState('')
  const [email,   setEmail]   = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [status,  setStatus]  = useState<Status>('idle')
  const [errMsg,  setErrMsg]  = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setErrMsg(null)

    try {
      const res = await fetch('/api/contact', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, subject, message }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? 'Something went wrong — please try again')
      }

      setStatus('sent')
      setName(''); setEmail(''); setSubject(''); setMessage('')
    } catch (err) {
      setStatus('error')
      setErrMsg(err instanceof Error ? err.message : 'Failed to send — please try again')
    }
  }

  return (
    <div className="max-w-xl mx-auto py-2 pb-16 space-y-8">

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
          <Mail className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Contact us</h1>
          <p className="text-muted-foreground mt-1">
            Questions, feedback, or something not working? We&apos;ll get back to you.
          </p>
        </div>
      </div>

      {/* Success state */}
      {status === 'sent' ? (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-8 flex flex-col items-center text-center gap-4">
          <div className="h-14 w-14 rounded-full bg-green-500/10 flex items-center justify-center">
            <CheckCircle2 className="h-7 w-7 text-green-400" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Message sent!</p>
            <p className="text-sm text-muted-foreground mt-1">
              We&apos;ve received your message and will reply to your email shortly.
            </p>
          </div>
          <button
            onClick={() => setStatus('idle')}
            className="text-sm text-primary hover:underline"
          >
            Send another message
          </button>
        </div>
      ) : (
        <form onSubmit={e => { void handleSubmit(e) }} className="rounded-xl border border-border bg-card p-6 space-y-5">

          {/* Name */}
          <div className="space-y-1.5">
            <label htmlFor="name" className="block text-sm font-medium text-foreground">
              Your name <span className="text-destructive">*</span>
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Jane Smith"
              disabled={status === 'sending'}
              className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            />
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium text-foreground">
              Your email <span className="text-destructive">*</span>
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="jane@example.com"
              disabled={status === 'sending'}
              className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            />
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <label htmlFor="subject" className="block text-sm font-medium text-foreground">
              Subject <span className="text-destructive">*</span>
            </label>
            <input
              id="subject"
              type="text"
              required
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Bug report / Question / Feature request…"
              disabled={status === 'sending'}
              className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            />
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <label htmlFor="message" className="block text-sm font-medium text-foreground">
              Message <span className="text-destructive">*</span>
            </label>
            <textarea
              id="message"
              required
              minLength={10}
              rows={6}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Tell us what's on your mind…"
              disabled={status === 'sending'}
              className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none disabled:opacity-50"
            />
          </div>

          {/* Error */}
          {status === 'error' && errMsg && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {errMsg}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={status === 'sending'}
            className="w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {status === 'sending' ? (
              <>
                <span className="h-4 w-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send message
              </>
            )}
          </button>

          <p className="text-xs text-center text-muted-foreground">
            We reply to <strong>info@vaulthunters.co.uk</strong> — you&apos;ll hear from us within a day or two.
          </p>
        </form>
      )}
    </div>
  )
}
