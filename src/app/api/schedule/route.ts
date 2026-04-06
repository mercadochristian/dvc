import { NextRequest, NextResponse } from 'next/server'
import { buildWeekSchedule, searchWeeklySheets } from '@/lib/sheets'

export async function GET(request: NextRequest) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return NextResponse.json(
      { error: 'Google credentials not configured' },
      { status: 500 }
    )
  }

  const { searchParams } = request.nextUrl
  const weekId = searchParams.get('week')

  if (!weekId) {
    return NextResponse.json(
      { error: 'Missing required query param: week' },
      { status: 400 }
    )
  }

  try {
    // Look up weekNumber for the given spreadsheet ID
    const weeks = await searchWeeklySheets()
    const weekInfo = weeks.find(w => w.id === weekId)
    const weekNumber = weekInfo?.weekNumber ?? 0

    const schedule = await buildWeekSchedule(weekId, weekNumber)
    return NextResponse.json(schedule)
  } catch (err) {
    console.error('[/api/schedule] error:', err)
    return NextResponse.json(
      { error: 'Failed to load schedule' },
      { status: 500 }
    )
  }
}
