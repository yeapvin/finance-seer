/**
 * Finnhub Price Provider
 * Real-time stock quotes with no rate limits (60 req/min free tier)
 * Perfect for portfolio monitoring and heartbeat checks
 */

const FINNHUB_API_KEY = 'cq35tlpr01qkgf3jbhkgcq35tlpr01qkgf3jbhl0'
const FINNHUB_BASE = 'https://finnhub.io/api/v1'

interface FinnhubQuote {
  c: number // current price
  h: number // high
  l: number // low
  o: number // open
  pc: number // previous close
  t: number // timestamp
}

interface FinnhubCompanyProfile {
  country: string
  currency: string
  cusip: string
  description: string
  exchange: string
  finnhubIndustry: string
  ipo: string
  logo: string
  marketCapitalization: number
  name: string
  phone: string
  shareOutstanding: number
  ticker: string
  weburl: string
}

interface PriceData {
  ticker: string
  price: number
  high: number
  low: number
  timestamp: number
}

interface FullStockData {
  ticker: string
  name: string
  price: number
  change: number
  changePercent: number
  volume?: number
  marketCap: number
  currency: string
  exchange: string
  dayHigh: number
  dayLow: number
  open: number
  previousClose: number
}

const priceCache = new Map<string, { data: PriceData; timestamp: number }>()
const companyCache = new Map<string, { data: FinnhubCompanyProfile; timestamp: number }>()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour
const COMPANY_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Fetch single stock price from Finnhub
 * Uses cache aggressively to stay well under rate limits
 */
export async function getFinnhubPrice(ticker: string): Promise<number | null> {
  const tickerUpper = ticker.toUpperCase()

  // Check cache first (1 hour)
  const cached = priceCache.get(tickerUpper)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data.price
  }

  try {
    const url = `${FINNHUB_BASE}/quote?symbol=${tickerUpper}&token=${FINNHUB_API_KEY}`
    const response = await fetch(url)

    if (!response.ok) {
      console.error(`Finnhub error for ${tickerUpper}: ${response.status}`)
      return cached?.data.price || null
    }

    const quote: FinnhubQuote = await response.json()

    if (!quote.c) {
      console.warn(`No price data for ${tickerUpper}`)
      return cached?.data.price || null
    }

    const data: PriceData = {
      ticker: tickerUpper,
      price: quote.c,
      high: quote.h,
      low: quote.l,
      timestamp: Date.now(),
    }

    priceCache.set(tickerUpper, { data, timestamp: Date.now() })
    return quote.c
  } catch (error) {
    console.error(`Finnhub fetch failed for ${tickerUpper}:`, error)
    return cached?.data.price || null
  }
}

/**
 * Batch fetch multiple prices from Finnhub
 * Single API call per ticker (Finnhub doesn't batch, but we cache aggressively)
 */
export async function getFinnhubPrices(tickers: string[]): Promise<Record<string, number>> {
  const results: Record<string, number> = {}
  const tickersToFetch: string[] = []

  // Filter out cached values
  for (const ticker of tickers) {
    const tickerUpper = ticker.toUpperCase()
    const cached = priceCache.get(tickerUpper)

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      results[tickerUpper] = cached.data.price
    } else {
      tickersToFetch.push(tickerUpper)
    }
  }

  // Fetch missing prices
  for (const ticker of tickersToFetch) {
    const price = await getFinnhubPrice(ticker)
    if (price) {
      results[ticker] = price
    }
  }

  return results
}

/**
 * Get company profile from Finnhub
 */
export async function getFinnhubCompanyProfile(ticker: string): Promise<FinnhubCompanyProfile | null> {
  const tickerUpper = ticker.toUpperCase()

  // Check cache first (24 hours)
  const cached = companyCache.get(tickerUpper)
  if (cached && Date.now() - cached.timestamp < COMPANY_CACHE_TTL) {
    return cached.data
  }

  try {
    const url = `${FINNHUB_BASE}/stock/profile2?symbol=${tickerUpper}&token=${FINNHUB_API_KEY}`
    const response = await fetch(url)

    if (!response.ok) {
      console.debug(`Finnhub profile not found for ${tickerUpper}: ${response.status}`)
      return cached?.data || null
    }

    const profile: FinnhubCompanyProfile = await response.json()

    if (!profile.name) {
      return cached?.data || null
    }

    companyCache.set(tickerUpper, { data: profile, timestamp: Date.now() })
    return profile
  } catch (error) {
    console.error(`Finnhub profile fetch failed for ${tickerUpper}:`, error)
    return cached?.data || null
  }
}

/**
 * Get full stock data from Finnhub (price + company profile)
 * True Finnhub-primary approach
 */
export async function getFinnhubStockData(ticker: string): Promise<FullStockData | null> {
  const tickerUpper = ticker.toUpperCase()

  try {
    // Fetch price and company profile in parallel
    const [price, profile] = await Promise.all([
      getFinnhubPrice(tickerUpper),
      getFinnhubCompanyProfile(tickerUpper),
    ])

    if (!price) {
      console.warn(`No price for ${tickerUpper}`)
      return null
    }

    if (!profile) {
      console.warn(`No profile for ${tickerUpper}`)
      return null
    }

    // Fetch quote again to get OHLC (it's cached, so no extra API calls)
    const url = `${FINNHUB_BASE}/quote?symbol=${tickerUpper}&token=${FINNHUB_API_KEY}`
    const response = await fetch(url)
    const quote: FinnhubQuote = await response.json()

    return {
      ticker: tickerUpper,
      name: profile.name,
      price,
      change: price - quote.pc,
      changePercent: quote.pc > 0 ? ((price - quote.pc) / quote.pc) * 100 : 0,
      volume: undefined, // Finnhub quote doesn't include volume in free tier
      marketCap: profile.marketCapitalization || 0,
      currency: profile.currency || 'USD',
      exchange: profile.exchange || 'UNKNOWN',
      dayHigh: quote.h,
      dayLow: quote.l,
      open: quote.o,
      previousClose: quote.pc,
    }
  } catch (error) {
    console.error(`Finnhub stock data failed for ${tickerUpper}:`, error)
    return null
  }
}

/**
 * Get detailed quote with intraday data
 */
export async function getFinnhubQuote(ticker: string): Promise<PriceData | null> {
  const tickerUpper = ticker.toUpperCase()

  const cached = priceCache.get(tickerUpper)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  try {
    const url = `${FINNHUB_BASE}/quote?symbol=${tickerUpper}&token=${FINNHUB_API_KEY}`
    const response = await fetch(url)

    if (!response.ok) {
      return cached?.data || null
    }

    const quote: FinnhubQuote = await response.json()

    if (!quote.c) {
      return cached?.data || null
    }

    const data: PriceData = {
      ticker: tickerUpper,
      price: quote.c,
      high: quote.h,
      low: quote.l,
      timestamp: quote.t * 1000,
    }

    priceCache.set(tickerUpper, { data, timestamp: Date.now() })
    return data
  } catch (error) {
    console.error(`Finnhub quote failed for ${tickerUpper}:`, error)
    return cached?.data || null
  }
}

/**
 * Clear cache (for testing)
 */
export function clearFinnhubCache(): void {
  priceCache.clear()
  companyCache.clear()
}

/**
 * Get cache stats
 */
export function getFinnhubCacheStats(): { cachedTickers: number; cachedCompanies: number; oldestEntry: number } {
  let oldestEntry = Infinity
  priceCache.forEach(entry => {
    if (entry.timestamp < oldestEntry) {
      oldestEntry = entry.timestamp
    }
  })
  companyCache.forEach(entry => {
    if (entry.timestamp < oldestEntry) {
      oldestEntry = entry.timestamp
    }
  })
  return {
    cachedTickers: priceCache.size,
    cachedCompanies: companyCache.size,
    oldestEntry: oldestEntry === Infinity ? 0 : Date.now() - oldestEntry,
  }
}
