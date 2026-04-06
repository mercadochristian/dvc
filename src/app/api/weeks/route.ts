import { NextResponse } from 'next/server'
import { searchWeeklySheets } from '@/lib/sheets'

export async function GET() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return NextResponse.json(
      { error: 'Google credentials not configured' },
      { status: 500 }
    )
  }

  try {
    const weeks = await searchWeeklySheets()
    return NextResponse.json({ weeks })
  } catch (err) {
    console.error('[/api/weeks] error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch weekly sheets' },
      { status: 500 }
    )
  }
}
