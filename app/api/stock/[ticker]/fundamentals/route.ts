/**
 * Stock fundamentals + analyst consensus via mkts.io
 * Returns: analyst recommendation, target price, PE, margins, growth
 */
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const cache = new Map<string, { data: any; ts: number }>()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour — fundamentals don't change fast

export async function GET(_: NextRequest, { params }: { params: { ticker: string } }) {
  const ticker = (params.ticker as string).toUpperCase()

  const cached = cache.get(ticker)
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.data)
  }

  const apiKey = process.env.MKTS_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'MKTS_API_KEY not configured' }, { status: 500 })

  try {
    const res = await fetch(`https://mkts.io/api/v1/asset/${ticker}/details`, {
      headers: { 'X-API-Key': apiKey }
    })
    if (!res.ok) return NextResponse.json({ error: `mkts returned ${res.status}` }, { status: res.status })

    const json = await res.json()
    if (!json.success) return NextResponse.json({ error: json.error || 'Failed' }, { status: 500 })

    const d = json.data || {}
    const result = {
      ticker,
      name:               d.name,
      sector:             d.sector,
      industry:           d.industry,
      // Analyst consensus
      recommendation:     d.recommendationKey,   // strong_buy, buy, hold, sell, strong_sell
      targetPrice:        d.targetPrice,
      numberOfAnalysts:   d.numberOfAnalysts,
      // Valuation
      trailingPE:         d.trailingPE,
      forwardPE:          d.forwardPE,
      priceToBook:        d.priceToBook,
      dividendYield:      d.dividendYield,
      beta:               d.beta,
      // Growth
      revenueGrowth:      d.revenueGrowth,
      earningsGrowth:     d.earningsGrowth,
      // Profitability
      grossMargins:       d.grossMargins,
      operatingMargins:   d.operatingMargins,
      profitMargins:      d.profitMargins,
      returnOnEquity:     d.returnOnEquity,
      returnOnAssets:     d.returnOnAssets,
      // Balance sheet
      totalDebt:          d.totalDebt,
      debtToEquity:       d.debtToEquity,
      freeCashflow:       d.freeCashflow,
      // 52-week
      fiftyTwoWeekHigh:   d.fiftyTwoWeekHigh,
      fiftyTwoWeekLow:    d.fiftyTwoWeekLow,
      // Upcoming events
      calendarEvents:     d.calendarEvents,
      // Analyst trend
      recommendationTrend: d.recommendationTrend?.slice(0, 4) || [],
    }

    cache.set(ticker, { data: result, ts: Date.now() })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
