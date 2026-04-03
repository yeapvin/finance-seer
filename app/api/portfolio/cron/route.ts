/**
 * Scheduled portfolio monitor — called by Vercel Cron
 * Runs at SGX open/mid/close and NYSE open/mid/close
 * Sends Telegram alerts for any actionable signals
 */
import { NextRequest, NextResponse } from 'next/server'

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

  if (time >= 900 && time < 930) return '🇸🇬 SGX Open'
  if (time >= 1200 && time < 1230) return '🇸🇬 SGX Mid-Session'
  if (time >= 1700 && time < 1730) return '🇸🇬 SGX Close'
  if (time >= 2130 && time < 2200) return '🇺🇸 NYSE Open'
  if (time >= 100 && time < 130) return '🇺🇸 NYSE Mid-Session'
  if (time >= 400 && time < 430) return '🇺🇸 NYSE Close'
  return '📊 Scheduled Check'
}

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  try {
    // Run the monitor
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://finance-seer.vercel.app'

    const res = await fetch(`${baseUrl}/api/portfolio/monitor`, { method: 'POST' })
    const result = await res.json()

    if (!result.success) {
      throw new Error('Monitor failed')
    }

    const { actions, summary, fxRate } = result
    const session = marketSession()

    const urgent = actions.filter((a: any) => a.urgent)
    const sells = actions.filter((a: any) => a.type === 'SELL' && !a.urgent)
    const buys = actions.filter((a: any) => a.type === 'BUY')
    const holds = actions.filter((a: any) => a.type === 'HOLD')
    const toExecute = [...urgent, ...sells, ...buys]

    // Auto-execute all BUY and SELL signals
    const executed: any[] = []
    for (const action of toExecute) {
      try {
        const execRes = await fetch(`${baseUrl}/api/portfolio/monitor`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        })
        const execResult = await execRes.json()
        if (execResult.success) executed.push(action)
      } catch (e) {
        console.error(`Failed to execute ${action.type} ${action.ticker}:`, e)
      }
    }

    // Send Telegram summary
    if (token && chatId) {
      let msg = `*Finance Seer — ${session}*\n`
      msg += `Portfolio: USD $${summary?.totalValueUSD?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) || 'N/A'} | SGD/USD: ${fxRate?.toFixed(4) || 'N/A'}\n\n`

      if (executed.length > 0) {
        msg += `⚡ *${executed.length} Trade${executed.length > 1 ? 's' : ''} Executed*\n`
        executed.forEach((a: any) => {
          const emoji = a.type === 'BUY' ? '🟢' : '🔴'
          msg += `${emoji} ${a.type} ${a.ticker} — ${a.shares} shares @ ${a.currency} $${a.currentPrice?.toFixed(2)}\n`
          msg += `   _${a.reason.replace(/[*_`]/g, '').substring(0, 80)}_\n`
        })
        msg += '\n'
      } else {
        msg += `✅ All ${holds.length} positions HOLD — no action needed.\n`
      }

      msg += `_View portfolio: finance-seer.vercel.app/portfolio_`
      await sendTelegram(token, chatId, msg)
    }

    return NextResponse.json({ success: true, session, actionsFound: actions.length })
  } catch (error) {
    console.error('Cron error:', error)

    // Alert on failure too
    if (token && chatId) {
      await sendTelegram(token, chatId, `⚠️ *Finance Seer* — Monitor check failed at ${marketSession()}. Please check the app.`)
    }

    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
