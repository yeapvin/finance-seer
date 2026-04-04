import { NextRequest, NextResponse } from 'next/server'
import { getHistoricalOHLCV, getIntradayOHLCV } from '@/lib/market-data'
import { calculateAllIndicators } from '@/lib/indicators'
import { detectPatterns } from '@/lib/patterns'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { ticker: string } }) {
  try {
    const ticker = (params.ticker as string).toUpperCase()
    const period = (request.nextUrl.searchParams.get('period') || '1mo') as string

    const history = period === '1d'
      ? await getIntradayOHLCV(ticker)
      : await getHistoricalOHLCV(ticker, period)

    if (!history.length) {
      return NextResponse.json({ error: 'No historical data' }, { status: 404 })
    }

    const prices = history.map(h => h.close)
    const highs = history.map(h => h.high)
    const lows = history.map(h => h.low)
    const opens = history.map(h => h.open)

    const indicators = calculateAllIndicators(prices, highs, lows)

    // Always detect patterns from 6mo data for accurate date ranging
    // regardless of what period the chart is showing
    const patternHistory = period === '6mo' || period === '1y' || period === '5y'
      ? history
      : await getHistoricalOHLCV(ticker, '6mo')
    const patternPrices = patternHistory.map((h: any) => h.close)
    const patternHighs = patternHistory.map((h: any) => h.high)
    const patternLows = patternHistory.map((h: any) => h.low)
    const patternOpens = patternHistory.map((h: any) => h.open)

    const rawPatterns = detectPatterns(patternPrices, { open: patternOpens, high: patternHighs, low: patternLows, close: patternPrices })

    // Enrich patterns with dates derived from pattern history index
    const patterns = rawPatterns.map(p => ({
      ...p,
      startDate: patternHistory[p.startIndex]?.date ? new Date(patternHistory[p.startIndex].date).toISOString().split('T')[0] : null,
      endDate: patternHistory[p.endIndex]?.date ? new Date(patternHistory[p.endIndex].date).toISOString().split('T')[0] : null,
    }))

    const cacheMax = period === '1d' ? 900 : 3600
    const response = NextResponse.json({ ticker, period, history, indicators, patterns })
    response.headers.set('Cache-Control', `public, max-age=${cacheMax}`)
    return response
  } catch (error) {
    console.error(`History error for ${params.ticker}:`, error)
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
  }
}
