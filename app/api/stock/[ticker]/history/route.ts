import { NextRequest, NextResponse } from 'next/server'
import { getHistoricalData, getIntradayData } from '@/lib/yahoo'
import { calculateAllIndicators } from '@/lib/indicators'
import { detectPatterns } from '@/lib/patterns'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { ticker: string } },
) {
  try {
    const ticker = (params.ticker as string).toUpperCase()
    const period = (request.nextUrl.searchParams.get('period') || '1mo') as
      | '1d'
      | '5d'
      | '1mo'
      | '3mo'
      | '6mo'
      | '1y'
      | '5y'

    // For 1D period, use intraday 1-minute data instead
    let history
    if (period === '1d') {
      history = await getIntradayData(ticker)
    } else {
      history = await getHistoricalData(ticker, period)
    }

    const prices = history.map((h) => h.close)
    const highs = history.map((h) => h.high)
    const lows = history.map((h) => h.low)
    const opens = history.map((h) => h.open)

    const indicators = calculateAllIndicators(prices, highs, lows)
    const patterns = detectPatterns(prices, { open: opens, high: highs, low: lows, close: prices })

    const response = NextResponse.json({
      ticker,
      period,
      history,
      indicators,
      patterns,
    })

    // Cache successful responses at the edge
    // Intraday (1d): shorter cache (15 min) for freshness
    // Daily+: longer cache (1 hour)
    const cacheMax = period === '1d' ? 900 : 3600
    response.headers.set('Cache-Control', `public, max-age=${cacheMax}`)

    return response
  } catch (error) {
    console.error(`Error fetching history for ${params.ticker}:`, error)
    return NextResponse.json(
      { error: 'Failed to fetch historical data' },
      { status: 500 },
    )
  }
}

