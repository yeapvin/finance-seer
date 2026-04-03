/**
 * Portfolio Price Checker
 * Uses Finnhub as primary (60 req/min free, no rate limits)
 * Falls back to cached Yahoo prices
 */

import { getFinnhubPrices } from './finnhub'

interface PortfolioPosition {
  ticker: string
  shares: number
  avgCost: number
  stopLoss: number
  takeProfit: number
}

interface PriceCheckResult {
  ticker: string
  currentPrice: number
  stopLoss: number
  takeProfit: number
  pnl: number
  pnlPct: number
  status: 'HOLD' | 'EXIT_SL' | 'EXIT_TP'
}

/**
 * Check all open positions against current prices
 * Uses Finnhub for real-time, no rate-limit issues
 */
export async function checkPortfolioExits(
  portfolio: any,
): Promise<{ results: PriceCheckResult[]; triggered: PriceCheckResult[] }> {
  const positions: PortfolioPosition[] = portfolio.positions || []

  if (positions.length === 0) {
    return { results: [], triggered: [] }
  }

  // Fetch all prices from Finnhub (primary) with cache
  const tickers = positions.map(p => p.ticker)
  const prices = await getFinnhubPrices(tickers)

  const results: PriceCheckResult[] = []
  const triggered: PriceCheckResult[] = []

  positions.forEach(pos => {
    const currentPrice = prices[pos.ticker.toUpperCase()]

    if (!currentPrice) {
      console.warn(`Could not get price for ${pos.ticker}`)
      return
    }

    const pnl = (currentPrice - pos.avgCost) * pos.shares
    const pnlPct = ((currentPrice - pos.avgCost) / pos.avgCost) * 100

    let status: 'HOLD' | 'EXIT_SL' | 'EXIT_TP' = 'HOLD'

    if (currentPrice <= pos.stopLoss) {
      status = 'EXIT_SL'
      triggered.push({
        ticker: pos.ticker,
        currentPrice,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
        pnl,
        pnlPct,
        status,
      })
    } else if (currentPrice >= pos.takeProfit) {
      status = 'EXIT_TP'
      triggered.push({
        ticker: pos.ticker,
        currentPrice,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
        pnl,
        pnlPct,
        status,
      })
    }

    results.push({
      ticker: pos.ticker,
      currentPrice,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      pnl,
      pnlPct,
      status,
    })
  })

  return { results, triggered }
}

/**
 * Calculate portfolio value from Finnhub prices
 */
export async function calculatePortfolioValue(portfolio: any): Promise<number> {
  const positions: PortfolioPosition[] = portfolio.positions || []

  if (positions.length === 0) {
    return portfolio.cash || 0
  }

  const tickers = positions.map(p => p.ticker)
  const prices = await getFinnhubPrices(tickers)

  let positionValue = 0
  positions.forEach(pos => {
    const currentPrice = prices[pos.ticker.toUpperCase()]
    if (currentPrice) {
      positionValue += currentPrice * pos.shares
    }
  })

  return positionValue + (portfolio.cash || 0)
}

/**
 * Get position details with current prices
 */
export async function getPositionDetails(
  portfolio: any,
): Promise<
  Array<{
    ticker: string
    shares: number
    avgCost: number
    currentPrice: number
    pnl: number
    pnlPct: number
    stopLoss: number
    takeProfit: number
  }>
> {
  const positions: PortfolioPosition[] = portfolio.positions || []

  if (positions.length === 0) {
    return []
  }

  const tickers = positions.map(p => p.ticker)
  const prices = await getFinnhubPrices(tickers)

  return positions
    .map(pos => {
      const currentPrice = prices[pos.ticker.toUpperCase()]
      if (!currentPrice) return null

      return {
        ticker: pos.ticker,
        shares: pos.shares,
        avgCost: pos.avgCost,
        currentPrice,
        pnl: (currentPrice - pos.avgCost) * pos.shares,
        pnlPct: ((currentPrice - pos.avgCost) / pos.avgCost) * 100,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
      }
    })
    .filter((p): p is Exclude<typeof p, null> => p !== null)
}

