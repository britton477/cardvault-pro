// =============================================================================
// GET /api/cards/by-ids?ids=uuid1,uuid2,...
//
// Returns up to 50 org-scoped cards by explicit ID list.
// Used by the print labels page.
// =============================================================================
import { type NextRequest } from 'next/server'
import { z, ZodError }      from 'zod'
import { createAdminClient }                                from '@/lib/supabase/server'
import { requireAuth, ok, badRequest, serverError, validationError } from '@/lib/api'

const QuerySchema = z.object({
  ids: z.string().min(1),
})

export async function GET(request: NextRequest) {
  try {
    const { orgId } = await requireAuth()
    const params    = Object.fromEntries(request.nextUrl.searchParams)
    const { ids }   = QuerySchema.parse(params)

    const idList = ids
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 50)   // hard cap — matches BulkActionBar warning threshold

    if (idList.length === 0) return badRequest('No IDs provided')

    const db = createAdminClient()
    const { data, error } = await db
      .from('cards')
      .select('*, photos:card_photos(id, url, thumb_url, position)')
      .in('id', idList)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('card_name', { ascending: true })

    if (error) throw error

    return ok({ data: data ?? [] })
  } catch (err) {
    if (err instanceof ZodError) return validationError(err)
    if (err instanceof Response) return err
    return serverError(err)
  }
}
