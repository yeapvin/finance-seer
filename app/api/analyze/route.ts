import { NextRequest, NextResponse } from 'next/server'
import { getLiveQuote, getHistoricalOHLCV, getNews } from '@/lib/market-data'
import { StockData } from '@/lib/market-data'
import { calculateAllIndicators } from '@/lib/indicators'
import { detectPatterns } from '@/lib/patterns'
import { generateAnalysisReport } from '@/lib/analysis'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { ticker } = await request.json()
    const tickerUpper = ticker.toUpperCase()

    // All data from Finnhub (live) + Yahoo (historical OHLCV only)
    const [quote, history, news] = await Promise.all([
      getLiveQuote(tickerUpper),
      getHistoricalOHLCV(tickerUpper, '1y'),
      getNews(tickerUpper),
    ])

    if (!quote) return NextResponse.json({ error: 'Stock not found' }, { status: 404 })
    if (!history.length) return NextResponse.json({ error: 'Insufficient price history' }, { status: 400 })

    const stock: StockData = {
      ticker: quote.ticker,
      name: quote.name,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      volume: quote.volume,
      marketCap: quote.marketCap,
      peRatio: quote.peRatio,
      dividendYield: quote.dividendYield,
      dayHigh: quote.dayHigh,
      dayLow: quote.dayLow,
      open: quote.open,
      previousClose: quote.previousClose,
      week52High: quote.week52High,
      week52Low: quote.week52Low,
      currency: quote.currency,
      exchange: quote.exchange,
    }

    const prices = history.map(h => h.close)
    const highs = history.map(h => h.high)
    const lows = history.map(h => h.low)
    const opens = history.map(h => h.open)
    const volumes = history.map(h => h.volume)

    const indicators = calculateAllIndicators(prices, highs, lows)
    const patterns = detectPatterns(prices, { open: opens, high: highs, low: lows, close: prices })
    const headlines = news.map(n => n.headline)

    const report = await generateAnalysisReport(stock, prices, indicators, patterns, headlines, volumes)
    return NextResponse.json(report)
  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json({ error: 'Failed to generate analysis' }, { status: 500 })
  }
}
