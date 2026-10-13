import { NextRequest, NextResponse } from 'next/server'
import { getRegisteredPlayers, searchWeeklySheets } from '@/lib/sheets'
import { parseLocalDate } from '@/lib/parse'

export async function GET(request: NextRequest) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return NextResponse.json({ error: 'Google credentials not configured' }, { status: 500 })
  }

  const params = request.nextUrl.searchParams
  const week = params.get('week')?.trim()
  const date = params.get('date')?.trim()
  const location = params.get('location')?.trim()
  const time = params.get('time')?.trim()
  if (!week || !date || !location || !time || !parseLocalDate(date) ||
      location.length > 200 || time.length > 200) {
    return NextResponse.json({ error: 'Missing or invalid game details' }, { status: 400 })
  }

  try {
    const weeks = await searchWeeklySheets()
    if (!weeks.some(item => item.id === week)) {
      return NextResponse.json({ error: 'Week not found' }, { status: 404 })
    }
    const players = await getRegisteredPlayers(week, { date, location, time })
    return NextResponse.json(players, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    console.error('[/api/registered-players] error:', error)
    return NextResponse.json(
      { error: 'Unable to load registered players' },
      { status: 500 },
    )
  }
}
