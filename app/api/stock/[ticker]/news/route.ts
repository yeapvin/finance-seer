import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { ticker: string } },
) {
  try {
    const ticker = (params.ticker as string).toUpperCase()

    const headlines = [
      `${ticker} stock shows strong technical setup`,
      `Analysts upgrade ${ticker} on strong earnings`,
      `${ticker} gains amid market recovery`,
      `Market sentiment on ${ticker} remains positive`,
      `${ticker} reaches new 52-week high`,
    ]

    return NextResponse.json({
      ticker,
      headlines,
      sentiment: 'neutral',
    })
  } catch (error) {
    console.error(`Error fetching news for ${params.ticker}:`, error)
    return NextResponse.json(
      { error: 'Failed to fetch news' },
      { status: 500 },
    )
  }
}
