import { NextRequest, NextResponse } from 'next/server'
import { StockData } from '@/lib/yahoo'
import { calculateAllIndicators } from '@/lib/indicators'
import { detectPatterns } from '@/lib/patterns'
import { generateAnalysisReport } from '@/lib/analysis'

export const dynamic = 'force-dynamic'

async function getFinnhubFullData(ticker: string): Promise<{
  stock: StockData
  history: any[]
  newsHeadlines: string[]
} | null> {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey) return null

  try {
    const symbol = ticker.endsWith('.SI') ? ticker.replace('.SI', ':SP') : ticker
    const to = Math.floor(Date.now() / 1000)
    const from = to - 365 * 24 * 60 * 60

    const [candleRes, quoteRes, profileRes, newsRes, metricsRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${apiKey}`),
      fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`),
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${apiKey}`),
      fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${new Date(Date.now()-7*86400000).toISOString().split('T')[0]}&to=${new Date().toISOString().split('T')[0]}&token=${apiKey}`),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${apiKey}`)
    ])

    const [candle, quote, profile, newsRaw, metricsRaw] = await Promise.all([
      candleRes.json(),
      quoteRes.json(),
      profileRes.json(),
      newsRes.ok ? newsRes.json() : [],
      metricsRes.ok ? metricsRes.json() : {}
    ])

    if (candle.s !== 'ok' || !candle.c?.length) return null

    const metrics = metricsRaw?.metric || {}
    const currentPrice = quote.c || candle.c[candle.c.length - 1]
    const prevClose = quote.pc || candle.c[candle.c.length - 2] || currentPrice
    const week52High = metrics['52WeekHigh'] || quote.h || Math.max(...candle.h)
    const week52Low = metrics['52WeekLow'] || quote.l || Math.min(...candle.l)

    const stock: StockData = {
      ticker,
      name: profile.name || ticker,
      price: currentPrice,
      change: currentPrice - prevClose,
      changePercent: prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0,
      volume: quote.v || candle.v?.[candle.v.length - 1] || 0,
      marketCap: (profile.marketCapitalization || 0) * 1e6,
      peRatio: metrics.peBasicExclExtraTTM || metrics['peNormalizedAnnual'] || 0,
      dividendYield: metrics.dividendYieldIndicatedAnnual || 0,
      dayHigh: quote.h || currentPrice,
      dayLow: quote.l || currentPrice,
      open: quote.o || currentPrice,
      previousClose: prevClose,
      week52High,
      week52Low,
      currency: profile.currency || (ticker.endsWith('.SI') ? 'SGD' : 'USD'),
      exchange: profile.exchange || '',
    }

    const history = candle.t.map((ts: number, i: number) => ({
      date: new Date(ts * 1000),
      open: candle.o[i], high: candle.h[i], low: candle.l[i],
      close: candle.c[i], volume: candle.v[i], adjClose: candle.c[i]
    }))

    const newsHeadlines = (newsRaw || [])
      .slice(0, 8)
      .map((n: any) => n.headline || '')
      .filter(Boolean)

    return { stock, history, newsHeadlines }
  } catch (e) {
    console.error('Finnhub full data error:', e)
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const { ticker } = await request.json()
    const tickerUpper = ticker.toUpperCase()

    const data = await getFinnhubFullData(tickerUpper)
    if (!data || data.history.length < 20) {
      return NextResponse.json({ error: 'Insufficient data for analysis' }, { status: 400 })
    }

    const { stock, history, newsHeadlines } = data

    const prices = history.map((h: any) => h.close)
    const highs = history.map((h: any) => h.high)
    const lows = history.map((h: any) => h.low)
    const opens = history.map((h: any) => h.open)
    const volumes = history.map((h: any) => h.volume)

    const indicators = calculateAllIndicators(prices, highs, lows)
    const patterns = detectPatterns(prices, { open: opens, high: highs, low: lows, close: prices })

    const headlines = newsHeadlines.length > 0
      ? newsHeadlines
      : [`${tickerUpper} market activity update`]

    const report = await generateAnalysisReport(stock, prices, indicators, patterns, headlines, volumes)

    return NextResponse.json(report)
  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json({ error: 'Failed to generate analysis' }, { status: 500 })
  }
}
