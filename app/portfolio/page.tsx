'use client'

import { useState, useEffect } from 'react'
import { Loader, ArrowLeft, TrendingUp, TrendingDown, DollarSign, FileText, Clock, LineChart, BarChart3 } from 'lucide-react'
import dynamic from 'next/dynamic'

const PortfolioValueChart = dynamic(() => import('@/components/PortfolioValueChart'), { ssr: false })

function fmt(n: number) { return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtPct(n: number) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%' }
function fmtNum(n: number) {
  if (!n) return '—'
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
  return fmt(n)
}

interface Position {
  ticker: string; shares: number; avgCost: number; buyDate: string; buyPrice: number
  currentPrice: number; stopLoss?: number; takeProfit?: number; signal: string; reason: string; companyName?: string; currency?: string
}
interface Trade {
  date: string; action: string; ticker: string; shares: number; price: number; total: number
  reason: string; companyName?: string; buyDate?: string; buyPrice?: number; pnl?: number; pnlPct?: number; currency?: string
}
interface ClosedPosition {
  ticker: string; shares: number; buyDate: string; buyPrice: number; sellDate: string
  sellPrice: number; reason: string; pnl: number; pnlPct: number; companyName?: string; currency?: string
}
interface ValuePoint { date: string; value: number }

function PositionCard({ pos, ti }: { pos: Position; ti?: any }) {
  const pnl = (pos.currentPrice - pos.avgCost) * pos.shares
  const pnlPct = pos.avgCost > 0 ? ((pos.currentPrice - pos.avgCost) / pos.avgCost) * 100 : 0
  const positive = pnl >= 0
  const currency = pos.currency || 'USD'

  // SL/TP progress bar
  const sl = pos.stopLoss || pos.buyPrice * 0.95
  const tp = pos.takeProfit || pos.buyPrice * 1.08
  const range = tp - sl
  const progress = range > 0 ? Math.max(0, Math.min(100, ((pos.currentPrice - sl) / range) * 100)) : 50

  return (
    <div style={{ background: '#0a0a0a', border: `1px solid ${positive ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: '10px', padding: '14px', marginBottom: '8px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div>
          <span style={{ color: 'white', fontWeight: 800, fontSize: '16px' }}>{pos.ticker}</span>
          <span style={{ color: '#52525b', fontSize: '11px', marginLeft: '6px' }}>{pos.companyName}</span>
          <div style={{ color: '#71717a', fontSize: '11px', marginTop: '2px' }}>{pos.shares} shares @ {fmt(pos.avgCost)} {currency}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: 'white', fontWeight: 700, fontSize: '15px' }}>{fmt(pos.currentPrice)}</div>
          <div style={{ color: positive ? '#34d399' : '#f87171', fontWeight: 600, fontSize: '12px' }}>
            {positive ? '+' : ''}{fmt(Math.abs(pnl))} ({fmtPct(pnlPct)})
          </div>
        </div>
      </div>

      {/* SL ↔ TP Progress bar */}
      <div style={{ marginBottom: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#52525b', marginBottom: '3px' }}>
          <span style={{ color: '#f87171' }}>SL {fmt(sl)}</span>
          <span style={{ color: '#71717a' }}>Entry {fmt(pos.avgCost)}</span>
          <span style={{ color: '#34d399' }}>TP {fmt(tp)}</span>
        </div>
        <div style={{ height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${progress}%`, background: positive ? '#34d399' : '#f87171', borderRadius: '2px', transition: 'width 0.3s' }} />
          {/* Entry marker */}
          <div style={{ position: 'absolute', top: '-2px', left: `${Math.max(0, Math.min(100, ((pos.avgCost - sl) / range) * 100))}%`, width: '2px', height: '8px', background: '#71717a', transform: 'translateX(-50%)' }} />
        </div>
      </div>

      <div style={{ color: '#3f3f46', fontSize: '10px' }}>Bought {pos.buyDate} · {ti?.daysHeld ?? 0}d held</div>
    </div>
  )
}

export default function PortfolioPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/portfolio').then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className='min-h-screen bg-black flex items-center justify-center gap-4'>
      <Loader className='animate-spin text-blue-400' size={28} />
      <span className='text-zinc-500'>Loading portfolio...</span>
    </div>
  )

  if (!data || data.error) return (
    <div className='min-h-screen bg-black flex items-center justify-center'>
      <p className='text-red-400'>Failed to load portfolio data.</p>
    </div>
  )

  const summary = data.summary || {}
  const positions: Position[] = data.positions || []
  const history: Trade[] = data.history || []
  const strategyNotes = data.strategyNotes || []
  const closedPositions: ClosedPosition[] = data.closedPositions || []
  const valueHistory: ValuePoint[] = data.valueHistory || []
  const performance = data.performance || {}
  const tradeIndicators: any[] = data.tradeIndicators || []
  const isPositive = summary.totalReturn >= 0

  // Avg return of open positions
  const avgOpenReturn = positions.length > 0
    ? positions.reduce((sum, p) => sum + ((p.currentPrice - p.avgCost) / p.avgCost) * 100, 0) / positions.length
    : 0

  return (
    <div className='min-h-screen bg-black'>
      {/* Header */}
      <header style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 24px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(12px)', zIndex: 100 }}>
        <a href='/' style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#71717a', textDecoration: 'none', fontSize: '13px' }}>
          <ArrowLeft size={15} /> Finance Seer
        </a>
        <span style={{ fontSize: '18px', fontWeight: 900, background: 'linear-gradient(135deg,#60a5fa,#a78bfa,#f472b6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>AI Portfolio</span>
        <div style={{ width: '80px' }} />
      </header>

      {/* Two-column layout */}
      <div className='main-grid' style={{ maxWidth: '1600px', margin: '0 auto' }}>

        {/* ── LEFT: Summary + Chart + Value History ── */}
        <aside className='left-panel' style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Summary Card */}
          <div style={{ background: 'linear-gradient(135deg,#0f0f2e,#1a1040)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '14px', padding: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '4px' }}>
              <span style={{ color: 'white', fontSize: '28px', fontWeight: 900 }}>{fmt(summary.totalValue)}</span>
              <span style={{ color: isPositive ? '#34d399' : '#f87171', fontWeight: 700, fontSize: '16px' }}>
                {isPositive ? '▲' : '▼'} {fmt(Math.abs(summary.totalReturn))} ({fmtPct(summary.totalReturnPct)})
              </span>
            </div>
            <div style={{ color: '#6366f1', fontSize: '11px', marginBottom: '16px' }}>
              Since {summary.startDate} · {summary.daysSinceStart} days active
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {/* Invested */}
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '10px 12px' }}>
                <div style={{ color: '#52525b', fontSize: '10px', marginBottom: '3px' }}>Invested</div>
                <div style={{ color: 'white', fontWeight: 700, fontSize: '14px' }}>{fmt(summary.positionsValue)}</div>
                <div style={{ color: avgOpenReturn >= 0 ? '#34d399' : '#f87171', fontSize: '11px', fontWeight: 600 }}>
                  {fmtPct(avgOpenReturn)} avg
                </div>
              </div>
              {/* Cash */}
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '10px 12px' }}>
                <div style={{ color: '#52525b', fontSize: '10px', marginBottom: '3px' }}>Cash</div>
                <div style={{ color: 'white', fontWeight: 700, fontSize: '14px' }}>{fmt(summary.cashUSD)} USD</div>
                {summary.cashSGD > 0 && <div style={{ color: '#a5b4fc', fontSize: '11px' }}>{fmt(summary.cashSGD)} SGD</div>}
              </div>
              {/* Win Rate */}
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '10px 12px' }}>
                <div style={{ color: '#52525b', fontSize: '10px', marginBottom: '3px' }}>Win Rate</div>
                <div style={{ color: '#34d399', fontWeight: 700, fontSize: '14px' }}>{performance.winRate}%</div>
                <div style={{ color: '#52525b', fontSize: '11px' }}>{performance.profitableTrades}/{performance.totalTrades} trades</div>
              </div>
              {/* Best Trade */}
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '10px 12px' }}>
                <div style={{ color: '#52525b', fontSize: '10px', marginBottom: '3px' }}>Best Trade</div>
                {performance.bestTrade ? (
                  <>
                    <div style={{ color: '#34d399', fontWeight: 700, fontSize: '14px' }}>{performance.bestTrade.ticker}</div>
                    <div style={{ color: '#34d399', fontSize: '11px' }}>+{performance.bestTrade.pnlPct?.toFixed(2)}%</div>
                  </>
                ) : <div style={{ color: '#52525b', fontSize: '12px' }}>—</div>}
              </div>
            </div>
          </div>

          {/* Portfolio Value Chart — fixed height, won't grow */}
          <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
              <LineChart size={14} style={{ color: '#6366f1' }} />
              <span style={{ color: '#a5b4fc', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Portfolio Value</span>
            </div>
            <PortfolioValueChart data={valueHistory} startingCapital={data.startingCapital || 100000} />
          </div>

          {/* Disclaimer */}
          <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '8px', padding: '10px 12px', marginTop: 'auto' }}>
            <p style={{ color: '#3f3f46', fontSize: '10px', lineHeight: '1.5', margin: 0 }}>
              Simulated portfolio for educational purposes. No real money invested. Not financial advice.
            </p>
          </div>
        </aside>

        {/* ── RIGHT: Positions + History ── */}
        <main className='right-panel' style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Open Positions */}
          <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
              <BarChart3 size={14} style={{ color: '#3b82f6' }} />
              <span style={{ color: '#a5b4fc', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Open Positions</span>
              <span style={{ color: '#3f3f46', fontSize: '11px', marginLeft: '4px' }}>{positions.length} active</span>
            </div>
            {positions.length === 0 ? (
              <p style={{ color: '#3f3f46', fontSize: '13px' }}>No open positions.</p>
            ) : (
              positions.map((pos, i) => {
                const ti = tradeIndicators.find(t => t.ticker === pos.ticker)
                return <PositionCard key={i} pos={pos} ti={ti} />
              })
            )}
          </div>

          {/* Closed Positions */}
          {closedPositions.length > 0 && (
            <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
                <TrendingDown size={14} style={{ color: '#a78bfa' }} />
                <span style={{ color: '#a5b4fc', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Closed Positions</span>
                <span style={{ color: '#3f3f46', fontSize: '11px', marginLeft: '4px' }}>{closedPositions.length} trades</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {closedPositions.slice().reverse().map((cp, i) => (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${cp.pnl >= 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`, borderRadius: '10px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div>
                        <span style={{ color: 'white', fontWeight: 700, fontSize: '15px' }}>{cp.ticker}</span>
                        <span style={{ color: '#52525b', fontSize: '11px', marginLeft: '6px' }}>{cp.companyName}</span>
                        <div style={{ color: '#52525b', fontSize: '11px', marginTop: '2px' }}>{cp.shares} shares · {cp.currency || 'USD'}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: cp.pnl >= 0 ? '#34d399' : '#f87171', fontWeight: 700, fontSize: '14px' }}>
                          {cp.pnl >= 0 ? '+' : ''}{fmt(cp.pnl)}
                        </div>
                        <div style={{ color: cp.pnl >= 0 ? '#34d399' : '#f87171', fontSize: '12px' }}>{fmtPct(cp.pnlPct)}</div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '6px' }}>
                      <div><div style={{ color: '#3f3f46', fontSize: '10px' }}>Buy</div><div style={{ color: '#d4d4d8', fontSize: '12px' }}>{fmt(cp.buyPrice)} · {cp.buyDate}</div></div>
                      <div><div style={{ color: '#3f3f46', fontSize: '10px' }}>Sell</div><div style={{ color: '#d4d4d8', fontSize: '12px' }}>{fmt(cp.sellPrice)} · {cp.sellDate}</div></div>
                      <div><div style={{ color: '#3f3f46', fontSize: '10px' }}>Proceeds</div><div style={{ color: 'white', fontSize: '12px', fontWeight: 600 }}>{fmt(cp.sellPrice * cp.shares)}</div></div>
                    </div>
                    <div style={{ color: '#3f3f46', fontSize: '10px' }}>{cp.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Strategy Notes */}
          {strategyNotes.length > 0 && (
            <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                <FileText size={14} style={{ color: '#f59e0b' }} />
                <span style={{ color: '#a5b4fc', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Strategy Notes</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {strategyNotes.slice().reverse().map((note: any, i: number) => (
                  <div key={i} style={{ borderLeft: '2px solid rgba(99,102,241,0.3)', paddingLeft: '10px' }}>
                    <div style={{ color: '#52525b', fontSize: '10px', marginBottom: '2px' }}>{note.date}</div>
                    <p style={{ color: '#a1a1aa', fontSize: '12px', lineHeight: '1.5', margin: 0 }}>{note.note}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trade History */}
          <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
              <Clock size={14} style={{ color: '#f59e0b' }} />
              <span style={{ color: '#a5b4fc', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Trade History</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {history.slice().reverse().map((trade, i) => {
                const isSell = trade.action === 'SELL'
                return (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '10px 12px', borderLeft: `3px solid ${isSell ? '#f87171' : '#34d399'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '3px', background: isSell ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)', color: isSell ? '#f87171' : '#34d399' }}>{trade.action}</span>
                        <span style={{ color: 'white', fontWeight: 600, fontSize: '13px' }}>{trade.ticker}</span>
                        <span style={{ color: '#52525b', fontSize: '11px' }}>{trade.companyName}</span>
                      </div>
                      {isSell && trade.pnl !== undefined && (
                        <span style={{ color: trade.pnl >= 0 ? '#34d399' : '#f87171', fontSize: '12px', fontWeight: 600 }}>
                          {trade.pnl >= 0 ? '+' : ''}{fmt(trade.pnl)} ({fmtPct(trade.pnlPct || 0)})
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#71717a', marginBottom: '4px' }}>
                      <span>{trade.shares} shares @ {fmt(trade.price)}</span>
                      <span>Total: {fmt(trade.total)}</span>
                      <span>{trade.date}</span>
                      {trade.currency && trade.currency !== 'USD' && <span style={{ color: '#a5b4fc' }}>{trade.currency}</span>}
                    </div>
                    <div style={{ color: '#3f3f46', fontSize: '10px' }}>{trade.reason}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
