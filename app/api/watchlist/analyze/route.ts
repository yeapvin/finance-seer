/**
 * Watchlist Analysis — quick per-ticker signal using indicators
 * Returns: signal, conviction, suggested entry, SL, TP, strategy summary
 */
import { NextRequest, NextResponse } from 'next/server'
import { getHistoricalOHLCV } from '@/lib/market-data'
import { calculateAllIndicators } from '@/lib/indicators'
import { readPortfolio } from '@/lib/portfolio-store'

export const dynamic = 'force-dynamic'

const cache = new Map<string, { data: any; ts: number }>()
const CACHE_TTL = 15 * 60 * 1000 // 15 min

function last(arr: number[] | undefined): number {
  if (!arr) return 0
  const v = arr.filter(x => !isNaN(x))
  return v[v.length - 1] ?? 0
}
function lastBB(arr: Array<{ upper: number; middle: number; lower: number }> | undefined) {
  if (!arr) return { upper: 0, middle: 0, lower: 0 }
  const v = arr.filter(x => !isNaN(x.middle))
  return v[v.length - 1] ?? { upper: 0, middle: 0, lower: 0 }
}
function lastStoch(arr: Array<{ k: number; d: number }> | undefined) {
  if (!arr) return { k: 50, d: 50 }
  const v = arr.filter(x => !isNaN(x.k))
  return v[v.length - 1] ?? { k: 50, d: 50 }
}

async function analyseTicker(ticker: string): Promise<any> {
  const cached = cache.get(ticker)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data

  try {
    const history = await getHistoricalOHLCV(ticker, '6mo')
    if (!history || history.length < 50) return null

    const prices = history.map((h: any) => h.close)
    const highs  = history.map((h: any) => h.high)
    const lows   = history.map((h: any) => h.low)
    const currentPrice = prices[prices.length - 1]

    const ind = calculateAllIndicators(prices, highs, lows)

    const rsi     = last(ind.rsi)
    const macd    = last(ind.macd)
    const macdSig = last((ind as any).signal ?? ind.macdSignal)
    const sma20   = last(ind.sma20)
    const sma50   = last(ind.sma50)
    const sma200  = last(ind.sma200)
    const bb      = lastBB(ind.bollingerBands)
    const stoch   = lastStoch(ind.stochastic)

    // ATR (14)
    const trs: number[] = []
    for (let i = 1; i < prices.length; i++) {
      trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - prices[i-1]), Math.abs(lows[i] - prices[i-1])))
    }
    const atr = trs.slice(-14).reduce((a, b) => a + b, 0) / 14

    // Support / resistance (simple swing lows/highs)
    const supports: number[] = []
    const resistances: number[] = []
    for (let i = 5; i < prices.length - 5; i++) {
      const window = prices.slice(i - 5, i + 5)
      if (prices[i] === Math.min(...window)) supports.push(prices[i])
      if (prices[i] === Math.max(...window)) resistances.push(prices[i])
    }
    const nearSupport = supports.filter(s => s < currentPrice).sort((a, b) => b - a)[0] || currentPrice * 0.95
    const nearResist  = resistances.filter(r => r > currentPrice).sort((a, b) => a - b)[0] || currentPrice * 1.08

    // ── Scoring ───────────────────────────────────────────────────────────────
    let score = 0
    const reasons: string[] = []

    // RSI
    if (rsi < 30)      { score += 30; reasons.push(`RSI ${rsi.toFixed(0)} — oversold`) }
    else if (rsi < 40) { score += 15; reasons.push(`RSI ${rsi.toFixed(0)} — approaching oversold`) }
    else if (rsi > 70) { score -= 25; reasons.push(`RSI ${rsi.toFixed(0)} — overbought`) }
    else if (rsi > 60) { score -= 10; reasons.push(`RSI ${rsi.toFixed(0)} — elevated`) }

    // MACD
    if (macd > macdSig)  { score += 15; reasons.push('MACD bullish cross') }
    else                 { score -= 10; reasons.push('MACD bearish') }

    // Price vs MAs
    if (currentPrice > sma20 && sma20 > sma50) { score += 10; reasons.push('Above SMA20 > SMA50') }
    if (currentPrice > sma200)                 { score += 10; reasons.push(`Above SMA200 ($${sma200.toFixed(2)})`) }
    else                                       { score -= 15; reasons.push(`Below SMA200 ($${sma200.toFixed(2)})`) }

    // Bollinger
    if (currentPrice < bb.lower) { score += 20; reasons.push(`Below BB lower ($${bb.lower.toFixed(2)}) — potential bounce`) }
    else if (currentPrice > bb.upper) { score -= 15; reasons.push(`Above BB upper ($${bb.upper.toFixed(2)}) — stretched`) }

    // Stochastic
    if (stoch.k < 20) { score += 10; reasons.push(`Stoch K ${stoch.k.toFixed(0)} — oversold`) }
    else if (stoch.k > 80) { score -= 10; reasons.push(`Stoch K ${stoch.k.toFixed(0)} — overbought`) }

    // Signal
    let signal: string
    let conviction: string
    if      (score >= 40) { signal = 'STRONG BUY';  conviction = 'HIGH' }
    else if (score >= 20) { signal = 'BUY';          conviction = 'MEDIUM' }
    else if (score <= -35){ signal = 'STRONG SELL';  conviction = 'HIGH' }
    else if (score <= -15){ signal = 'SELL';         conviction = 'MEDIUM' }
    else                  { signal = 'HOLD';         conviction = 'LOW' }

    // Entry / SL / TP
    const suggestedEntry = signal.includes('BUY')  ? Math.min(currentPrice, nearSupport * 1.005) :
                           signal.includes('SELL') ? Math.max(currentPrice, nearResist * 0.995)  :
                           currentPrice
    const sl = signal.includes('BUY')  ? Math.max(nearSupport - atr * 0.5, suggestedEntry * 0.93) :
               signal.includes('SELL') ? Math.min(nearResist  + atr * 0.5, suggestedEntry * 1.07) :
               currentPrice * 0.95
    const tp = signal.includes('BUY')  ? Math.min(nearResist, suggestedEntry + atr * 3) :
               signal.includes('SELL') ? Math.max(nearSupport, suggestedEntry - atr * 3) :
               currentPrice * 1.08

    const risk   = Math.abs(suggestedEntry - sl)
    const reward = Math.abs(tp - suggestedEntry)
    const rr     = risk > 0 ? (reward / risk).toFixed(1) : '—'

    // Strategy summary
    const topReasons = reasons.slice(0, 3).join('. ')
    const strategy = signal === 'HOLD'
      ? `Neutral — wait for clearer signal. ${topReasons}.`
      : signal.includes('BUY')
        ? `${signal} — enter near $${suggestedEntry.toFixed(2)}, SL $${sl.toFixed(2)}, TP $${tp.toFixed(2)} (R/R 1:${rr}). ${topReasons}.`
        : `${signal} — exit near $${suggestedEntry.toFixed(2)}, SL $${sl.toFixed(2)}, TP $${tp.toFixed(2)}. ${topReasons}.`

    const result = {
      ticker,
      signal,
      conviction,
      score,
      currentPrice,
      suggestedEntry: parseFloat(suggestedEntry.toFixed(2)),
      stopLoss:       parseFloat(sl.toFixed(2)),
      takeProfit:     parseFloat(tp.toFixed(2)),
      rr,
      rsi:   parseFloat(rsi.toFixed(1)),
      sma20: parseFloat(sma20.toFixed(2)),
      sma200:parseFloat(sma200.toFixed(2)),
      strategy,
      reasons: reasons.slice(0, 4),
    }

    cache.set(ticker, { data: result, ts: Date.now() })
    return result
  } catch (e) {
    console.error(`Analysis failed for ${ticker}:`, e)
    return null
  }
}

export async function GET(req: NextRequest) {
  try {
    const ticker = req.nextUrl.searchParams.get('ticker')

    // Single ticker mode
    if (ticker) {
      const result = await analyseTicker(ticker.toUpperCase())
      if (!result) return NextResponse.json({ error: 'No data' }, { status: 404 })
      return NextResponse.json(result)
    }

    // All watchlist tickers
    const portfolio = await readPortfolio()
    const watchlist: any[] = portfolio.watchlist || []
    const tickers = watchlist.map((w: any) => w.ticker)

    const results = await Promise.allSettled(tickers.map(t => analyseTicker(t)))
    const analysis: Record<string, any> = {}
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) {
        analysis[tickers[i]] = r.value
      }
    })

    return NextResponse.json(analysis)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
