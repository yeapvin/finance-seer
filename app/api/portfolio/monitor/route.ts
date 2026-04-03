import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
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

function isSGX(ticker: string) {
  return ticker.endsWith('.SI')
}

function getCurrency(ticker: string) {
  return isSGX(ticker) ? 'SGD' : 'USD'
}

function fmtCurrency(amount: number, currency: string) {
  return `${currency} $${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Send Telegram alert via OpenClaw
async function sendTelegramAlert(message: string) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID
    if (!token || !chatId) return

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      })
    })
  } catch (e) {
    console.error('Telegram alert failed:', e)
  }
}

// Fetch live FX rate SGD/USD
async function fetchFXRate(): Promise<number> {
  try {
    const apiKey = process.env.FINNHUB_API_KEY
    if (!apiKey) return 0.7498
    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=OANDA:SGD_USD&token=${apiKey}`)
    const data = await res.json()
    return data.c || 0.7498
  } catch {
    return 0.7498
  }
}

// Fetch candle data from Finnhub
async function fetchCandles(ticker: string): Promise<{ prices: number[]; highs: number[]; lows: number[]; currentPrice: number } | null> {
  try {
    const apiKey = process.env.FINNHUB_API_KEY
    // For SGX tickers, Finnhub uses different symbol format
    const symbol = isSGX(ticker) ? ticker.replace('.SI', ':SP') : ticker
    const to = Math.floor(Date.now() / 1000)
    const from = to - 90 * 24 * 60 * 60
    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${apiKey}`
    const res = await fetch(url)
    const data = await res.json()
    if (data.s === 'ok' && data.c?.length > 0) {
      return {
        prices: data.c,
        highs: data.h,
        lows: data.l,
        currentPrice: data.c[data.c.length - 1]
      }
    }
    return null
  } catch {
    return null
  }
}

// Build learning context from past trades
function buildLearningContext(portfolio: any) {
  const closed = portfolio.closedPositions || []
  if (closed.length === 0) return { winRate: 50, avgWin: 0, avgLoss: 0, bestTickers: [], worstTickers: [] }

  const wins = closed.filter((p: any) => p.pnl > 0)
  const losses = closed.filter((p: any) => p.pnl <= 0)
  const winRate = (wins.length / closed.length) * 100
  const avgWin = wins.length > 0 ? wins.reduce((s: number, p: any) => s + p.pnlPct, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((s: number, p: any) => s + p.pnlPct, 0) / losses.length : 0
  const bestTickers = wins.map((p: any) => p.ticker)
  const worstTickers = losses.map((p: any) => p.ticker)
  return { winRate, avgWin, avgLoss, bestTickers, worstTickers }
}

async function analyzeStock(ticker: string, portfolio: any) {
  const candles = await fetchCandles(ticker)
  if (!candles) return null

  const { prices, highs, lows, currentPrice } = candles
  const indicators = calculateAllIndicators(prices, highs, lows)
  const patterns = detectPatterns(prices, { open: prices, high: highs, low: lows, close: prices })

  const rsi = indicators.rsi?.[indicators.rsi.length - 1] ?? 50
  const macd = indicators.macd?.[indicators.macd.length - 1] ?? 0
  const macdSignal = indicators.macdSignal?.[indicators.macdSignal.length - 1] ?? 0
  const sma20 = indicators.sma20?.[indicators.sma20.length - 1] ?? 0
  const sma50 = indicators.sma50?.[indicators.sma50.length - 1] ?? 0

  // Apply learnings from past trades
  const learning = buildLearningContext(portfolio)
  let bull = 0, bear = 0

  if (currentPrice > sma20) bull++; else bear++
  if (currentPrice > sma50) bull++; else bear++
  if (macd > macdSignal) bull++; else bear++
  if (rsi < 30) bull += 2
  if (rsi > 70) bear += 2
  if (rsi > 50 && rsi <= 70) bull++
  if (rsi < 50 && rsi >= 30) bear++
  patterns.forEach((p: any) => { if (p.type === 'bullish') bull++; if (p.type === 'bearish') bear++ })

  // Learning boost: if this ticker was previously profitable, slightly favour it
  if (learning.bestTickers.includes(ticker)) bull++
  if (learning.worstTickers.includes(ticker)) bear++

  // Require stronger conviction if win rate is low (be more conservative)
  const threshold = learning.winRate < 40 ? 4 : 3

  let signal: 'BUY' | 'SELL' | 'HOLD'
  let reason: string

  const bbStr = indicators.bollingerBands?.length
    ? (() => { const bb = indicators.bollingerBands![indicators.bollingerBands!.length - 1]; return bb ? ` BB $${bb.lower.toFixed(2)}-$${bb.upper.toFixed(2)}.` : '' })()
    : ''
  const smaStr = sma20 > 0 && sma50 > 0
    ? ` SMA20 $${sma20.toFixed(2)}, SMA50 $${sma50.toFixed(2)}.`
    : ''
  const patternStr = patterns.length > 0
    ? ` Pattern: ${patterns[0].name} (${patterns[0].confidence.toFixed(0)}%).`
    : ''
  const learnStr = learning.winRate > 0 ? ` Win rate: ${learning.winRate.toFixed(0)}%.` : ''

  if (bull >= bear + threshold) {
    signal = 'BUY'
    const strategyType = rsi < 35 ? 'Contrarian buy (oversold)' : macd > macdSignal && currentPrice > sma20 ? 'Momentum buy' : 'Technical buy'
    reason = `${strategyType} at $${currentPrice.toFixed(2)}. RSI ${rsi.toFixed(0)}${rsi < 35 ? ' (oversold)' : ''}.${smaStr}${bbStr}${patternStr} Resistance $${(currentPrice * 1.08).toFixed(2)}.${learnStr}`
  } else if (bear >= bull + threshold) {
    signal = 'SELL'
    const strategyType = rsi > 68 ? 'Take-profit (overbought)' : currentPrice < sma20 ? 'Stop-loss (below SMA20)' : 'Technical sell'
    reason = `${strategyType} at $${currentPrice.toFixed(2)}. RSI ${rsi.toFixed(0)}${rsi > 68 ? ' (overbought)' : ''}.${smaStr}${patternStr} Support $${(currentPrice * 0.93).toFixed(2)}.${learnStr}`
  } else {
    signal = 'HOLD'
    reason = `Hold at $${currentPrice.toFixed(2)}. RSI ${rsi.toFixed(0)}, mixed signals (${bull}B/${bear}R). Await clearer direction.`
  }

  return { ticker, currentPrice, signal, reason, rsi, bull, bear, currency: getCurrency(ticker) }
}

export async function POST() {
  try {
    const portfolio = readPortfolio()
    const actions: any[] = []
    const updatedPositions = [...portfolio.positions]
    const fxRate = await fetchFXRate()

    // Update FX rate
    portfolio.fxRates = { SGDUSD: fxRate, lastUpdated: new Date().toISOString() }

    // Analyze each current position
    for (const pos of portfolio.positions) {
      const analysis = await analyzeStock(pos.ticker, portfolio)
      if (!analysis) continue

      const { currentPrice, signal, reason } = analysis
      const posIdx = updatedPositions.findIndex((p: any) => p.ticker === pos.ticker)
      if (posIdx >= 0) updatedPositions[posIdx].currentPrice = currentPrice

      // Use position's specific SL/TP if set, otherwise fall back to -8%/+10%
      const stopLossPrice = pos.stopLoss || pos.buyPrice * 0.92
      const takeProfitPrice = pos.takeProfit || pos.buyPrice * 1.10
      const currency = getCurrency(pos.ticker)
      const slPct = (((stopLossPrice - pos.buyPrice) / pos.buyPrice) * 100).toFixed(1)
      const tpPct = (((takeProfitPrice - pos.buyPrice) / pos.buyPrice) * 100).toFixed(1)

      if (currentPrice <= stopLossPrice) {
        const lossPct = (((currentPrice - pos.buyPrice) / pos.buyPrice) * 100).toFixed(2)
        actions.push({ type: 'SELL', ticker: pos.ticker, reason: `Stop-loss triggered at ${fmtCurrency(currentPrice, currency)} (SL: ${fmtCurrency(stopLossPrice, currency)}, ${slPct}%). Loss: ${lossPct}%.`, currentPrice, shares: pos.shares, currency, urgent: true })
      } else if (currentPrice >= takeProfitPrice) {
        const gainPct = (((currentPrice - pos.buyPrice) / pos.buyPrice) * 100).toFixed(2)
        actions.push({ type: 'SELL', ticker: pos.ticker, reason: `Take-profit hit at ${fmtCurrency(currentPrice, currency)} (TP: ${fmtCurrency(takeProfitPrice, currency)}, +${tpPct}%). Profit: +${gainPct}%.`, currentPrice, shares: pos.shares, currency, urgent: true })
      } else if (signal === 'SELL') {
        actions.push({ type: 'SELL', ticker: pos.ticker, reason: `📉 ${reason}`, currentPrice, shares: pos.shares, currency, urgent: false })
      } else {
        actions.push({ type: signal, ticker: pos.ticker, reason: `${signal === 'BUY' ? '📈' : '⏸️'} ${reason}`, currentPrice, shares: pos.shares, currency, urgent: false })
      }
    }

    // Look for new BUY opportunities
    const usdWatchlist = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'NFLX', 'JPM']
    const sgdWatchlist = ['D05.SI', 'O39.SI', 'U11.SI', 'Z74.SI', 'C6L.SI'] // DBS, OCBC, UOB, Singtel, SIA
    const watchlist = [...usdWatchlist, ...sgdWatchlist]
    const heldTickers = portfolio.positions.map((p: any) => p.ticker)
    const cooldownTickers = Object.keys(portfolio.cooldowns || {})

    const cashUSD = portfolio.cashByValue?.USD || 0
    const cashSGD = portfolio.cashByValue?.SGD || 0

    // Total portfolio value for 20% position sizing rule
    const currentPosValueUSD = portfolio.positions
      .filter((p: any) => !isSGX(p.ticker))
      .reduce((s: number, p: any) => s + (p.currentPrice || p.buyPrice) * p.shares, 0)
    const currentPosValueSGD = portfolio.positions
      .filter((p: any) => isSGX(p.ticker))
      .reduce((s: number, p: any) => s + (p.currentPrice || p.buyPrice) * p.shares, 0)
    const totalPortfolioUSD = cashUSD + currentPosValueUSD + (cashSGD + currentPosValueSGD) * fxRate
    const maxPositionUSD = totalPortfolioUSD * 0.20 // 20% rule

    for (const ticker of watchlist) {
      if (heldTickers.includes(ticker) || cooldownTickers.includes(ticker)) continue
      const currency = getCurrency(ticker)
      const availableCash = currency === 'SGD' ? cashSGD : cashUSD
      if (availableCash < 2000) continue

      const analysis = await analyzeStock(ticker, portfolio)
      if (!analysis || analysis.signal !== 'BUY') continue

      // Enforce 20% max position size
      const maxInCurrency = currency === 'SGD' ? maxPositionUSD / fxRate : maxPositionUSD
      const positionSize = Math.min(availableCash, maxInCurrency)
      const shares = Math.floor(positionSize / analysis.currentPrice)
      if (shares > 0) {
        const cost = shares * analysis.currentPrice
        const costUSD = currency === 'SGD' ? cost * fxRate : cost
        const pctOfPortfolio = (costUSD / totalPortfolioUSD * 100).toFixed(1)
        // SL below support (~-5%), TP at resistance (~+8%) — tighter than 12% based on historical trades
        const stopLoss = parseFloat((analysis.currentPrice * 0.95).toFixed(2))
        const takeProfit = parseFloat((analysis.currentPrice * 1.08).toFixed(2))
        actions.push({
          type: 'BUY', ticker,
          reason: `${analysis.reason} | Position: ${pctOfPortfolio}% of portfolio (max 20%). SL $${stopLoss}, TP $${takeProfit}.`,
          currentPrice: analysis.currentPrice, shares, cost, currency, stopLoss, takeProfit, urgent: false
        })
      }
      if (actions.filter((a: any) => a.type === 'BUY').length >= 3) break
    }

    // Calculate current portfolio value (read-only, no writes)
    const posValueUSD = updatedPositions
      .filter((p: any) => !isSGX(p.ticker))
      .reduce((s: number, p: any) => s + p.currentPrice * p.shares, 0)
    const posValueSGD = updatedPositions
      .filter((p: any) => isSGX(p.ticker))
      .reduce((s: number, p: any) => s + p.currentPrice * p.shares, 0)
    const totalValueUSD = cashUSD + posValueUSD + (cashSGD + posValueSGD) * fxRate

    // NOTE: We do NOT write to portfolio.json during analysis — data stays intact

    return NextResponse.json({
      success: true,
      actions,
      fxRate,
      summary: { totalValueUSD, cashUSD, cashSGD, positionsChecked: portfolio.positions.length, actionsFound: actions.length }
    })
  } catch (error) {
    console.error('Monitor error:', error)
    return NextResponse.json({ error: 'Monitor failed' }, { status: 500 })
  }
}

// Execute a trade and send Telegram alert
export async function PUT(request: Request) {
  try {
    const { action } = await request.json()
    const portfolio = readPortfolio()
    const todayStr = today()
    const currency = action.currency || (isSGX(action.ticker) ? 'SGD' : 'USD')

    if (action.type === 'SELL') {
      const posIdx = portfolio.positions.findIndex((p: any) => p.ticker === action.ticker)
      if (posIdx < 0) return NextResponse.json({ error: 'Position not found' }, { status: 404 })

      const pos = portfolio.positions[posIdx]
      const proceeds = action.currentPrice * pos.shares
      const pnl = (action.currentPrice - pos.buyPrice) * pos.shares
      const pnlPct = ((action.currentPrice - pos.buyPrice) / pos.buyPrice) * 100

      const sellNote = `${action.reason.replace(/^[⛔🎯📉]/,'').trim()} Profit: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%).`

      portfolio.history = portfolio.history || []
      portfolio.history.push({ date: todayStr, action: 'SELL', ticker: pos.ticker, shares: pos.shares, price: action.currentPrice, total: proceeds, reason: sellNote, buyDate: pos.buyDate, buyPrice: pos.buyPrice, pnl, pnlPct, currency })

      portfolio.closedPositions = portfolio.closedPositions || []
      portfolio.closedPositions.push({ ticker: pos.ticker, shares: pos.shares, buyDate: pos.buyDate, buyPrice: pos.buyPrice, sellDate: todayStr, sellPrice: action.currentPrice, reason: sellNote, pnl, pnlPct, currency })

      // Add strategy note
      portfolio.strategyNotes = portfolio.strategyNotes || []
      portfolio.strategyNotes.push({ date: `${todayStr}T${new Date().toISOString().split('T')[1].substring(0,5)}Z`, note: `Sold ${pos.ticker} @ $${action.currentPrice.toFixed(2)} (${pos.shares} shares). ${sellNote} Cash now $${(portfolio.cashByValue?.[currency] || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}.` })

      // Update cash in correct currency
      portfolio.cashByValue = portfolio.cashByValue || { USD: 0, SGD: 0 }
      portfolio.cashByValue[currency] = (portfolio.cashByValue[currency] || 0) + proceeds
      portfolio.positions.splice(posIdx, 1)

      // Cooldown 3 days
      portfolio.cooldowns = portfolio.cooldowns || {}
      const cd = new Date(); cd.setDate(cd.getDate() + 3)
      portfolio.cooldowns[pos.ticker] = cd.toISOString().split('T')[0]

      // Telegram alert
      const pnlSign = pnl >= 0 ? '🟢' : '🔴'
      await sendTelegramAlert(
        `${pnlSign} *Finance Seer — SELL Executed*\n\n` +
        `*${pos.ticker}* — ${pos.shares} shares @ ${fmtCurrency(action.currentPrice, currency)}\n` +
        `P&L: ${pnl >= 0 ? '+' : ''}${fmtCurrency(pnl, currency)} (${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)\n` +
        `Proceeds: ${fmtCurrency(proceeds, currency)}\n\n` +
        `_Reason: ${action.reason.replace(/[*_`]/g, '')}_`
      )

    } else if (action.type === 'BUY') {
      const cost = action.currentPrice * action.shares
      portfolio.cashByValue = portfolio.cashByValue || { USD: 0, SGD: 0 }
      const available = portfolio.cashByValue[currency] || 0
      if (available < cost) return NextResponse.json({ error: 'Insufficient cash' }, { status: 400 })

      portfolio.cashByValue[currency] -= cost
      portfolio.positions = portfolio.positions || []
      // Set SL just below nearest support, TP at nearest resistance
      const sl = action.stopLoss || action.currentPrice * 0.92
      const tp = action.takeProfit || action.currentPrice * 1.10
      portfolio.positions.push({ ticker: action.ticker, shares: action.shares, avgCost: action.currentPrice, buyDate: todayStr, buyPrice: action.currentPrice, currentPrice: action.currentPrice, stopLoss: sl, takeProfit: tp, signal: 'BUY', reason: action.reason, currency })

      const buyNote = action.reason.replace(/^[📈]/,'').trim()

      portfolio.history = portfolio.history || []
      portfolio.history.push({ date: todayStr, action: 'BUY', ticker: action.ticker, shares: action.shares, price: action.currentPrice, total: cost, reason: buyNote, currency })

      // Add strategy note
      portfolio.strategyNotes = portfolio.strategyNotes || []
      portfolio.strategyNotes.push({ date: `${todayStr}T${new Date().toISOString().split('T')[1].substring(0,5)}Z`, note: `Bought ${action.shares} ${action.ticker} @ $${action.currentPrice.toFixed(2)} (-$${cost.toFixed(2)}). ${buyNote} Cash now ${currency} $${(portfolio.cashByValue?.[currency] || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}.` })

      if (portfolio.cooldowns?.[action.ticker]) delete portfolio.cooldowns[action.ticker]

      // Telegram alert
      await sendTelegramAlert(
        `🟢 *Finance Seer — BUY Executed*\n\n` +
        `*${action.ticker}* — ${action.shares} shares @ ${fmtCurrency(action.currentPrice, currency)}\n` +
        `Total cost: ${fmtCurrency(cost, currency)}\n\n` +
        `_Reason: ${action.reason.replace(/[*_`]/g, '')}_`
      )
    }

    // Update value history
    const fxRate = portfolio.fxRates?.SGDUSD || 0.7498
    const posValueUSD = (portfolio.positions || []).filter((p: any) => !isSGX(p.ticker)).reduce((s: number, p: any) => s + p.currentPrice * p.shares, 0)
    const posValueSGD = (portfolio.positions || []).filter((p: any) => isSGX(p.ticker)).reduce((s: number, p: any) => s + p.currentPrice * p.shares, 0)
    const totalValueUSD = (portfolio.cashByValue?.USD || 0) + posValueUSD + ((portfolio.cashByValue?.SGD || 0) + posValueSGD) * fxRate
    const lastEntry = portfolio.valueHistory?.[portfolio.valueHistory.length - 1]
    if (!lastEntry || lastEntry.date !== todayStr) {
      portfolio.valueHistory = [...(portfolio.valueHistory || []), { date: todayStr, value: totalValueUSD }]
    } else {
      portfolio.valueHistory[portfolio.valueHistory.length - 1].value = totalValueUSD
    }

    writePortfolio(portfolio)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Execute error:', error)
    return NextResponse.json({ error: 'Failed to execute' }, { status: 500 })
  }
}
