// GET /api/health — uptime check (public, no auth)
import { ok } from '@/lib/api'

export function GET() {
  return ok({ status: 'ok', ts: new Date().toISOString() })
}
