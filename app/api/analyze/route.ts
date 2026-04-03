import { NextRequest, NextResponse } from 'next/server'
import { getStockData } from '@/lib/yahoo'
import { calculateAllIndicators } from '@/lib/indicators'
import { detectPatterns } from '@/lib/patterns'
import { generateAnalysisReport } from '@/lib/analysis'

export const dynamic = 'force-dynamic'

async function getFinnhubData(ticker: string) {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey) return null
  try {
    const symbol = ticker.endsWith('.SI') ? ticker.replace('.SI', ':SP') : ticker
    const to = Math.floor(Date.now() / 1000)
    const from = to - 365 * 24 * 60 * 60

    const [candleRes, newsRes, quoteRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${apiKey}`),
      fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${new Date(Date.now()-7*86400000).toISOString().split('T')[0]}&to=${new Date().toISOString().split('T')[0]}&token=${apiKey}`),
      fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`)
    ])

    const candle = await candleRes.json()
    const news = newsRes.ok ? await newsRes.json() : []
    const quote = quoteRes.ok ? await quoteRes.json() : null

    if (candle.s !== 'ok' || !candle.c?.length) return null

    const history = candle.t.map((ts: number, i: number) => ({
      date: new Date(ts * 1000),
      open: candle.o[i], high: candle.h[i], low: candle.l[i],
      close: candle.c[i], volume: candle.v[i], adjClose: candle.c[i]
    }))

    const headlines = (news || []).slice(0, 8).map((n: any) => n.headline || '').filter(Boolean)

    return { history, headlines, quote }
  } catch { return null }
}

export async function POST(request: NextRequest) {
  try {
    const { ticker } = await request.json()
    const tickerUpper = ticker.toUpperCase()

    // Try Finnhub first, fall back to Yahoo
    const finnhubData = await getFinnhubData(tickerUpper)

    let history: any[], newsHeadlines: string[]

    if (finnhubData && finnhubData.history.length >= 50) {
      history = finnhubData.history
      newsHeadlines = finnhubData.headlines.length > 0
        ? finnhubData.headlines
        : [`${tickerUpper} market activity update`, `${tickerUpper} technical levels in focus`]
    } else {
      // Yahoo fallback
      const { getHistoricalData } = await import('@/lib/yahoo')
      history = await getHistoricalData(tickerUpper, '1y')
      newsHeadlines = [`${tickerUpper} market activity update`]
    }

    if (!history || history.length < 20) {
      return NextResponse.json({ error: 'Insufficient price data' }, { status: 400 })
    }

    // Get stock quote
    let stock: any
    try {
      stock = await getStockData(tickerUpper)
    } catch {
      // Build minimal stock object from Finnhub quote
      const q = finnhubData?.quote
      stock = {
        ticker: tickerUpper, name: tickerUpper,
        price: q?.c || history[history.length-1].close,
        change: q ? q.c - q.pc : 0,
        changePercent: q?.pc > 0 ? ((q.c - q.pc) / q.pc) * 100 : 0,
        volume: 0, marketCap: 0, peRatio: 0, dividendYield: 0,
        week52High: q?.h || 0, week52Low: q?.l || 0,
      }
    }

    const prices = history.map((h: any) => h.close)
    const highs = history.map((h: any) => h.high)
    const lows = history.map((h: any) => h.low)
    const volumes = history.map((h: any) => h.volume)

    // Full 1y for indicators
    const indicators = calculateAllIndicators(prices, highs, lows)

    // 1 year for patterns (as requested — revert from 6 months)
    const opens = history.map((h: any) => h.open)
    const patterns = detectPatterns(prices, { open: opens, high: highs, low: lows, close: prices })

    const report = await generateAnalysisReport(stock, prices, indicators, patterns, newsHeadlines, volumes)

    return NextResponse.json(report)
  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json({ error: 'Failed to generate analysis' }, { status: 500 })
  }
}
