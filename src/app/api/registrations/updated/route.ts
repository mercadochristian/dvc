import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { parseRegistrationTabName } from '@/lib/parse'
import { invalidateRegistrationCache } from '@/lib/sheet-cache'

export async function POST(request: NextRequest) {
  const secret = process.env.REGISTRATION_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Registration updates are not configured' }, { status: 503 })
  }
  const provided = Buffer.from(request.headers.get('x-registration-key') ?? '')
  const expected = Buffer.from(secret)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: { spreadsheetId?: unknown; scheduleOption?: unknown } | null
  try {
    const text = await request.text()
    if (text.length > 4096) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
    payload = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!payload || typeof payload.spreadsheetId !== 'string' ||
      !/^[A-Za-z0-9_-]{10,100}$/.test(payload.spreadsheetId) ||
      typeof payload.scheduleOption !== 'string' || payload.scheduleOption.length > 500) {
    return NextResponse.json({ error: 'Invalid game details' }, { status: 400 })
  }
  const game = parseRegistrationTabName(payload.scheduleOption.trim())
  if (!game) return NextResponse.json({ error: 'Invalid game schedule' }, { status: 400 })

  try {
    // This only expires cache tags. It does not read Sheets or create registrations.
    invalidateRegistrationCache(payload.spreadsheetId, game)
    return NextResponse.json({ revalidated: true }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('[/api/registrations/updated] cache invalidation failed:', error)
    return NextResponse.json({ error: 'Unable to invalidate registration cache' }, { status: 503 })
  }
}
