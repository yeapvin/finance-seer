'use client'

import { useState, useEffect } from 'react'
import { Loader, ArrowLeft, TrendingUp, TrendingDown, DollarSign, Calendar, BarChart3, FileText, Clock, LineChart } from 'lucide-react'
import dynamic from 'next/dynamic'

const PortfolioValueChart = dynamic(() => import('@/components/PortfolioValueChart'), { ssr: false })

interface Position {
  ticker: string; shares: number; avgCost: number; buyDate: string; buyPrice: number; currentPrice: number; signal: string; reason: string; companyName?: string
}
interface Trade {
  date: string; action: string; ticker: string; shares: number; price: number; total: number; reason: string; companyName?: string; buyDate?: string; buyPrice?: number; buyTotal?: number; pnl?: number; pnlPct?: number
}
interface ClosedPosition {
  ticker: string; shares: number; buyDate: string; buyPrice: number; sellDate: string; sellPrice: number; reason: string; pnl: number; pnlPct: number; companyName?: string
}
interface StrategyNote { date: string; note: string }
interface MonthlyReview { date: string; review: string; totalValue: number; returnPct: number }
interface ValuePoint { date: string; value: number }

function fmt(n: number) { return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtPct(n: number) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%' }

export default function PortfolioPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [monitoring, setMonitoring] = useState(false)
  const [actions, setActions] = useState<any[]>([])
  const [executing, setExecuting] = useState<string | null>(null)
  const [monitorSummary, setMonitorSummary] = useState<any>(null)

  const refreshData = () => {
    fetch('/api/portfolio').then(r => r.json()).then(d => setData(d))
  }

  useEffect(() => {
    fetch('/api/portfolio').then(r => r.json()).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const runMonitor = async () => {
    setMonitoring(true)
    setActions([])
    try {
      const res = await fetch('/api/portfolio/monitor', { method: 'POST' })
      const result = await res.json()
      if (result.actions) {
        setActions(result.actions)
        setMonitorSummary(result.summary)
        refreshData()
      }
    } catch (e) {
      alert('Monitor failed. Please try again.')
    }
    setMonitoring(false)
  }

  const executeAction = async (action: any) => {
    setExecuting(action.ticker + action.type)
    try {
      const res = await fetch('/api/portfolio/monitor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      const result = await res.json()
      if (result.success) {
        setActions(prev => prev.filter(a => !(a.ticker === action.ticker && a.type === action.type)))
        refreshData()
      }
    } catch (e) {
      alert('Failed to execute trade.')
    }
    setExecuting(null)
  }

  if (loading) return (
    <div className='min-h-screen bg-black flex items-center justify-center'>
      <Loader className='animate-spin text-blue-400' size={36} />
      <span className='text-zinc-400 ml-4'>Loading portfolio...</span>
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
  const strategyNotes: StrategyNote[] = data.strategyNotes || []
  const monthlyReviews: MonthlyReview[] = data.monthlyReviews || []
  const cooldowns: Record<string, string> = data.cooldowns || {}
  const closedPositions: ClosedPosition[] = data.closedPositions || []
  const valueHistory: ValuePoint[] = data.valueHistory || []
  const performance = data.performance || {}
  const tradeIndicators: any[] = data.tradeIndicators || []
  const isPositive = summary.totalReturn >= 0

  return (
    <div className='min-h-screen bg-black'>
      <div className='max-w-4xl mx-auto px-4 py-8'>
        <a href='/' className='inline-flex items-center gap-2 text-zinc-500 hover:text-white text-sm mb-6 transition-colors'>
          <ArrowLeft size={16} /> Back to Finance Seer
        </a>

        {/* Monitor Button */}
        <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={runMonitor}
            disabled={monitoring}
            style={{
              padding: '10px 24px', borderRadius: '10px', fontWeight: 700, fontSize: '14px', cursor: monitoring ? 'not-allowed' : 'pointer',
              background: monitoring ? '#1f1f1f' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '8px'
            }}
          >
            {monitoring ? <><Loader size={14} className='animate-spin' /> Analysing positions...</> : '🔍 Run Market Analysis'}
          </button>
          {monitorSummary && (
            <span style={{ color: '#71717a', fontSize: '13px' }}>
              {monitorSummary.actionsFound} signal{monitorSummary.actionsFound !== 1 ? 's' : ''} found · Portfolio value {fmt(monitorSummary.totalValue)}
            </span>
          )}
        </div>

        {/* Action Cards */}
        {actions.length > 0 && (
          <div style={{ background: '#0d1117', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '14px', padding: '20px', marginBottom: '24px' }}>
            <h2 style={{ color: '#a78bfa', fontWeight: 700, fontSize: '16px', marginBottom: '12px' }}>⚡ AI Trading Signals</h2>
            <div className='space-y-3'>
              {actions.map((action: any, i: number) => (
                <div key={i} style={{
                  background: '#111', borderRadius: '10px', padding: '14px',
                  border: action.type === 'BUY' ? '1px solid rgba(16,185,129,0.3)' : action.type === 'SELL' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(255,255,255,0.06)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: '11px', fontWeight: 700, padding: '2px 10px', borderRadius: '4px',
                        background: action.type === 'BUY' ? 'rgba(16,185,129,0.15)' : action.type === 'SELL' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.07)',
                        color: action.type === 'BUY' ? '#34d399' : action.type === 'SELL' ? '#f87171' : '#a1a1aa'
                      }}>{action.type}</span>
                      <span style={{ color: '#fff', fontWeight: 700 }}>{action.ticker}</span>
                      <span style={{ color: '#71717a', fontSize: '13px' }}>${action.currentPrice?.toFixed(2)} · {action.shares} shares</span>
                      {action.urgent && <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(239,68,68,0.2)', color: '#f87171' }}>URGENT</span>}
                    </div>
                    <span style={{ fontSize: '11px', color: '#52525b', fontStyle: 'italic' }}>Auto-executed</span>
                  </div>
                  <p style={{ color: '#71717a', fontSize: '12px', marginTop: '6px' }}>{action.reason}</p>
                  {action.type === 'BUY' && action.cost && (
                    <p style={{ color: '#34d399', fontSize: '12px', marginTop: '2px' }}>Cost: {fmt(action.cost)}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <h1 className='text-3xl md:text-4xl font-extrabold mb-2'>
          <span style={{ background: 'linear-gradient(135deg, #60a5fa 0%, #a78bfa 50%, #f472b6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            AI Portfolio
          </span>
        </h1>
        <p className='text-zinc-500 text-sm mb-8'>$100K virtual portfolio managed by Finance Seer&apos;s AI analysis engine</p>

        {/* Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '24px' }}>
          <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '16px' }}>
            <div className='text-zinc-500 text-xs mb-1'>Total Value</div>
            <div className='text-2xl font-bold text-white'>{fmt(summary.totalValue)}</div>
          </div>
          <div style={{ background: '#111', border: isPositive ? '1px solid rgba(16,185,129,0.2)' : '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', padding: '16px' }}>
            <div className='text-zinc-500 text-xs mb-1'>Total Return</div>
            <div className={'text-2xl font-bold ' + (isPositive ? 'text-emerald-400' : 'text-red-400')}>
              {fmt(summary.totalReturn)} ({fmtPct(summary.totalReturnPct)})
            </div>
          </div>
          <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '16px' }}>
            <div className='text-zinc-500 text-xs mb-1'>Cash</div>
            <div className='text-lg font-bold text-white'>{fmt(summary.cash)}</div>
          </div>
          <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '16px' }}>
            <div className='text-zinc-500 text-xs mb-1'>Invested</div>
            <div className='text-lg font-bold text-white'>{fmt(summary.positionsValue)}</div>
          </div>
        </div>

        {/* Portfolio Value Chart */}
        <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
          <h2 className='text-lg font-bold mb-4 flex items-center gap-2'>
            <LineChart size={18} className='text-cyan-400' /> Portfolio Value
          </h2>
          <PortfolioValueChart data={valueHistory} startingCapital={data.startingCapital || 100000} />
        </div>

        {/* Capital & Limits */}
        <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
          <h2 className='text-lg font-bold mb-4 flex items-center gap-2'>
            <DollarSign size={18} className='text-yellow-400' /> Capital &amp; Limits
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
            <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '14px' }}>
              <div className='text-zinc-500 text-xs mb-1'>Capital Ceiling</div>
              <div className='text-xl font-bold text-white'>{fmt(summary.capitalCeiling)}</div>
              <div className='text-zinc-600 text-xs mt-1'>Max deployable capital</div>
            </div>
            <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '14px' }}>
              <div className='text-zinc-500 text-xs mb-1'>Days Active</div>
              <div className='text-xl font-bold text-white'>{summary.daysSinceStart}</div>
              <div className='text-zinc-600 text-xs mt-1'>Since {summary.startDate}</div>
            </div>
          </div>
          {Object.keys(cooldowns).length > 0 && (
            <div style={{ marginTop: '12px', padding: '10px 12px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '8px' }}>
              <div className='text-zinc-500 text-xs mb-1'>Settlement Cooldowns</div>
              {Object.entries(cooldowns).map(([ticker, expiry]) => (
                <div key={ticker} className='text-zinc-300 text-xs'>{ticker}: can repurchase after {expiry}</div>
              ))}
            </div>
          )}
        </div>

        {/* Performance Stats */}
        {performance && performance.totalTrades !== undefined && (
          <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
            <h2 className='text-lg font-bold mb-4 flex items-center gap-2'>
              <TrendingUp size={18} className='text-emerald-400' /> Performance Stats
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                <div className='text-zinc-500 text-xs mb-1'>Win Rate</div>
                <div className='text-xl font-bold text-white'>{performance.winRate}%</div>
              </div>
              <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                <div className='text-zinc-500 text-xs mb-1'>Total Trades</div>
                <div className='text-xl font-bold text-white'>{performance.totalTrades}</div>
              </div>
              <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                <div className='text-zinc-500 text-xs mb-1'>Profitable</div>
                <div className='text-xl font-bold text-emerald-400'>{performance.profitableTrades}</div>
              </div>
            </div>
          </div>
        )}

        {/* Current Positions */}
        <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
          <h2 className='text-lg font-bold mb-4 flex items-center gap-2'>
            <BarChart3 size={18} className='text-blue-400' /> Current Positions ({positions.length})
          </h2>
          <div className='space-y-3'>
            {positions.map((pos: Position, i: number) => {
              const pnl = (pos.currentPrice - pos.avgCost) * pos.shares
              const pnlPct = pos.avgCost > 0 ? ((pos.currentPrice - pos.avgCost) / pos.avgCost) * 100 : 0
              const posPositive = pnl >= 0
              const ti = tradeIndicators.find((t: any) => t.ticker === pos.ticker)
              return (
                <div key={i} style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '14px' }}>
                  {/* Header: Ticker + Company name + P&L */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ color: '#fff', fontWeight: 700, fontSize: '18px' }}>{pos.ticker}</span>
                      <span style={{ color: '#a1a1aa', fontSize: '13px' }}>{pos.companyName || pos.ticker}</span>
                    </div>
                    <div className='text-right'>
                      <div className='text-white font-bold'>{fmt(pos.currentPrice)}</div>
                      <div className={'text-sm font-semibold ' + (posPositive ? 'text-emerald-400' : 'text-red-400')}>
                        {posPositive ? '+' : ''}{fmt(Math.abs(pnl))} ({fmtPct(pnlPct)})
                      </div>
                    </div>
                  </div>
                  {/* Details grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '8px', marginBottom: '8px' }}>
                    <div>
                      <div className='text-zinc-600 text-xs'>Shares</div>
                      <div className='text-zinc-300 text-sm font-semibold'>{pos.shares} @ {fmt(pos.avgCost)}</div>
                    </div>
                    <div>
                      <div className='text-zinc-600 text-xs'>Bought</div>
                      <div className='text-zinc-300 text-sm'>{pos.buyDate}</div>
                    </div>
                    <div>
                      <div className='text-zinc-600 text-xs'>Signal</div>
                      <div className='text-zinc-300 text-sm'>{pos.signal}</div>
                    </div>
                    <div>
                      <div className='text-zinc-600 text-xs'>Status</div>
                      <div className='text-emerald-400 text-sm'>Can trade ({ti?.daysHeld || 0}d held)</div>
                    </div>
                  </div>
                  <div className='text-zinc-600 text-xs'>{pos.reason}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Closed Positions */}
        {closedPositions.length > 0 && (
          <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
            <h2 className='text-lg font-bold mb-4 flex items-center gap-2'>
              <TrendingDown size={18} className='text-red-400' /> Closed Positions
            </h2>
            <div className='space-y-2'>
              {closedPositions.map((cp: ClosedPosition, i: number) => (
                <div key={i} style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ color: '#fff', fontWeight: 700, fontSize: '15px' }}>{cp.ticker}</span>
                      <span style={{ color: '#a1a1aa', fontSize: '13px' }}>{cp.companyName || cp.ticker}</span>
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: cp.pnl >= 0 ? '#34d399' : '#f87171' }}>
                      {cp.pnl >= 0 ? '+' : ''}{fmt(cp.pnl)} ({fmtPct(cp.pnlPct)})
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '8px', marginBottom: '6px' }}>
                    <div>
                      <div className='text-zinc-600 text-xs'>Shares</div>
                      <div className='text-zinc-300 text-sm'>{cp.shares}</div>
                    </div>
                    <div>
                      <div className='text-zinc-600 text-xs'>Buy</div>
                      <div className='text-zinc-300 text-sm'>{fmt(cp.buyPrice)} · {cp.buyDate}</div>
                    </div>
                    <div>
                      <div className='text-zinc-600 text-xs'>Sell</div>
                      <div className='text-zinc-300 text-sm'>{fmt(cp.sellPrice)} · {cp.sellDate}</div>
                    </div>
                    <div>
                      <div className='text-zinc-600 text-xs'>Total Sold</div>
                      <div className='text-white text-sm font-semibold'>{fmt(cp.sellPrice * cp.shares)}</div>
                    </div>
                  </div>
                  <div className='text-zinc-600 text-xs'>{cp.reason}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trade History */}
        <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
          <h2 className='text-lg font-bold mb-4 flex items-center gap-2'>
            <Clock size={18} className='text-purple-400' /> Trade History
          </h2>
          <div className='space-y-3'>
            {history.slice().reverse().map((trade: Trade, i: number) => {
              const isSell = trade.action === 'SELL'
              return (
                <div key={i} style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '10px', padding: '14px' }}>
                  {/* Row 1: Badge + Company name + Symbol */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px',
                        background: trade.action === 'BUY' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                        color: trade.action === 'BUY' ? '#34d399' : '#f87171',
                        letterSpacing: '0.5px'
                      }}>
                        {trade.action}
                      </span>
                      <span style={{ color: '#fff', fontWeight: 700, fontSize: '15px' }}>{trade.companyName || trade.ticker}</span>
                      <span style={{ color: '#71717a', fontSize: '13px' }}>({trade.ticker})</span>
                    </div>
                    {isSell && trade.pnl !== undefined && (
                      <span style={{ fontSize: '13px', fontWeight: 700, color: trade.pnl >= 0 ? '#34d399' : '#f87171' }}>
                        {trade.pnl >= 0 ? '+' : ''}{fmt(trade.pnl)} ({fmtPct(trade.pnlPct || 0)})
                      </span>
                    )}
                  </div>
                  {/* Row 2: Details grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: isSell ? 'repeat(3, 1fr)' : 'repeat(3, 1fr)', gap: '10px', marginBottom: '8px' }}>
                    <div>
                      <div style={{ color: '#52525b', fontSize: '11px', marginBottom: '2px' }}>Quantity</div>
                      <div style={{ color: '#d4d4d8', fontSize: '13px', fontWeight: 600 }}>{trade.shares} shares</div>
                    </div>
                    <div>
                      <div style={{ color: '#52525b', fontSize: '11px', marginBottom: '2px' }}>{isSell ? 'Buy Price' : 'Price'}</div>
                      <div style={{ color: '#d4d4d8', fontSize: '13px', fontWeight: 600 }}>{isSell && trade.buyPrice ? fmt(trade.buyPrice) : fmt(trade.price)}</div>
                    </div>
                    <div>
                      <div style={{ color: '#52525b', fontSize: '11px', marginBottom: '2px' }}>{isSell ? 'Sell Price' : 'Total'}</div>
                      <div style={{ color: isSell ? '#d4d4d8' : '#fff', fontSize: '13px', fontWeight: isSell ? 600 : 700 }}>{isSell ? fmt(trade.price) : fmt(trade.total)}</div>
                    </div>
                    <div>
                      <div style={{ color: '#52525b', fontSize: '11px', marginBottom: '2px' }}>{isSell ? 'Buy Date' : 'Date'}</div>
                      <div style={{ color: '#d4d4d8', fontSize: '13px' }}>{isSell ? (trade.buyDate || '—') : trade.date}</div>
                    </div>
                    <div>
                      <div style={{ color: '#52525b', fontSize: '11px', marginBottom: '2px' }}>{isSell ? 'Sell Date' : ''}</div>
                      <div style={{ color: '#d4d4d8', fontSize: '13px' }}>{isSell ? trade.date : ''}</div>
                    </div>
                    <div>
                      <div style={{ color: '#52525b', fontSize: '11px', marginBottom: '2px' }}>Total</div>
                      <div style={{ color: '#fff', fontSize: '13px', fontWeight: 700 }}>{fmt(trade.total)}</div>
                    </div>
                  </div>
                  {/* Row 3: Reason */}
                  <div style={{ color: '#52525b', fontSize: '11px' }}>{trade.reason}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Strategy Notes */}
        <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
          <h2 className='text-lg font-bold mb-4 flex items-center gap-2'>
            <FileText size={18} className='text-yellow-400' /> Strategy Notes
          </h2>
          <div className='space-y-3'>
            {strategyNotes.slice().reverse().map((note: StrategyNote, i: number) => (
              <div key={i} style={{ padding: '12px', background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px' }}>
                <div className='text-zinc-500 text-xs mb-1'>{note.date}</div>
                <p className='text-zinc-300 text-sm leading-relaxed'>{note.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly Reviews */}
        {monthlyReviews.length > 0 && (
          <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
            <h2 className='text-lg font-bold mb-4 flex items-center gap-2'>
              <Calendar size={18} className='text-cyan-400' /> Monthly Reviews
            </h2>
            <div className='space-y-3'>
              {monthlyReviews.slice().reverse().map((review: MonthlyReview, i: number) => (
                <div key={i} style={{ padding: '12px', background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px' }}>
                  <div className='flex items-center justify-between mb-2'>
                    <span className='text-zinc-500 text-xs'>{review.date}</span>
                    <span className={'text-sm font-bold ' + (review.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {fmt(review.totalValue)} ({fmtPct(review.returnPct)})
                    </span>
                  </div>
                  <p className='text-zinc-300 text-sm leading-relaxed'>{review.review}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '12px 16px' }}>
          <p className='text-zinc-600 text-xs leading-relaxed'>
            This is a simulated portfolio for educational purposes. No real money is invested. Past performance does not indicate future results.
            Trading decisions are made by Finance Seer&apos;s algorithmic analysis engine. Not financial advice.
          </p>
        </div>
      </div>
    </div>
  )
}
