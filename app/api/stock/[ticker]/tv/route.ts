/**
 * TradingView data for a ticker via tvscreener Python script
 * Returns: RSI, MACD, MAs, ATR, BB, Stochastic, TV rating, analyst rating
 */
import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'

const execAsync = promisify(exec)
export const dynamic = 'force-dynamic'

const cache = new Map<string, { data: any; ts: number }>()
const CACHE_TTL = 10 * 60 * 1000 // 10 min

export async function GET(_: NextRequest, { params }: { params: { ticker: string } }) {
  const ticker = (params.ticker as string).toUpperCase()

  const cached = cache.get(ticker)
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.data)
  }

  try {
    const scriptPath = path.join(process.cwd(), 'scripts', 'tv_quote.py')
    const { stdout, stderr } = await execAsync(`python3 ${scriptPath} ${ticker}`, { timeout: 15000 })
    if (stderr && !stdout) throw new Error(stderr)
    const data = JSON.parse(stdout)
    if (data.error) return NextResponse.json({ error: data.error }, { status: 404 })

    cache.set(ticker, { data, ts: Date.now() })
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
