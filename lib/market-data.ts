/**
 * Market Data — Single source of truth
 */

// Shared interfaces
export interface HistoricalData {
  date: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
  adjClose: number
}

export interface StockData {
  ticker: string
  name: string
  price: number
  change: number
  changePercent: number
  volume: number
  marketCap: number
  peRatio: number
  dividendYield: number
  dayHigh: number
  dayLow: number
  open: number
  previousClose: number
  week52High: number
  week52Low: number
  currency: string
  exchange: string
}

/**
 * Market Data — Single source of truth (continued)
 * 
 * Finnhub (primary):
 *   - Live quotes (price, OHLC, volume)
 *   - Fundamentals (PE, market cap, 52w range, dividend yield)  
 *   - Company profile (name, exchange, currency)
 *   - News & sentiment
 *   - Search
 * 
 * Yahoo Finance (historical OHLCV only):
 *   - Daily candles for technical analysis (RSI, MACD, Bollinger etc.)
 *   - Intraday data for 1D chart
 *   - Note: Finnhub free tier does not provide historical candles
 */

const FINNHUB_BASE = 'https://finnhub.io/api/v1'
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || ''

// Cache
const quoteCache = new Map<string, { data: any; ts: number }>()
const historyCache = new Map<string, { data: any[]; ts: number }>()
const QUOTE_TTL = 60 * 1000       // 1 min
const HISTORY_TTL = 60 * 60 * 1000 // 1 hour

function finnhubSymbol(ticker: string) {
  return ticker.endsWith('.SI') ? ticker.replace('.SI', ':SP') : ticker
}

// ─── Live Quote + Fundamentals (Finnhub) ─────────────────────────────────────

export async function getLiveQuote(ticker: string) {
  const cached = quoteCache.get(ticker)
  if (cached && Date.now() - cached.ts < QUOTE_TTL) return cached.data

  const sym = finnhubSymbol(ticker)
  const [quoteRes, profileRes, metricsRes] = await Promise.all([
    fetch(`${FINNHUB_BASE}/quote?symbol=${sym}&token=${FINNHUB_KEY}`),
    fetch(`${FINNHUB_BASE}/stock/profile2?symbol=${sym}&token=${FINNHUB_KEY}`),
    fetch(`${FINNHUB_BASE}/stock/metric?symbol=${sym}&metric=all&token=${FINNHUB_KEY}`),
  ])

  const [q, p, m] = await Promise.all([
    quoteRes.json(), profileRes.json(),
    metricsRes.ok ? metricsRes.json() : { metric: {} }
  ])

  if (!q.c) return null
  const metrics = m?.metric || {}

  const data = {
    ticker,
    name: p.name || ticker,
    price: q.c,
    change: q.c - q.pc,
    changePercent: q.pc > 0 ? ((q.c - q.pc) / q.pc) * 100 : 0,
    volume: q.v ?? 0,
    marketCap: (p.marketCapitalization || 0) * 1e6,
    peRatio: metrics.peBasicExclExtraTTM || metrics.peNormalizedAnnual || 0,
    dividendYield: metrics.dividendYieldIndicatedAnnual || 0,
    dayHigh: q.h, dayLow: q.l,
    open: q.o, previousClose: q.pc,
    week52High: metrics['52WeekHigh'] || 0,
    week52Low: metrics['52WeekLow'] || 0,
    currency: p.currency || (ticker.endsWith('.SI') ? 'SGD' : 'USD'),
    exchange: p.exchange || '',
    logo: p.logo || '',
    weburl: p.weburl || '',
  }

  quoteCache.set(ticker, { data, ts: Date.now() })
  return data
}

// ─── News (Finnhub) ───────────────────────────────────────────────────────────

export async function getNews(ticker: string): Promise<{ headline: string; sentiment: string; source: string; datetime: number }[]> {
  const sym = finnhubSymbol(ticker)
  const to = new Date().toISOString().split('T')[0]
  const from = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]

  try {
    const res = await fetch(`${FINNHUB_BASE}/company-news?symbol=${sym}&from=${from}&to=${to}&token=${FINNHUB_KEY}`)
    if (!res.ok) return []
    const news = await res.json()

    return (news || []).slice(0, 10).map((n: any) => {
      const text = (n.headline + ' ' + (n.summary || '')).toLowerCase()
      const pos = ['upgrade','beat','strong','growth','surge','rally','profit','record','buy','bullish'].filter(w => text.includes(w)).length
      const neg = ['downgrade','miss','weak','decline','fall','loss','cut','sell','bearish','warn'].filter(w => text.includes(w)).length
      return {
        headline: n.headline,
        source: n.source,
        datetime: n.datetime,
        sentiment: pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral'
      }
    })
  } catch { return [] }
}

// ─── Search (Finnhub) ─────────────────────────────────────────────────────────

export async function searchTickers(query: string): Promise<{ symbol: string; description: string; type: string }[]> {
  try {
    const res = await fetch(`${FINNHUB_BASE}/search?q=${encodeURIComponent(query)}&token=${FINNHUB_KEY}`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.result || [])
      .filter((r: any) => r.type === 'Common Stock' || r.type === 'ETP') // equities + ETFs only
      .slice(0, 10)
      .map((r: any) => ({ symbol: r.symbol, description: r.description, type: r.type }))
  } catch { return [] }
}

// ─── Historical OHLCV (Yahoo — Finnhub free tier doesn't provide this) ────────

export async function getHistoricalOHLCV(ticker: string, period: string): Promise<any[]> {
  const cached = historyCache.get(`${ticker}:${period}`)
  if (cached && Date.now() - cached.ts < HISTORY_TTL) return cached.data

  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${period}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    })
    if (!res.ok) throw new Error(`Yahoo ${res.status}`)
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) throw new Error('No data')

    const ts = result.timestamp || []
    const q = result.indicators.quote[0] || {}
    const adj = result.indicators.adjclose?.[0]?.adjclose || []

    const data = ts.map((t: number, i: number) => ({
      date: new Date(t * 1000),
      open: q.open?.[i] || 0,
      high: q.high?.[i] || 0,
      low: q.low?.[i] || 0,
      close: q.close?.[i] || 0,
      volume: q.volume?.[i] || 0,
      adjClose: adj[i] || q.close?.[i] || 0,
    })).filter((d: any) => d.close > 0)

    historyCache.set(`${ticker}:${period}`, { data, ts: Date.now() })
    return data
  } catch (e) {
    console.error(`History fetch failed for ${ticker}:`, e)
    return []
  }
}

// ─── Intraday (Yahoo — 1D chart) ──────────────────────────────────────────────

export async function getIntradayOHLCV(ticker: string): Promise<any[]> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&range=1d`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    })
    if (!res.ok) return []
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return []

    const ts = result.timestamp || []
    const q = result.indicators.quote[0] || {}

    return ts.map((t: number, i: number) => ({
      date: new Date(t * 1000),
      open: q.open?.[i] || 0, high: q.high?.[i] || 0,
      low: q.low?.[i] || 0, close: q.close?.[i] || 0,
      volume: q.volume?.[i] || 0, adjClose: q.close?.[i] || 0,
    })).filter((d: any) => d.close > 0)
  } catch { return [] }
}
