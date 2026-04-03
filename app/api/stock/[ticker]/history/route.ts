import { NextRequest, NextResponse } from 'next/server'
import { getHistoricalData, getIntradayData } from '@/lib/yahoo'
import { calculateAllIndicators } from '@/lib/indicators'
import { detectPatterns } from '@/lib/patterns'

export const dynamic = 'force-dynamic'

// Map period to seconds for Finnhub
function periodToSeconds(period: string): number {
  const map: Record<string, number> = {
    '1d': 1 * 24 * 60 * 60,
    '5d': 5 * 24 * 60 * 60,
    '1mo': 30 * 24 * 60 * 60,
    '3mo': 90 * 24 * 60 * 60,
    '6mo': 180 * 24 * 60 * 60,
    '1y': 365 * 24 * 60 * 60,
    '5y': 5 * 365 * 24 * 60 * 60,
  }
  return map[period] || 30 * 24 * 60 * 60
}

async function getFinnhubCandles(ticker: string, period: string) {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey) return null

  const resolution = period === '1d' ? '5' : period === '5d' ? '15' : 'D'
  const to = Math.floor(Date.now() / 1000)
  const from = to - periodToSeconds(period)

  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=${resolution}&from=${from}&to=${to}&token=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) return null

  const data = await res.json()
  if (data.s !== 'ok' || !data.t || data.t.length === 0) return null

  return data.t.map((ts: number, i: number) => ({
    date: new Date(ts * 1000),
    open: data.o[i],
    high: data.h[i],
    low: data.l[i],
    close: data.c[i],
    volume: data.v[i],
    adjClose: data.c[i],
  }))
}

export async function GET(
  request: NextRequest,
  { params }: { params: { ticker: string } },
) {
  try {
    const ticker = (params.ticker as string).toUpperCase()
    const period = (request.nextUrl.searchParams.get('period') || '1mo') as
      | '1d'
      | '5d'
      | '1mo'
      | '3mo'
      | '6mo'
      | '1y'
      | '5y'

    // Try Finnhub candles first, fall back to Yahoo
    let history
    try {
      const finnhubData = await getFinnhubCandles(ticker, period)
      if (finnhubData && finnhubData.length > 0) {
        history = finnhubData
      }
    } catch (e) {
      // Finnhub failed, will fall through to Yahoo
    }

    if (!history) {
      if (period === '1d') {
        history = await getIntradayData(ticker)
      } else {
        history = await getHistoricalData(ticker, period)
      }
    }

    const prices = history.map((h) => h.close)
    const highs = history.map((h) => h.high)
    const lows = history.map((h) => h.low)
    const opens = history.map((h) => h.open)

    const indicators = calculateAllIndicators(prices, highs, lows)
    const patterns = detectPatterns(prices, { open: opens, high: highs, low: lows, close: prices })

    const response = NextResponse.json({
      ticker,
      period,
      history,
      indicators,
      patterns,
    })

    // Cache successful responses at the edge
    // Intraday (1d): shorter cache (15 min) for freshness
    // Daily+: longer cache (1 hour)
    const cacheMax = period === '1d' ? 900 : 3600
    response.headers.set('Cache-Control', `public, max-age=${cacheMax}`)

    return response
  } catch (error) {
    console.error(`Error fetching history for ${params.ticker}:`, error)
    return NextResponse.json(
      { error: 'Failed to fetch historical data' },
      { status: 500 },
    )
  }
}

