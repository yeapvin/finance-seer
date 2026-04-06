/**
 * Curated basket — Joobi's top picks across sectors
 * Runs the same analysis engine, returns top BUY-rated stocks ranked by R/R
 */
import { NextResponse } from 'next/server'
import { getLiveQuote, getHistoricalOHLCV, getNews } from '@/lib/market-data'
import { StockData } from '@/lib/market-data'
import { calculateAllIndicators } from '@/lib/indicators'
import { detectPatterns, findSupportResistance } from '@/lib/patterns'
import { generateAnalysisReport } from '@/lib/analysis'

export const dynamic = 'force-dynamic'

// Curated universe — diversified across sectors, all US-listed
const BASKET_UNIVERSE = [
  // Mega-cap tech
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'AMZN',
  // Growth tech
  'ADSK', 'CRM', 'SNOW', 'PLTR', 'NET', 'DDOG', 'CRWD',
  // Semiconductors
  'AMD', 'AVGO', 'TSM', 'AMAT', 'LRCX',
  // Finance
  'JPM', 'V', 'MA', 'GS',
  // Healthcare
  'LLY', 'ABBV', 'UNH',
  // Consumer
  'COST', 'AMZN', 'NKE',
  // Industrial / Energy
  'CAT', 'XOM', 'CVX',
  // ETFs (broad)
  'SPY', 'QQQ', 'VGT', 'SOXX',
]

// Deduplicate
const TICKERS = [...new Set(BASKET_UNIVERSE)]

const cache = new Map<string, { data: any; ts: number }>()
const CACHE_TTL = 30 * 60 * 1000 // 30 min — basket is expensive, cache longer

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
  return recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0
}

async function analyseTicker(ticker: string): Promise<any | null> {
  const cacheKey = `basket:${ticker}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data

  try {
    const [quote, history, news] = await Promise.all([
      getLiveQuote(ticker),
      getHistoricalOHLCV(ticker, '1y'),
      getNews(ticker),
    ])
    if (!quote || !history || history.length < 50) return null

    const stock: StockData = {
      ticker: quote.ticker, name: quote.name, price: quote.price,
      change: quote.change, changePercent: quote.changePercent,
      volume: quote.volume, marketCap: quote.marketCap, peRatio: quote.peRatio,
      dividendYield: quote.dividendYield, dayHigh: quote.dayHigh, dayLow: quote.dayLow,
      open: quote.open, previousClose: quote.previousClose,
      week52High: quote.week52High, week52Low: quote.week52Low,
      currency: quote.currency, exchange: quote.exchange,
    }

    const prices  = history.map((h: any) => h.close)
    const highs   = history.map((h: any) => h.high)
    const lows    = history.map((h: any) => h.low)
    const opens   = history.map((h: any) => h.open)
    const volumes = history.map((h: any) => h.volume)

    const indicators  = calculateAllIndicators(prices, highs, lows)
    const rawPatterns = detectPatterns(prices, { open: opens, high: highs, low: lows, close: prices })
    const patterns    = rawPatterns.map((p: any) => ({
      ...p,
      startDate: history[p.startIndex]?.date ? new Date(history[p.startIndex].date).toISOString().split('T')[0] : null,
      endDate:   history[p.endIndex]?.date   ? new Date(history[p.endIndex].date).toISOString().split('T')[0]   : null,
    }))
    const headlines = news.map((n: any) => n.headline)

    const report = await generateAnalysisReport(stock, prices, indicators, patterns, headlines, volumes)
    const signal = report.recommendation

    // SL/TP — always long perspective
    const p = stock.price
    const atr = calcATR(highs, lows, prices)
    const { support, resistance } = findSupportResistance(prices)
    const nearSupport    = support.filter(s => s < p).sort((a, b) => b - a)[0]    || p * 0.95
    const nearResistance = resistance.filter(r => r > p).sort((a, b) => a - b)[0] || p * 1.08

    const stopLoss   = parseFloat(Math.max(nearSupport - atr * 0.5, p * 0.90).toFixed(2))
    const takeProfit = parseFloat(Math.min(nearResistance + atr * 0.5, p * 1.20).toFixed(2))

    const risk   = p - stopLoss
    const reward = takeProfit - p
    const rr     = risk > 0 ? parseFloat((reward / risk).toFixed(1)) : 0

    const rsiMatch = report.technicalAnalysis?.match(/RSI \((\d+\.?\d*)\)/)
    const rsi = rsiMatch ? parseFloat(rsiMatch[1]) : 0

    const result = {
      ticker,
      name: stock.name,
      signal,
      conviction: signal === 'BUY' ? (rr >= 2 ? 'HIGH' : 'MEDIUM') : signal === 'HOLD' ? 'LOW' : 'MEDIUM',
      currentPrice:   parseFloat(p.toFixed(2)),
      suggestedEntry: parseFloat(p.toFixed(2)),
      stopLoss,
      takeProfit,
      rsi,
      rr: rr.toFixed(1),
      changePct: parseFloat(stock.changePercent.toFixed(2)),
      strategy: report.recommendationReason || '',
    }

    cache.set(cacheKey, { data: result, ts: Date.now() })
    return result
  } catch {
    return null
  }
}

export async function GET() {
  try {
    const results: any[] = []

    // Process in batches of 5 to avoid hammering APIs
    const BATCH = 5
    for (let i = 0; i < TICKERS.length; i += BATCH) {
      const batch = TICKERS.slice(i, i + BATCH)
      const settled = await Promise.allSettled(batch.map(t => analyseTicker(t)))
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) results.push(r.value)
      }
    }

    // Keep only BUY signals, ranked by R/R
    const buys = results
      .filter(r => r.signal === 'BUY' || r.signal === 'STRONG BUY')
      .sort((a, b) => parseFloat(b.rr) - parseFloat(a.rr))

    return NextResponse.json(buys)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
