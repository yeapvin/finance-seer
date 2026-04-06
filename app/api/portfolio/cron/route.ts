/**
 * Scheduled portfolio monitor — called by Vercel Cron
 * Runs at NYSE open/mid/close (SGX trading discontinued)
 * Sends Telegram alerts for any actionable signals
 */
import { NextRequest, NextResponse } from 'next/server'
import { getLiveQuote } from '@/lib/market-data'

export const dynamic = 'force-dynamic'

async function sendTelegram(token: string, chatId: string, message: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
  })
}

function marketSession(): string {
  // Determine which market session this is (SGT = UTC+8)
  const now = new Date()
  const sgtHour = (now.getUTCHours() + 8) % 24
  const sgtMin = now.getUTCMinutes()
  const time = sgtHour * 100 + sgtMin

  if (time >= 2130 && time < 2200) return '🇺🇸 NYSE Open'
  if (time >= 100 && time < 130) return '🇺🇸 NYSE Mid-Session'
  if (time >= 400 && time < 430) return '🇺🇸 NYSE Close'
  return '📊 Scheduled Check'
}

// NYSE public holidays 2025-2026
const NYSE_HOLIDAYS = [
  '2025-01-01','2025-01-20','2025-02-17','2025-04-18','2025-05-26',
  '2025-06-19','2025-07-04','2025-09-01','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
  '2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25'
]

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  // Check if today is a NYSE holiday
  const todayUTC = new Date().toISOString().split('T')[0]
  if (NYSE_HOLIDAYS.includes(todayUTC)) {
    console.log(`Skipping — NYSE holiday on ${todayUTC}`)
    return NextResponse.json({ skipped: true, reason: `NYSE holiday: ${todayUTC}` })
  }

  try {
    // Always use the stable production URL — VERCEL_URL is deployment-specific and unreliable
    const baseUrl = process.env.APP_URL || 'https://finance-seer.vercel.app'

    const res = await fetch(`${baseUrl}/api/portfolio/monitor`, { method: 'POST' })
    const result = await res.json()

    // Market closed — skip silently
    if (result.skipped) {
      return NextResponse.json({ success: true, skipped: true, reason: result.reason })
    }

    if (!result.success) {
      throw new Error('Monitor returned failure')
    }

    const executedTrades: any[] = result.executedTrades || []
    const nearMisses: any[] = result.nearMisses || []
    const positions: any[] = result.positions || []
    const totalValue: number = result.totalValue || 0
    const currentSession = marketSession()

    // Fetch SPY for market mood
    let marketMood = ''
    try {
      const spy = await getLiveQuote('SPY')
      if (spy) {
        const pct = spy.changePercent
        if (pct <= -2) marketMood = `📉 Market: SPY ${pct.toFixed(2)}% — broad selloff, stay defensive`
        else if (pct <= -1) marketMood = `📉 Market: SPY ${pct.toFixed(2)}% — weak session`
        else if (pct >= 2) marketMood = `📈 Market: SPY +${pct.toFixed(2)}% — strong rally`
        else if (pct >= 1) marketMood = `📈 Market: SPY +${pct.toFixed(2)}% — positive session`
        else marketMood = `➡️ Market: SPY ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% — flat/mixed`
      }
    } catch { /* skip */ }

    // Build position commentary
    const posComments: string[] = []
    for (const pos of positions) {
      const price = pos.currentPrice || pos.buyPrice
      const cost = pos.avgCost || pos.buyPrice
      const pnlPct = cost > 0 ? ((price - cost) / cost * 100) : 0
      const sl = pos.stopLoss
      const tp = pos.takeProfit
      const distToTP = tp ? ((tp - price) / price * 100) : null
      const distToSL = sl ? ((price - sl) / price * 100) : null

      let comment = `${pnlPct >= 0 ? '🟢' : '🔴'} *${pos.ticker}* $${price?.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`
      if (distToTP !== null && distToTP < 5) comment += ` — 🎯 ${distToTP.toFixed(1)}% from TP`
      else if (distToSL !== null && distToSL < 5) comment += ` — ⚠️ ${distToSL.toFixed(1)}% from SL`
      else if (pnlPct > 10) comment += ` — strong gain, consider trailing stop`
      else if (pnlPct < -5) comment += ` — watch closely`
      posComments.push(comment)
    }

    // Send Telegram summary
    if (token && chatId) {
      let msg = `*Finance Seer — ${currentSession}*\n`
      msg += `Portfolio: USD $${totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}\n`
      if (marketMood) msg += `${marketMood}\n`
      msg += '\n'

      if (executedTrades.length > 0) {
        msg += `⚡ *${executedTrades.length} Trade${executedTrades.length > 1 ? 's' : ''} Executed*\n`
        executedTrades.forEach((t: any) => {
          const emoji = t.type === 'BUY' ? '🟢' : '🔴'
          msg += `${emoji} ${t.type} *${t.ticker}* — ${t.shares} shares @ ${t.currency} $${t.price?.toFixed(2)}\n`
          if (t.reason) msg += `   _${t.reason.replace(/[*_`]/g, '').substring(0, 100)}_\n`
        })
        msg += '\n'
      }

      // Position summary
      if (posComments.length > 0) {
        msg += `*Open Positions (${posComments.length}):*\n`
        posComments.forEach(c => msg += `${c}\n`)
        msg += '\n'
      } else {
        msg += `No open positions.\n\n`
      }

      // Near-miss alerts
      if (nearMisses.length > 0) {
        msg += '👀 *Watch closely:*\n'
        nearMisses.forEach((n: any) => {
          const emoji = n.type === 'TP' ? '🎯' : '⚠️'
          const label = n.type === 'TP' ? 'Take Profit' : 'Stop Loss'
          msg += `${emoji} *${n.ticker}* within ${n.pct}% of ${label} ($${n.price?.toFixed(2)} vs $${n.level?.toFixed(2)})\n`
        })
        msg += '\n'
      }

      msg += `_finance-seer.vercel.app/portfolio_`
      await sendTelegram(token, chatId, msg)
    }

    return NextResponse.json({ success: true, session: currentSession, tradesExecuted: executedTrades.length })
  } catch (error) {
    console.error('Cron error:', error)

    // Alert on failure too
    if (token && chatId) {
      await sendTelegram(token, chatId, `⚠️ *Finance Seer* — Monitor check failed at ${marketSession()}. Please check the app.`)
    }

    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
