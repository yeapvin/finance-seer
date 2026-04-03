import { NextRequest, NextResponse } from 'next/server'
import { getStockData, getHistoricalData } from '@/lib/yahoo'
import { calculateAllIndicators } from '@/lib/indicators'
import { detectPatterns } from '@/lib/patterns'
import { generateAnalysisReport } from '@/lib/analysis'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { ticker } = await request.json()

    const tickerUpper = ticker.toUpperCase()
    const stock = await getStockData(tickerUpper)
    const history = await getHistoricalData(tickerUpper, '1y')

    const prices = history.map((h) => h.close)
    const highs = history.map((h) => h.high)
    const lows = history.map((h) => h.low)
    const opens = history.map((h) => h.open)
    const volumes = history.map((h) => h.volume)

    // Use full 1y for indicators (SMA200 needs 200 days)
    const indicators = calculateAllIndicators(prices, highs, lows)

    // Cap pattern detection to last 6 months (~126 trading days)
    const SIX_MONTHS = 126
    const recentPrices = prices.slice(-SIX_MONTHS)
    const recentHighs = highs.slice(-SIX_MONTHS)
    const recentLows = lows.slice(-SIX_MONTHS)
    const recentOpens = opens.slice(-SIX_MONTHS)
    const patterns = detectPatterns(recentPrices, { open: recentOpens, high: recentHighs, low: recentLows, close: recentPrices })

    const newsHeadlines = [
      `${tickerUpper} shows strong momentum`,
      `Analysts maintain positive outlook`,
      `Stock continues uptrend`,
    ]

    const report = await generateAnalysisReport(stock, prices, indicators, patterns, newsHeadlines, volumes)

    return NextResponse.json(report)
  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json(
      { error: 'Failed to generate analysis' },
      { status: 500 },
    )
  }
}
