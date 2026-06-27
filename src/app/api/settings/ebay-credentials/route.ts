// =============================================================================
// GET  /api/settings/ebay-credentials  — returns { has_credentials, updated_at }
//                                        NEVER returns actual credential values
// POST /api/settings/ebay-credentials  — encrypts + saves eBay API credentials
//
// Credentials are stored AES-256-GCM encrypted in the ebay_credentials table
// via saveCredentials() in lib/ebay.ts.  The encryption key is EBAY_ENCRYPTION_KEY
// (32-byte hex in .env.local — NEVER uploaded to Supabase).
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAuth, ok, serverError, validationError } from '@/lib/api'
import { EbayCredentialsSchema } from '@/types/validation'
import { saveCredentials } from '@/lib/ebay'
import { writeAuditLog } from '@/lib/audit'

export async function GET() {
  try {
    const { orgId } = await requireAuth()
    const db = createAdminClient()

    const { data } = await db
      .from('ebay_credentials')
      .select('org_id, updated_at')
      .eq('org_id', orgId)
      .maybeSingle()

    return ok({
      has_credentials: !!data,
      updated_at: (data as { updated_at?: string } | null)?.updated_at ?? null,
    })
  } catch (err) {
    if (err instanceof Response) return err
    return serverError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth()
    const body  = await request.json() as unknown
    const input = EbayCredentialsSchema.parse(body)

    // AES-256-GCM encryption happens inside saveCredentials (lib/ebay.ts)
    await saveCredentials(orgId, {
      appId:  input.app_id,
      secret: input.secret,
      ruName: input.ru_name,
    })

    void writeAuditLog({
      orgId,
      userId:     user.id,
      action:     'ebay.credentials.update',
      entityType: 'ebay_credentials',
      entityId:   orgId,
      // Audit log only records timestamp — never the actual credential values
      after: { saved_at: new Date().toISOString() },
    })

    return ok({ success: true })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
