// =============================================================================
// POST /api/contact — Save message to DB + optionally email via Resend.
//
// Always stores the message in contact_messages (admin client).
// If RESEND_API_KEY is set, also sends an email to info@vaulthunters.co.uk.
// =============================================================================
import { type NextRequest } from 'next/server'
import { z, ZodError }      from 'zod'
import { ok, serverError, validationError } from '@/lib/api'
import { createAdminClient } from '@/lib/supabase/server'

const ContactSchema = z.object({
  name:    z.string().min(1).max(100),
  email:   z.string().email().max(200),
  subject: z.string().min(1).max(200),
  message: z.string().min(10).max(5000),
})

const TO   = process.env.CONTACT_EMAIL ?? 'info@vaulthunterstcg.co.uk'
const FROM = `CardVault Pro <noreply@vaulthunterstcg.co.uk>`

export async function POST(request: NextRequest) {
  try {
    const body  = await request.json() as unknown
    const input = ContactSchema.parse(body)

    // ── 1. Always persist to DB ──────────────────────────────────────────────
    const admin = createAdminClient()
    const { error: dbErr } = await admin.from('contact_messages').insert({
      name:    input.name,
      email:   input.email,
      subject: input.subject,
      message: input.message,
    })
    if (dbErr) {
      console.error('[contact] DB insert failed', dbErr)
      return serverError(new Error('Failed to save message — please try again'))
    }

    // ── 2. Email via Resend if configured ────────────────────────────────────
    const apiKey = process.env.RESEND_API_KEY
    if (apiKey) {
      const res = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:      FROM,
          to:        [TO],
          reply_to:  input.email,
          subject:   `[CardVault] ${input.subject} — from ${input.name}`,
          text: [
            `Name:    ${input.name}`,
            `Email:   ${input.email}`,
            `Subject: ${input.subject}`,
            '',
            input.message,
          ].join('\n'),
          html: `
            <p><strong>Name:</strong> ${escHtml(input.name)}</p>
            <p><strong>Email:</strong> <a href="mailto:${escHtml(input.email)}">${escHtml(input.email)}</a></p>
            <p><strong>Subject:</strong> ${escHtml(input.subject)}</p>
            <hr />
            <p style="white-space:pre-wrap">${escHtml(input.message)}</p>
          `,
        }),
      })
      if (!res.ok) {
        // Email failure is non-fatal — message is already saved to DB
        console.error('[contact] Resend error', res.status, await res.text())
      }
    }

    return ok({ sent: true })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    return serverError(err)
  }
}

function escHtml(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
