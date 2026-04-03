import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getHistoricalData } from '@/lib/yahoo'
import { calculateAllIndicators } from '@/lib/indicators'
import { detectPatterns } from '@/lib/patterns'

export const dynamic = 'force-dynamic'

const PORTFOLIO_PATH = join(process.cwd(), 'data', 'portfolio.json')

function readPortfolio() {
  return JSON.parse(readFileSync(PORTFOLIO_PATH, 'utf-8'))
}

function writePortfolio(data: any) {
  writeFileSync(PORTFOLIO_PATH, JSON.stringify(data, null, 2))
}

function today() {
  return new Date().toISOString().split('T')[0]
}

async function analyzeStock(ticker: string) {
  try {
    // Try Finnhub candles first
    const apiKey = process.env.FINNHUB_API_KEY
    let prices: number[] = [], highs: number[] = [], lows: number[] = [], currentPrice = 0

    if (apiKey) {
      const to = Math.floor(Date.now() / 1000)
      const from = to - 90 * 24 * 60 * 60
      const url = `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${to}&token=${apiKey}`
      const res = await fetch(url)
      const data = await res.json()
      if (data.s === 'ok' && data.c?.length > 0) {
        prices = data.c
        highs = data.h
        lows = data.l
        currentPrice = data.c[data.c.length - 1]
      }
    }

    // Fallback to Yahoo
    if (prices.length === 0) {
      const history = await getHistoricalData(ticker, '3mo')
      prices = history.map(h => h.close)
      highs = history.map(h => h.high)
      lows = history.map(h => h.low)
      currentPrice = prices[prices.length - 1]
    }

    const indicators = calculateAllIndicators(prices, highs, lows)
    const patterns = detectPatterns(prices, { open: prices, high: highs, low: lows, close: prices })

    const rsi = indicators.rsi?.[indicators.rsi.length - 1] ?? 50
    const macd = indicators.macd?.[indicators.macd.length - 1] ?? 0
    const macdSignal = indicators.macdSignal?.[indicators.macdSignal.length - 1] ?? 0
    const sma20 = indicators.sma20?.[indicators.sma20.length - 1] ?? 0
    const sma50 = indicators.sma50?.[indicators.sma50.length - 1] ?? 0
    const bb = indicators.bollingerBands?.[indicators.bollingerBands.length - 1]

    // Score signals
    let bull = 0, bear = 0
    if (currentPrice > sma20) bull++; else bear++
    if (currentPrice > sma50) bull++; else bear++
    if (macd > macdSignal) bull++; else bear++
    if (rsi < 30) bull += 2  // oversold = buy opportunity
    if (rsi > 70) bear += 2  // overbought = sell signal
    if (rsi > 50 && rsi <= 70) bull++
    if (rsi < 50 && rsi >= 30) bear++
    patterns.forEach(p => { if (p.type === 'bullish') bull++; if (p.type === 'bearish') bear++ })

    let signal: 'BUY' | 'SELL' | 'HOLD'
    let reason: string

    if (bull >= bear + 3) {
      signal = 'BUY'
      reason = `Strong bullish: RSI ${rsi.toFixed(0)}, MACD ${macd > macdSignal ? 'bullish' : 'bearish'}, price ${currentPrice > sma20 ? 'above' : 'below'} SMA20. ${bull} bull vs ${bear} bear signals.`
    } else if (bear >= bull + 3) {
      signal = 'SELL'
      reason = `Strong bearish: RSI ${rsi.toFixed(0)}, MACD ${macd > macdSignal ? 'bullish' : 'bearish'}, price ${currentPrice > sma20 ? 'above' : 'below'} SMA20. ${bear} bear vs ${bull} bull signals.`
    } else {
      signal = 'HOLD'
      reason = `Mixed signals: RSI ${rsi.toFixed(0)}, ${bull} bull vs ${bear} bear signals. Await clearer direction.`
    }

    // Stop loss / take profit checks
    const stopLoss = currentPrice * 0.88
    const takeProfit = currentPrice * 1.12

    return { ticker, currentPrice, signal, reason, rsi, macd, macdSignal, sma20, sma50, bull, bear, stopLoss, takeProfit }
  } catch (e) {
    return null
  }
}

export async function POST() {
  try {
    const portfolio = readPortfolio()
    const actions: any[] = []
    const updatedPositions = [...portfolio.positions]
    let cash = portfolio.cash

    // Analyze each current position
    for (const pos of portfolio.positions) {
      const analysis = await analyzeStock(pos.ticker)
      if (!analysis) continue

      const { currentPrice, signal, reason, stopLoss } = analysis

      // Update current price in portfolio
      const posIdx = updatedPositions.findIndex(p => p.ticker === pos.ticker)
      if (posIdx >= 0) updatedPositions[posIdx].currentPrice = currentPrice

      // Check stop loss hit
      const stopLossPrice = pos.buyPrice * 0.88
      if (currentPrice <= stopLossPrice) {
        actions.push({
          type: 'SELL',
          ticker: pos.ticker,
          reason: `⛔ Stop loss triggered at $${currentPrice.toFixed(2)} (buy: $${pos.buyPrice.toFixed(2)}, -12%)`,
          currentPrice,
          shares: pos.shares,
          urgent: true
        })
        continue
      }

      // Check take profit hit (12% gain)
      const takeProfitPrice = pos.buyPrice * 1.12
      if (currentPrice >= takeProfitPrice) {
        actions.push({
          type: 'SELL',
          ticker: pos.ticker,
          reason: `🎯 Take profit hit at $${currentPrice.toFixed(2)} (buy: $${pos.buyPrice.toFixed(2)}, +${(((currentPrice - pos.buyPrice) / pos.buyPrice) * 100).toFixed(1)}%)`,
          currentPrice,
          shares: pos.shares,
          urgent: true
        })
        continue
      }

      // Signal-based suggestion
      if (signal === 'SELL') {
        actions.push({
          type: 'SELL',
          ticker: pos.ticker,
          reason: `📉 ${reason}`,
          currentPrice,
          shares: pos.shares,
          urgent: false
        })
      } else if (signal === 'HOLD') {
        actions.push({
          type: 'HOLD',
          ticker: pos.ticker,
          reason: `⏸️ ${reason}`,
          currentPrice,
          shares: pos.shares,
          urgent: false
        })
      }
    }

    // If cash available (>$5000), look for BUY opportunities in watchlist
    const watchlist = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'NFLX', 'JPM']
    const heldTickers = portfolio.positions.map((p: any) => p.ticker)
    const cooldownTickers = Object.keys(portfolio.cooldowns || {})

    if (cash >= 5000) {
      for (const ticker of watchlist) {
        if (heldTickers.includes(ticker) || cooldownTickers.includes(ticker)) continue
        const analysis = await analyzeStock(ticker)
        if (!analysis) continue

        if (analysis.signal === 'BUY') {
          const positionSize = Math.min(cash * 0.25, 20000) // Max 25% of cash or $20k
          const shares = Math.floor(positionSize / analysis.currentPrice)
          if (shares > 0) {
            actions.push({
              type: 'BUY',
              ticker,
              reason: `📈 ${analysis.reason}`,
              currentPrice: analysis.currentPrice,
              shares,
              cost: shares * analysis.currentPrice,
              urgent: false
            })
          }
          if (actions.filter(a => a.type === 'BUY').length >= 2) break // Max 2 new buys per run
        }
      }
    }

    // Update portfolio value history
    const totalPositionsValue = updatedPositions.reduce((sum: number, p: any) => sum + p.currentPrice * p.shares, 0)
    const totalValue = cash + totalPositionsValue
    const todayStr = today()
    const lastValueEntry = portfolio.valueHistory?.[portfolio.valueHistory.length - 1]
    if (!lastValueEntry || lastValueEntry.date !== todayStr) {
      portfolio.valueHistory = [...(portfolio.valueHistory || []), { date: todayStr, value: totalValue }]
    }

    portfolio.positions = updatedPositions
    writePortfolio(portfolio)

    return NextResponse.json({
      success: true,
      actions,
      summary: {
        totalValue,
        cash,
        positionsValue: totalPositionsValue,
        positionsChecked: portfolio.positions.length,
        actionsFound: actions.length
      }
    })
  } catch (error) {
    console.error('Monitor error:', error)
    return NextResponse.json({ error: 'Monitor failed' }, { status: 500 })
  }
}

// Execute a specific action (buy/sell)
export async function PUT(request: Request) {
  try {
    const { action } = await request.json()
    const portfolio = readPortfolio()
    const todayStr = today()

    if (action.type === 'SELL') {
      const posIdx = portfolio.positions.findIndex((p: any) => p.ticker === action.ticker)
      if (posIdx < 0) return NextResponse.json({ error: 'Position not found' }, { status: 404 })

      const pos = portfolio.positions[posIdx]
      const proceeds = action.currentPrice * pos.shares
      const pnl = (action.currentPrice - pos.buyPrice) * pos.shares
      const pnlPct = ((action.currentPrice - pos.buyPrice) / pos.buyPrice) * 100

      // Add to trade history
      portfolio.history.push({
        date: todayStr,
        action: 'SELL',
        ticker: pos.ticker,
        shares: pos.shares,
        price: action.currentPrice,
        total: proceeds,
        reason: action.reason,
        buyDate: pos.buyDate,
        buyPrice: pos.buyPrice,
        buyTotal: pos.buyPrice * pos.shares,
        pnl,
        pnlPct
      })

      // Add to closed positions
      portfolio.closedPositions = portfolio.closedPositions || []
      portfolio.closedPositions.push({
        ticker: pos.ticker,
        shares: pos.shares,
        buyDate: pos.buyDate,
        buyPrice: pos.buyPrice,
        sellDate: todayStr,
        sellPrice: action.currentPrice,
        reason: action.reason,
        pnl,
        pnlPct
      })

      // Update cash & remove position
      portfolio.cash += proceeds
      portfolio.positions.splice(posIdx, 1)

      // Add cooldown (3 days)
      const cooldownDate = new Date()
      cooldownDate.setDate(cooldownDate.getDate() + 3)
      portfolio.cooldowns = portfolio.cooldowns || {}
      portfolio.cooldowns[pos.ticker] = cooldownDate.toISOString().split('T')[0]

    } else if (action.type === 'BUY') {
      const cost = action.currentPrice * action.shares
      if (portfolio.cash < cost) return NextResponse.json({ error: 'Insufficient cash' }, { status: 400 })

      portfolio.cash -= cost
      portfolio.positions.push({
        ticker: action.ticker,
        shares: action.shares,
        avgCost: action.currentPrice,
        buyDate: todayStr,
        buyPrice: action.currentPrice,
        currentPrice: action.currentPrice,
        signal: 'BUY',
        reason: action.reason
      })

      portfolio.history.push({
        date: todayStr,
        action: 'BUY',
        ticker: action.ticker,
        shares: action.shares,
        price: action.currentPrice,
        total: cost,
        reason: action.reason
      })

      // Remove from cooldown if present
      if (portfolio.cooldowns?.[action.ticker]) {
        delete portfolio.cooldowns[action.ticker]
      }
    }

    // Update value history
    const totalPositionsValue = portfolio.positions.reduce((sum: number, p: any) => sum + p.currentPrice * p.shares, 0)
    const totalValue = portfolio.cash + totalPositionsValue
    const lastEntry = portfolio.valueHistory?.[portfolio.valueHistory.length - 1]
    if (!lastEntry || lastEntry.date !== todayStr) {
      portfolio.valueHistory = [...(portfolio.valueHistory || []), { date: todayStr, value: totalValue }]
    } else {
      portfolio.valueHistory[portfolio.valueHistory.length - 1].value = totalValue
    }

    writePortfolio(portfolio)
    return NextResponse.json({ success: true, cash: portfolio.cash, positions: portfolio.positions.length })
  } catch (error) {
    console.error('Execute action error:', error)
    return NextResponse.json({ error: 'Failed to execute action' }, { status: 500 })
  }
}
