import { NextRequest, NextResponse } from 'next/server'
import { getLiveQuote, getHistoricalOHLCV } from '@/lib/market-data'

export const dynamic = 'force-dynamic'

export async function GET(_: NextRequest, { params }: { params: { ticker: string } }) {
  try {
    const ticker = (params.ticker as string).toUpperCase()
    const data = await getLiveQuote(ticker)
    if (!data) return NextResponse.json({ error: 'Stock not found' }, { status: 404 })

    // Finnhub free tier doesn't return volume — get it from last candle
    if (!data.volume) {
      const history = await getHistoricalOHLCV(ticker, '5d')
      if (history.length > 0) {
        data.volume = history[history.length - 1].volume || 0
      }
    }

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch stock data' }, { status: 500 })
  }
}
