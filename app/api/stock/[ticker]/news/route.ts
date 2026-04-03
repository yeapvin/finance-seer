import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface NewsItem {
  headline: string
  source: string
  datetime: number
  summary: string
  url: string
  sentiment?: 'positive' | 'negative' | 'neutral'
}

function scoreSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const positive = ['upgrade', 'beat', 'strong', 'growth', 'surge', 'rally', 'profit', 'record', 'outperform', 'buy', 'bullish', 'gain', 'rise', 'high', 'top', 'exceed', 'win', 'boost', 'expand', 'positive']
  const negative = ['downgrade', 'miss', 'weak', 'decline', 'fall', 'loss', 'cut', 'underperform', 'sell', 'bearish', 'drop', 'low', 'concern', 'risk', 'warn', 'disappoint', 'trouble', 'hurt', 'negative', 'crash']
  const lower = text.toLowerCase()
  const posScore = positive.filter(w => lower.includes(w)).length
  const negScore = negative.filter(w => lower.includes(w)).length
  if (posScore > negScore) return 'positive'
  if (negScore > posScore) return 'negative'
  return 'neutral'
}

export async function GET(
  request: NextRequest,
  { params }: { params: { ticker: string } },
) {
  try {
    const ticker = (params.ticker as string).toUpperCase()
    const apiKey = process.env.FINNHUB_API_KEY

    if (!apiKey) {
      return NextResponse.json({ ticker, news: [], sentiment: 'neutral', sentimentScore: 0 })
    }

    // Fetch last 7 days of company news from Finnhub
    const to = new Date().toISOString().split('T')[0]
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const url = `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${apiKey}`

    const res = await fetch(url)
    if (!res.ok) throw new Error(`Finnhub news error: ${res.status}`)

    const rawNews = await res.json()
    const news: NewsItem[] = (rawNews || []).slice(0, 15).map((item: any) => ({
      headline: item.headline,
      source: item.source,
      datetime: item.datetime,
      summary: item.summary?.substring(0, 200) || '',
      url: item.url,
      sentiment: scoreSentiment(item.headline + ' ' + (item.summary || ''))
    }))

    // Overall sentiment score (-1 to +1)
    const posCount = news.filter(n => n.sentiment === 'positive').length
    const negCount = news.filter(n => n.sentiment === 'negative').length
    const total = news.length || 1
    const sentimentScore = (posCount - negCount) / total
    const overallSentiment = sentimentScore > 0.2 ? 'positive' : sentimentScore < -0.2 ? 'negative' : 'neutral'

    return NextResponse.json({
      ticker,
      news,
      sentiment: overallSentiment,
      sentimentScore: parseFloat(sentimentScore.toFixed(2)),
      posCount,
      negCount,
      neutralCount: total - posCount - negCount
    })
  } catch (error) {
    console.error(`Error fetching news for ${params.ticker}:`, error)
    return NextResponse.json({ ticker: params.ticker, news: [], sentiment: 'neutral', sentimentScore: 0 })
  }
}
