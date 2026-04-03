import { NextRequest, NextResponse } from 'next/server'
import { StockData, getHistoricalData } from '@/lib/yahoo'
import { calculateAllIndicators } from '@/lib/indicators'
import { detectPatterns } from '@/lib/patterns'
import { generateAnalysisReport } from '@/lib/analysis'

export const dynamic = 'force-dynamic'

// Get live quote + fundamentals from Finnhub (free tier supports this)
async function getFinnhubQuoteAndProfile(ticker: string) {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey) return null

  try {
    const symbol = ticker.endsWith('.SI') ? ticker.replace('.SI', ':SP') : ticker
    const [quoteRes, profileRes, newsRes, metricsRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`),
      fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${apiKey}`),
      fetch(`https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${new Date(Date.now()-7*86400000).toISOString().split('T')[0]}&to=${new Date().toISOString().split('T')[0]}&token=${apiKey}`),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${apiKey}`)
    ])

    const [quote, profile, newsRaw, metricsRaw] = await Promise.all([
      quoteRes.json(), profileRes.json(),
      newsRes.ok ? newsRes.json() : [],
      metricsRes.ok ? metricsRes.json() : {}
    ])

    if (!quote.c) return null

    const metrics = metricsRaw?.metric || {}
    const week52High = metrics['52WeekHigh'] || quote.h || 0
    const week52Low = metrics['52WeekLow'] || quote.l || 0

    const stock: StockData = {
      ticker,
      name: profile.name || ticker,
      price: quote.c,
      change: quote.c - quote.pc,
      changePercent: quote.pc > 0 ? ((quote.c - quote.pc) / quote.pc) * 100 : 0,
      volume: quote.v || 0,
      marketCap: (profile.marketCapitalization || 0) * 1e6,
      peRatio: metrics.peBasicExclExtraTTM || metrics['peNormalizedAnnual'] || 0,
      dividendYield: metrics.dividendYieldIndicatedAnnual || 0,
      dayHigh: quote.h || quote.c,
      dayLow: quote.l || quote.c,
      open: quote.o || quote.c,
      previousClose: quote.pc,
      week52High,
      week52Low,
      currency: profile.currency || (ticker.endsWith('.SI') ? 'SGD' : 'USD'),
      exchange: profile.exchange || '',
    }

    const newsHeadlines = (newsRaw || [])
      .slice(0, 8)
      .map((n: any) => n.headline || '')
      .filter(Boolean)

    return { stock, newsHeadlines }
  } catch { return null }
}

export async function POST(request: NextRequest) {
  try {
    const { ticker } = await request.json()
    const tickerUpper = ticker.toUpperCase()

    // Finnhub: live quote + fundamentals + news
    const finnhub = await getFinnhubQuoteAndProfile(tickerUpper)

    // Yahoo: historical OHLCV (Finnhub candles require paid plan)
    const history = await getHistoricalData(tickerUpper, '1y')

    if (!history || history.length < 20) {
      return NextResponse.json({ error: 'Insufficient price history' }, { status: 400 })
    }

    // Use Finnhub stock data if available, otherwise build from Yahoo history
    let stock: StockData
    if (finnhub?.stock) {
      stock = finnhub.stock
      // Patch 52w range from Yahoo history if Finnhub didn't return it
      if (!stock.week52High) {
        stock.week52High = Math.max(...history.map(h => h.high))
        stock.week52Low = Math.min(...history.map(h => h.low))
      }
    } else {
      // Build from Yahoo history
      const last = history[history.length - 1]
      stock = {
        ticker: tickerUpper, name: tickerUpper,
        price: last.close, change: last.close - last.open,
        changePercent: last.open > 0 ? ((last.close - last.open) / last.open) * 100 : 0,
        volume: last.volume, marketCap: 0, peRatio: 0, dividendYield: 0,
        dayHigh: last.high, dayLow: last.low,
        open: last.open, previousClose: history[history.length - 2]?.close || last.close,
        week52High: Math.max(...history.map(h => h.high)),
        week52Low: Math.min(...history.map(h => h.low)),
        currency: tickerUpper.endsWith('.SI') ? 'SGD' : 'USD',
        exchange: '',
      }
    }

    const prices = history.map(h => h.close)
    const highs = history.map(h => h.high)
    const lows = history.map(h => h.low)
    const opens = history.map(h => h.open)
    const volumes = history.map(h => h.volume)

    const indicators = calculateAllIndicators(prices, highs, lows)
    const patterns = detectPatterns(prices, { open: opens, high: highs, low: lows, close: prices })

    const headlines = finnhub?.newsHeadlines?.length
      ? finnhub.newsHeadlines
      : [`${tickerUpper} market activity update`]

    const report = await generateAnalysisReport(stock, prices, indicators, patterns, headlines, volumes)

    return NextResponse.json(report)
  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json({ error: 'Failed to generate analysis' }, { status: 500 })
  }
}
