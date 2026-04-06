/**
 * Watchlist Analysis — same recommendation engine as /api/analyze,
 * but SL/TP computed directly from ATR + support/resistance anchored to current price.
 * Entry = current price always.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getLiveQuote, getHistoricalOHLCV, getNews } from '@/lib/market-data'
import { StockData } from '@/lib/market-data'
import { calculateAllIndicators } from '@/lib/indicators'
import { detectPatterns, findSupportResistance } from '@/lib/patterns'
import { generateAnalysisReport } from '@/lib/analysis'
import { readPortfolio } from '@/lib/portfolio-store'

export const dynamic = 'force-dynamic'

const cache = new Map<string, { data: any; ts: number }>()
const CACHE_TTL = 15 * 60 * 1000 // 15 min

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  const trs: number[] = []
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ))
  }
  const recent = trs.slice(-period)
  return recent.reduce((a, b) => a + b, 0) / recent.length
}

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

    // Get recommendation from the same engine as the stock page
    const report = await generateAnalysisReport(stock, prices, indicators, patterns, headlines, volumes)
    const signal = report.recommendation  // 'BUY' | 'SELL' | 'HOLD'

    // ── Compute SL/TP directly from current price, ATR, and S/R ────────────
    const p = stock.price
    const atr = calcATR(highs, lows, prices)
    const { support, resistance } = findSupportResistance(prices)

    // Nearest support below price, nearest resistance above price
    const nearSupport    = support.filter(s => s < p).sort((a, b) => b - a)[0]    || p * 0.95
    const nearResistance = resistance.filter(r => r > p).sort((a, b) => a - b)[0] || p * 1.08

    let stopLoss: number
    let takeProfit: number

    if (signal === 'BUY') {
      // SL: just below nearest support, capped at 10% below entry
      stopLoss   = parseFloat(Math.max(nearSupport - atr * 0.5, p * 0.90).toFixed(2))
      // TP: nearest resistance above, extended by ATR, capped at 20% above entry
      takeProfit = parseFloat(Math.min(nearResistance + atr * 0.5, p * 1.20).toFixed(2))
    } else if (signal === 'SELL') {
      // SL: just above nearest resistance, capped at 10% above entry
      stopLoss   = parseFloat(Math.min(nearResistance + atr * 0.5, p * 1.10).toFixed(2))
      // TP: nearest support below, extended by ATR, capped at 20% below entry
      takeProfit = parseFloat(Math.max(nearSupport - atr * 0.5, p * 0.80).toFixed(2))
    } else {
      // HOLD: show conservative levels either side
      stopLoss   = parseFloat(Math.max(nearSupport - atr * 0.3, p * 0.93).toFixed(2))
      takeProfit = parseFloat(Math.min(nearResistance + atr * 0.3, p * 1.10).toFixed(2))
    }

    // R/R
    const risk   = Math.abs(p - stopLoss)
    const reward = Math.abs(takeProfit - p)
    const rr     = risk > 0 ? (reward / risk).toFixed(1) : '—'

    // RSI
    const rsiMatch = report.technicalAnalysis?.match(/RSI \((\d+\.?\d*)\)/)
    const rsi = rsiMatch ? parseFloat(rsiMatch[1]) : 0

    const result = {
      ticker,
      signal,
      conviction: signal === 'HOLD' ? 'LOW' : 'MEDIUM',
      currentPrice:   parseFloat(p.toFixed(2)),
      suggestedEntry: parseFloat(p.toFixed(2)),
      stopLoss,
      takeProfit,
      rsi,
      rr,
      strategy: report.recommendationReason || '',
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
