import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { deliverGameNotices } from '@/features/club/server/game-notices'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  const secret = process.env.DVC_GAME_MAIL_WORKER_SECRET
  const headers = { 'Cache-Control': 'no-store' }
  const digest = (value: string) => createHash('sha256').update(value).digest()
  if (!secret || secret.length < 32 ||
      !timingSafeEqual(digest(request.headers.get('authorization') || ''), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  }
  try {
    const results = await deliverGameNotices()
    return results
      ? NextResponse.json(results, { status: results.unsettled || results.deferred ? 503 : 200, headers })
      : NextResponse.json({ error: 'Game email delivery is unavailable' }, { status: 503, headers })
  } catch {
    return NextResponse.json({ error: 'Game email delivery is unavailable' }, { status: 503, headers })
  }
}
