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
    const cashUSD: number = result.cashUSD || 0
    const startingCapital: number = result.startingCapital || 100000
    const startDate: string = result.startDate || ''
    const totalReturn = totalValue - startingCapital
    const totalReturnPct = (totalReturn / startingCapital * 100)
    const currentSession = marketSession()
    const isClose = currentSession.includes('Close')

    // Date for header
    const now = new Date()
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Singapore' })

    // Fetch SPY for market mood
    let spyPct = 0
    let marketMood = ''
    try {
      const spy = await getLiveQuote('SPY')
      if (spy) {
        spyPct = spy.changePercent
        if (spyPct <= -2) marketMood = `📉 SPY ${spyPct.toFixed(2)}% — broad selloff, stay defensive`
        else if (spyPct <= -1) marketMood = `📉 SPY ${spyPct.toFixed(2)}% — weak session`
        else if (spyPct >= 2) marketMood = `📈 SPY +${spyPct.toFixed(2)}% — strong rally`
        else if (spyPct >= 1) marketMood = `📈 SPY +${spyPct.toFixed(2)}% — positive session`
        else marketMood = `➡️ SPY ${spyPct >= 0 ? '+' : ''}${spyPct.toFixed(2)}% — flat/mixed`
      }
    } catch { /* skip */ }

    // Send Telegram summary
    if (token && chatId) {
      let msg = isClose
        ? `*📅 End-of-Day Summary — ${dateStr}*\n`
        : `*Finance Seer — ${currentSession}*\n`

      msg += `Portfolio: *$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}* | Return: ${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}% since ${startDate}\n`
      if (marketMood) msg += `${marketMood}\n`
      msg += '\n'

      // Trades
      if (executedTrades.length > 0) {
        msg += `⚡ *${executedTrades.length} Trade${executedTrades.length > 1 ? 's' : ''} Executed*\n`
        executedTrades.forEach((t: any) => {
          const emoji = t.type === 'BUY' ? '🟢' : '🔴'
          msg += `${emoji} ${t.type} *${t.ticker}* — ${t.shares} shares @ $${t.price?.toFixed(2)}\n`
          if (t.reason) msg += `   _${t.reason.replace(/[*_`]/g, '').substring(0, 120)}_\n`
        })
        msg += '\n'
      }

      // Position table
      if (positions.length > 0) {
        msg += `*Open Positions:*\n`
        for (const pos of positions) {
          const price = pos.currentPrice || pos.buyPrice
          const cost = pos.avgCost || pos.buyPrice
          const pnl = (price - cost) * pos.shares
          const pnlPct = cost > 0 ? ((price - cost) / cost * 100) : 0
          const sl = pos.stopLoss
          const tp = pos.takeProfit
          const distToTP = tp ? ((tp - price) / price * 100) : null
          const distToSL = sl ? ((price - sl) / price * 100) : null

          const emoji = pnlPct >= 0 ? '🟢' : '🔴'
          msg += `${emoji} *${pos.ticker}* (${pos.shares}sh) @ $${price.toFixed(2)} | ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% ($${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)})\n`
          msg += `   SL $${sl?.toFixed(2) || 'N/A'} | TP $${tp?.toFixed(2) || 'N/A'}`
          if (distToTP !== null && distToTP < 3) msg += ` | ⚠️ ${distToTP.toFixed(2)}% from TP`
          else if (distToSL !== null && distToSL < 5) msg += ` | ⚠️ ${distToSL.toFixed(2)}% from SL`
          msg += '\n'
        }
        msg += `💵 Cash: $${cashUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n`
      } else {
        msg += `No open positions.\n💵 Cash: $${cashUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n`
      }

      // Flags — detailed per-position commentary
      const flags: string[] = []
      for (const pos of positions) {
        const price = pos.currentPrice || pos.buyPrice
        const cost = pos.avgCost || pos.buyPrice
        const pnlPct = cost > 0 ? ((price - cost) / cost * 100) : 0
        const sl = pos.stopLoss
        const tp = pos.takeProfit
        const distToTP = tp ? ((tp - price) / price * 100) : null
        const distToSL = sl ? ((price - sl) / price * 100) : null

        if (distToTP !== null && distToTP < 1) {
          flags.push(`🔴 *${pos.ticker}* — ${distToTP.toFixed(2)}% from Take-Profit ($${tp.toFixed(2)}): Essentially at target. Consider whether to exit or let it run.`)
        } else if (distToTP !== null && distToTP < 3) {
          flags.push(`🎯 *${pos.ticker}* — ${distToTP.toFixed(2)}% from Take-Profit ($${tp.toFixed(2)}): Getting close. Watch for rejection at this level.`)
        } else if (distToSL !== null && distToSL < 3) {
          flags.push(`🚨 *${pos.ticker}* — ${distToSL.toFixed(2)}% above Stop-Loss ($${sl.toFixed(2)}): Danger zone. Be ready to exit.`)
        } else if (distToSL !== null && distToSL < 6) {
          flags.push(`🟡 *${pos.ticker}* — ${distToSL.toFixed(2)}% above Stop-Loss ($${sl.toFixed(2)}): Below SL could happen within a few sessions if weakness continues.`)
        } else if (pnlPct > 15) {
          flags.push(`✨ *${pos.ticker}* — Up ${pnlPct.toFixed(1)}%. Strong gain. Consider trailing stop to lock in profit.`)
        } else if (pnlPct < -8) {
          flags.push(`⚠️ *${pos.ticker}* — Down ${Math.abs(pnlPct).toFixed(1)}%. Watching closely for SL breach.`)
        }
      }

      // Market flag
      if (spyPct <= -2) flags.push(`📉 Broad market selloff today (SPY ${spyPct.toFixed(2)}%). Screener in conservative mode — only STRONG BUY signals qualify for new buys.`)

      if (flags.length > 0) {
        msg += `*⚠️ Flags:*\n`
        flags.forEach(f => msg += `${f}\n\n`)
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
