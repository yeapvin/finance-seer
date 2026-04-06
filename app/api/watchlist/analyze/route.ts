/**
 * Watchlist Analysis — uses the same engine as /api/analyze
 * so recommendations match the stock page exactly.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getLiveQuote, getHistoricalOHLCV, getNews } from '@/lib/market-data'
import { StockData } from '@/lib/market-data'
import { calculateAllIndicators } from '@/lib/indicators'
import { detectPatterns } from '@/lib/patterns'
import { generateAnalysisReport } from '@/lib/analysis'
import { readPortfolio } from '@/lib/portfolio-store'

export const dynamic = 'force-dynamic'

const cache = new Map<string, { data: any; ts: number }>()
const CACHE_TTL = 15 * 60 * 1000 // 15 min

async function analyseTicker(ticker: string): Promise<any> {
  const cached = cache.get(ticker)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data

  try {
    const [quote, history, news] = await Promise.all([
      getLiveQuote(ticker),
      getHistoricalOHLCV(ticker, '1y'),
      getNews(ticker),
    ])

    if (!quote || !history.length) return null

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

    const prices  = history.map((h: any) => h.close)
    const highs   = history.map((h: any) => h.high)
    const lows    = history.map((h: any) => h.low)
    const opens   = history.map((h: any) => h.open)
    const volumes = history.map((h: any) => h.volume)

    const indicators = calculateAllIndicators(prices, highs, lows)
    const rawPatterns = detectPatterns(prices, { open: opens, high: highs, low: lows, close: prices })
    const patterns = rawPatterns.map((p: any) => ({
      ...p,
      startDate: history[p.startIndex]?.date ? new Date(history[p.startIndex].date).toISOString().split('T')[0] : null,
      endDate:   history[p.endIndex]?.date   ? new Date(history[p.endIndex].date).toISOString().split('T')[0]   : null,
    }))
    const headlines = news.map((n: any) => n.headline)

    const report = await generateAnalysisReport(stock, prices, indicators, patterns, headlines, volumes)

    // Pull out just what the watchlist UI needs
    const slMatch  = report.tradingStrategy?.stopLoss?.match(/\$([\d.]+)/)
    const tpMatch  = report.tradingStrategy?.takeProfit?.match(/\$([\d.]+)/)
    const rrMatch  = report.riskAssessment?.match(/1:([\d.]+)/)
    const rsiMatch = report.technicalAnalysis?.match(/RSI \((\d+\.?\d*)\)/)

    const result = {
      ticker,
      signal:         report.recommendation,
      conviction:     report.recommendation === 'HOLD' ? 'LOW' : 'MEDIUM',
      currentPrice:   stock.price,
      suggestedEntry: report.priceTargets?.support?.[0] 
                        ? parseFloat(report.priceTargets.support[0].toFixed(2))
                        : parseFloat(stock.price.toFixed(2)),
      stopLoss:       slMatch  ? parseFloat(slMatch[1])  : parseFloat((stock.price * 0.95).toFixed(2)),
      takeProfit:     tpMatch  ? parseFloat(tpMatch[1])  : parseFloat((stock.price * 1.08).toFixed(2)),
      rsi:            rsiMatch ? parseFloat(rsiMatch[1]) : 0,
      rr:             rrMatch  ? rrMatch[1] : '—',
      strategy:       report.recommendationReason || '',
    }

    cache.set(ticker, { data: result, ts: Date.now() })
    return result
  } catch (e) {
    console.error(`Watchlist analysis failed for ${ticker}:`, e)
    return null
  }
}

export async function GET(req: NextRequest) {
  try {
    const ticker = req.nextUrl.searchParams.get('ticker')

    if (ticker) {
      const result = await analyseTicker(ticker.toUpperCase())
      if (!result) return NextResponse.json({ error: 'No data' }, { status: 404 })
      return NextResponse.json(result)
    }

    const portfolio = await readPortfolio()
    const tickers: string[] = (portfolio.watchlist || []).map((w: any) => w.ticker)

    // Analyse sequentially to avoid rate-limiting Finnhub
    const analysis: Record<string, any> = {}
    for (const t of tickers) {
      const r = await analyseTicker(t)
      if (r) analysis[t] = r
    }

    return NextResponse.json(analysis)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
