import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { clearCache } from '@/lib/sheets'

/**
 * Constant-time string comparison. Returns false on any length mismatch
 * without leaking timing information about the secret.
 */
function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Secret cache-clear endpoint. Requires the caller to pass a key matching
 * CACHE_CLEAR_SECRET (via the `x-cache-key` header or `?key=` query param).
 * Expires the shared Google Sheets cache so the next request re-reads fresh.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CACHE_CLEAR_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'Cache clearing is not configured' },
      { status: 500 }
    )
  }

  const provided =
    request.headers.get('x-cache-key') ??
    request.nextUrl.searchParams.get('key') ??
    ''

  if (!secretsMatch(provided, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  clearCache()
  return NextResponse.json({ cleared: true })
}
