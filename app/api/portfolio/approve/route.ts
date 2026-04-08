/**
 * Trade Approval API
 * 
 * POST /api/portfolio/approve
 * Body: { action, ticker, shares, price, sl, tp, reason, tradeId }
 * 
 * Stores pending trade and sends Telegram approval request with buttons.
 * 
 * GET /api/portfolio/approve?tradeId=xxx&decision=approve|reject
 * Called by Telegram button webhook to execute or cancel the trade.
 */
import { NextRequest, NextResponse } from 'next/server'
import { readPortfolio, writePortfolio } from '@/lib/portfolio-store'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)
export const dynamic = 'force-dynamic'

const IBKR_HOST = '172.23.160.1'
const IBKR_PORT = 4002
const SCRIPT = path.join(process.cwd(), 'scripts', 'ibkr_execute.py')
const APP_URL = process.env.APP_URL || 'https://finance-seer.vercel.app'

async function sendTelegram(message: string, buttons?: any[][]) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return null
  
  const body: any = {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
  }
  
  if (buttons) {
    body.reply_markup = {
      inline_keyboard: buttons
    }
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await res.json()
  return data?.result?.message_id
}

// POST — queue a trade for approval
export async function POST(req: NextRequest) {
  try {
    const trade = await req.json()
    const { action, ticker, shares, price, sl, tp, reason, tradeId } = trade

    if (!action || !ticker || !shares || !tradeId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Store pending trade in portfolio
    const portfolio = await readPortfolio()
    portfolio.pendingTrades = portfolio.pendingTrades || {}
    portfolio.pendingTrades[tradeId] = {
      ...trade,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    await writePortfolio(portfolio)

    // Send Telegram approval request
    const cost = price ? (price * shares).toFixed(2) : 'market'
    const emoji = action === 'BUY' ? '🟢' : '🔴'
    
    const msg = `${emoji} *Trade Approval Required*\n\n` +
      `*${action}* ${shares}x *${ticker}* @ $${price?.toFixed(2) || 'market'}\n` +
      `Cost: ~$${cost}\n` +
      `SL: $${sl?.toFixed(2) || 'N/A'} | TP: $${tp?.toFixed(2) || 'N/A'}\n\n` +
      `_${(reason || '').substring(0, 150)}_\n\n` +
      `⏰ Expires in 10 minutes`

    const approveUrl = `${APP_URL}/api/portfolio/approve?tradeId=${tradeId}&decision=approve`
    const rejectUrl = `${APP_URL}/api/portfolio/approve?tradeId=${tradeId}&decision=reject`

    await sendTelegram(msg, [
      [
        { text: '✅ Approve', callback_data: `approve_${tradeId}` },
        { text: '❌ Reject', callback_data: `reject_${tradeId}` },
      ]
    ])

    // Auto-expire after 10 minutes
    setTimeout(async () => {
      try {
        const p = await readPortfolio()
        if (p.pendingTrades?.[tradeId]?.status === 'pending') {
          p.pendingTrades[tradeId].status = 'expired'
          await writePortfolio(p)
          await sendTelegram(`⏰ Trade approval expired: *${action}* ${shares}x *${ticker}*`)
        }
      } catch {}
    }, 10 * 60 * 1000)

    return NextResponse.json({ success: true, tradeId, status: 'pending_approval' })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// GET — process approval decision (called via Telegram button or direct URL)
export async function GET(req: NextRequest) {
  try {
    const tradeId = req.nextUrl.searchParams.get('tradeId')
    const decision = req.nextUrl.searchParams.get('decision')

    if (!tradeId || !decision) {
      return NextResponse.json({ error: 'tradeId and decision required' }, { status: 400 })
    }

    const portfolio = await readPortfolio()
    const trade = portfolio.pendingTrades?.[tradeId]

    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
    if (trade.status !== 'pending') {
      return NextResponse.json({ error: `Trade already ${trade.status}` }, { status: 409 })
    }

    if (decision === 'reject') {
      portfolio.pendingTrades[tradeId].status = 'rejected'
      await writePortfolio(portfolio)
      await sendTelegram(`❌ Trade rejected: *${trade.action}* ${trade.shares}x *${trade.ticker}*`)
      return NextResponse.json({ success: true, status: 'rejected' })
    }

    if (decision === 'approve') {
      portfolio.pendingTrades[tradeId].status = 'executing'
      await writePortfolio(portfolio)

      // Execute via IBKR
      try {
        const priceArg = trade.price ? `--price ${trade.price.toFixed(2)}` : ''
        const cmd = `python3 ${SCRIPT} ${trade.action} ${trade.ticker} ${trade.shares} ${priceArg} 2>&1`
        const { stdout } = await execAsync(cmd, { timeout: 30000 })
        const result = JSON.parse(stdout)

        if (result.error) throw new Error(result.error)

        portfolio.pendingTrades[tradeId].status = 'executed'
        portfolio.pendingTrades[tradeId].ibkrResult = result
        await writePortfolio(portfolio)

        const fillPrice = result.avgFillPrice > 0 ? result.avgFillPrice : trade.price
        const emoji = trade.action === 'BUY' ? '🟢' : '🔴'
        await sendTelegram(
          `${emoji} *IBKR Trade Executed*\n\n` +
          `*${trade.action}* ${trade.shares}x *${trade.ticker}* @ $${fillPrice?.toFixed(2) || 'market'}\n` +
          `Order ID: ${result.orderId}\n` +
          `Status: ${result.status}\n` +
          `_${(trade.reason || '').substring(0, 100)}_`
        )

        return NextResponse.json({ success: true, status: 'executed', result })
      } catch (e) {
        portfolio.pendingTrades[tradeId].status = 'failed'
        portfolio.pendingTrades[tradeId].error = String(e)
        await writePortfolio(portfolio)
        await sendTelegram(`⚠️ *IBKR execution failed*: ${trade.action} ${trade.ticker}\nError: ${String(e)}`)
        return NextResponse.json({ error: String(e) }, { status: 500 })
      }
    }

    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
