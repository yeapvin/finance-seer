'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Loader, Zap, AlertTriangle, Briefcase, TrendingUp, TrendingDown } from 'lucide-react'
import { StockChart } from '@/components/StockChart'
import { AnalysisReport } from '@/components/AnalysisReport'

interface SearchResult { ticker: string; name: string; exchange: string }

const PERIODS = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y'] as const
type Period = typeof PERIODS[number]

interface PeriodData {
  history: any[]
  indicators: any
  patterns: any[]
}

function formatNum(n: number): string {
  if (!n || isNaN(n)) return '—'
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K'
  return n.toFixed(2)
}

export default function Home() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const searchBoxRef = useRef<HTMLDivElement>(null)
  const [portfolio, setPortfolio] = useState<any>(null)
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [stock, setStock] = useState<any>(null)
  const [period, setPeriod] = useState<Period>('1mo')
  const [stockLoading, setStockLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<any>(null)
  const periodCache = useRef<Record<string, Partial<Record<Period, PeriodData>>>>({})
  const [currentData, setCurrentData] = useState<PeriodData | null>(null)
  const [loadingPeriods, setLoadingPeriods] = useState<Set<Period>>(new Set())
  const [showIndicators, setShowIndicators] = useState({
    sma20: true, sma50: true, sma200: true, ema12: true, ema26: true,
    rsi: true, macd: true, bollingerBands: true, stochastic: true, volume: true,
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    fetch('/api/portfolio').then(r => r.ok ? r.json() : null).then(d => { if (d?.summary) setPortfolio(d.summary) }).catch(() => {})
  }, [])

  const searchTimer = useRef<any>(null)
  const searchStocks = useCallback((v: string) => {
    setQuery(v)
    if (v.length < 1) { setResults([]); setOpen(false); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(v)}`)
        if (r.ok) {
          const raw = await r.json()
          const results: SearchResult[] = (Array.isArray(raw) ? raw : raw.results || [])
            .filter((s: any) => { const sym: string = (s.symbol || s.ticker || ''); return !sym.includes('.') || sym.endsWith('.SI') })
            .map((s: any) => ({ ticker: s.symbol || s.ticker, name: s.description || s.name || s.symbol, exchange: s.type || '' }))
            .slice(0, 8)
          setResults(results)
          setOpen(results.length > 0)
        }
      } catch {} finally { setSearchLoading(false) }
    }, 200)
  }, [])

  const selectStock = (ticker: string) => {
    setQuery(''); setResults([]); setOpen(false)
    setSelectedTicker(ticker.toUpperCase())
    setAnalysis(null); setPeriod('1mo'); setCurrentData(null)
  }

  const fetchPeriod = async (ticker: string, p: Period): Promise<PeriodData | null> => {
    try {
      const res = await fetch(`/api/stock/${ticker}/history?period=${p}`)
      if (!res.ok) return null
      const d = await res.json()
      const data: PeriodData = { history: d.history || [], indicators: d.indicators || null, patterns: d.patterns || [] }
      if (!periodCache.current[ticker]) periodCache.current[ticker] = {}
      periodCache.current[ticker][p] = data
      return data
    } catch { return null }
  }

  useEffect(() => {
    if (!selectedTicker) return
    let cancelled = false
    const load = async () => {
      setStockLoading(true)
      periodCache.current[selectedTicker] = {}
      const [sRes, defaultData] = await Promise.all([
        fetch(`/api/stock/${selectedTicker}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetchPeriod(selectedTicker, '1mo'),
      ])
      if (cancelled) return
      if (sRes) setStock(sRes)
      if (defaultData) setCurrentData(defaultData)
      setStockLoading(false)
      setAnalyzing(true)
      fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: selectedTicker }) })
        .then(r => r.ok ? r.json() : null).then(data => { if (!cancelled && data) setAnalysis(data) })
        .catch(() => {}).finally(() => { if (!cancelled) setAnalyzing(false) })
      const remaining = PERIODS.filter(p => p !== '1mo')
      setLoadingPeriods(new Set(remaining))
      await Promise.all(remaining.map(async (p) => {
        await fetchPeriod(selectedTicker, p)
        if (!cancelled) setLoadingPeriods(prev => { const next = new Set(prev); next.delete(p); return next })
      }))
    }
    load()
    return () => { cancelled = true }
  }, [selectedTicker])

  useEffect(() => {
    if (!selectedTicker) return
    const cached = periodCache.current[selectedTicker]?.[period]
    if (cached) { setCurrentData(cached); return }
    let cancelled = false
    fetchPeriod(selectedTicker, period).then(data => { if (!cancelled && data) setCurrentData(data) })
    return () => { cancelled = true }
  }, [selectedTicker, period])

  const isPositive = stock ? stock.change >= 0 : true
  const isPeriodLoading = loadingPeriods.has(period) && !currentData

  return (
    <div className='min-h-screen bg-black'>
      {/* ── Top Nav ── */}
      <header style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 24px', height: '56px', display: 'flex', alignItems: 'center', position: 'sticky', top: 0, background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(12px)', zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Zap size={20} style={{ color: '#facc15' }} />
          <span style={{ fontSize: '22px', fontWeight: 900, letterSpacing: '-0.5px', background: 'linear-gradient(135deg, #60a5fa 0%, #a78bfa 50%, #f472b6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Finance Seer</span>
        </div>
      </header>

      {/* ── Main Two-Column Layout ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minHeight: 'calc(100vh - 56px)', maxWidth: '1600px', margin: '0 auto' }} className='main-grid'>

        {/* ── LEFT COLUMN: Search + Portfolio ── */}
        <aside className='left-panel' style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>

          {/* Portfolio Summary */}
          {portfolio && (
            <a href='/portfolio' style={{ textDecoration: 'none' }}>
              <div style={{ background: 'linear-gradient(135deg, #0f0f2e, #1a1040)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '12px', padding: '16px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Briefcase size={14} style={{ color: '#818cf8' }} />
                    <span style={{ color: '#c7d2fe', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>AI Portfolio</span>
                  </div>
                  <span style={{ color: '#6366f1', fontSize: '11px' }}>View →</span>
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ color: 'white', fontSize: '22px', fontWeight: 800 }}>${portfolio.totalValue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span style={{ marginLeft: '8px', color: portfolio.totalReturn >= 0 ? '#4ade80' : '#fb7185', fontWeight: 700, fontSize: '14px' }}>
                    {portfolio.totalReturn >= 0 ? '▲' : '▼'} {Math.abs(portfolio.totalReturnPct || 0).toFixed(2)}%
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#6366f1', marginBottom: '12px' }}>
                  <span>Cash: ${((portfolio.cash || 0) / 1000).toFixed(1)}K</span>
                  <span>Since {portfolio.startDate}</span>
                </div>
                {/* Position list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {portfolio.tickers?.map((t: any) => {
                    const pct = t.pctChange || 0
                    return (
                      <div key={t.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '6px 10px' }}>
                        <span style={{ color: '#e0e7ff', fontWeight: 600, fontSize: '13px' }}>{t.ticker}</span>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ color: pct > 0 ? '#4ade80' : pct < 0 ? '#fb7185' : '#a5b4fc', fontWeight: 600, fontSize: '12px' }}>
                            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </a>
          )}

          {/* Search */}
          <div ref={searchBoxRef} style={{ position: 'relative' }}>
            <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', display: 'flex', alignItems: 'center', padding: '10px 14px', gap: '10px' }}>
              <Search size={16} style={{ color: '#52525b', flexShrink: 0 }} />
              <input
                type='text' value={query}
                onChange={e => searchStocks(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && query.trim()) selectStock(query.trim()) }}
                onFocus={() => results.length > 0 && setOpen(true)}
                placeholder='Search ticker or company name...'
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'white', fontSize: '14px' }}
              />
              {searchLoading && <Loader size={14} className='animate-spin' style={{ color: '#3b82f6', flexShrink: 0 }} />}
            </div>
            {open && results.length > 0 && (
              <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', zIndex: 50, overflow: 'hidden' }}>
                {results.map((s, i) => (
                  <div key={i} onClick={() => selectStock(s.ticker)}
                    style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    className='hover:bg-white/5'>
                    <div>
                      <span style={{ color: 'white', fontWeight: 600, fontSize: '14px' }}>{s.ticker}</span>
                      <span style={{ color: '#71717a', fontSize: '12px', marginLeft: '8px' }}>{s.name}</span>
                    </div>
                    <span style={{ color: '#3b82f6', fontSize: '11px' }}>{s.exchange}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Empty state */}
          {!selectedTicker && !portfolio && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#3f3f46' }}>
              <TrendingUp size={32} style={{ margin: '0 auto 12px' }} />
              <p style={{ fontSize: '13px' }}>Search for a stock to get started</p>
            </div>
          )}

          {/* Quick stock info when selected */}
          {stock && !stockLoading && (
            <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '16px' }}>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ color: 'white', fontWeight: 800, fontSize: '20px' }}>{stock.ticker}</span>
                    <span style={{ color: '#52525b', fontSize: '12px', marginLeft: '8px' }}>{stock.exchange}</span>
                  </div>
                  <span style={{ color: isPositive ? '#4ade80' : '#f87171', fontWeight: 700, fontSize: '15px' }}>
                    {isPositive ? '▲' : '▼'} {Math.abs(stock.changePercent || 0).toFixed(2)}%
                  </span>
                </div>
                <p style={{ color: '#71717a', fontSize: '12px', marginTop: '2px' }}>{stock.name}</p>
                <p style={{ color: 'white', fontSize: '26px', fontWeight: 800, marginTop: '6px' }}>${stock.price?.toFixed(2)}</p>
              </div>
              <div className='metrics-grid'>
                {[
                  { label: 'Open', value: stock.open ? '$' + stock.open.toFixed(2) : '—' },
                  { label: 'Prev Close', value: stock.previousClose ? '$' + stock.previousClose.toFixed(2) : '—' },
                  { label: 'Day High', value: stock.dayHigh ? '$' + stock.dayHigh.toFixed(2) : '—', color: '#4ade80' },
                  { label: 'Day Low', value: stock.dayLow ? '$' + stock.dayLow.toFixed(2) : '—', color: '#f87171' },
                  { label: '52W High', value: stock.week52High ? '$' + stock.week52High.toFixed(2) : '—', color: '#4ade80' },
                  { label: '52W Low', value: stock.week52Low ? '$' + stock.week52Low.toFixed(2) : '—', color: '#f87171' },
                  { label: 'Volume', value: formatNum(stock.volume) },
                  { label: 'Mkt Cap', value: stock.marketCap ? '$' + formatNum(stock.marketCap) : '—' },
                  { label: 'P/E', value: stock.peRatio ? stock.peRatio.toFixed(2) : '—' },
                  { label: 'Div Yield', value: stock.dividendYield ? (stock.dividendYield * 100).toFixed(2) + '%' : '—' },
                ].map((m, i) => (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '7px 10px' }}>
                    <div style={{ color: '#52525b', fontSize: '10px', marginBottom: '2px' }}>{m.label}</div>
                    <div style={{ color: (m as any).color || 'white', fontWeight: 600, fontSize: '13px' }}>{m.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ── RIGHT COLUMN: Chart + Analysis ── */}
        <main className='right-panel' style={{ display: 'flex', flexDirection: 'column', gap: '20px', background: '#050505', minHeight: '400px' }}>
          {!selectedTicker ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', color: '#27272a', gap: '16px', padding: '40px' }}>
              <Zap size={48} style={{ opacity: 0.3 }} />
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '16px', color: '#3f3f46', marginBottom: '6px' }}>Select a stock to get started</p>
                <p style={{ fontSize: '12px', color: '#27272a' }}>Search by ticker symbol or company name</p>
              </div>
            </div>
          ) : stockLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px' }}>
              <Loader className='animate-spin' size={32} style={{ color: '#3b82f6' }} />
              <span style={{ color: '#52525b' }}>Loading {selectedTicker}...</span>
            </div>
          ) : (
            <>
              {/* Period Selector + Indicator Toggles + Chart — all in one card */}
              <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '20px' }}>
                {/* Row 1: Period buttons */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <h3 style={{ color: 'white', fontWeight: 700, fontSize: '15px' }}>Price Chart</h3>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {PERIODS.map(p => {
                      const cached = !!periodCache.current[selectedTicker]?.[p]
                      const loading = loadingPeriods.has(p)
                      return (
                        <button key={p} onClick={() => setPeriod(p)}
                          style={{
                            padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none',
                            background: period === p ? 'linear-gradient(135deg,#2563eb,#7c3aed)' : 'rgba(255,255,255,0.06)',
                            color: period === p ? 'white' : '#71717a',
                            opacity: !cached && loading ? 0.5 : 1
                          }}>
                          {p.toUpperCase()}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Row 2: Overlay indicators (on price chart) */}
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ color: '#3f3f46', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '5px' }}>Overlays</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {([
                      { key: 'sma20', label: 'SMA 20', color: '#f59e0b' },
                      { key: 'sma50', label: 'SMA 50', color: '#8b5cf6' },
                      { key: 'sma200', label: 'SMA 200', color: '#ec4899' },
                      { key: 'ema12', label: 'EMA 12', color: '#06b6d4' },
                      { key: 'ema26', label: 'EMA 26', color: '#14b8a6' },
                      { key: 'bollingerBands', label: 'Bollinger', color: '#6366f1' },
                    ] as { key: keyof typeof showIndicators; label: string; color: string }[]).map(({ key, label, color }) => {
                      const active = showIndicators[key]
                      return (
                        <button key={key} onClick={() => setShowIndicators(prev => ({ ...prev, [key]: !prev[key] }))}
                          style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                            border: `1px solid ${active ? color : 'rgba(255,255,255,0.1)'}`,
                            background: active ? `${color}22` : 'transparent',
                            color: active ? color : '#52525b', transition: 'all 0.15s' }}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Subchart indicators (below price chart) */}
                <div style={{ paddingBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '16px' }}>
                  <div style={{ color: '#3f3f46', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '5px' }}>Subcharts</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {([
                      { key: 'volume', label: 'Volume', color: '#3b82f6' },
                      { key: 'rsi', label: 'RSI', color: '#f97316' },
                      { key: 'macd', label: 'MACD', color: '#a78bfa' },
                      { key: 'stochastic', label: 'Stoch', color: '#34d399' },
                    ] as { key: keyof typeof showIndicators; label: string; color: string }[]).map(({ key, label, color }) => {
                      const active = showIndicators[key]
                      return (
                        <button key={key} onClick={() => setShowIndicators(prev => ({ ...prev, [key]: !prev[key] }))}
                          style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                            border: `1px solid ${active ? color : 'rgba(255,255,255,0.1)'}`,
                            background: active ? `${color}22` : 'transparent',
                            color: active ? color : '#52525b', transition: 'all 0.15s' }}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Chart */}
                {isPeriodLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', gap: '10px' }}>
                    <Loader className='animate-spin' size={20} style={{ color: '#3b82f6' }} />
                    <span style={{ color: '#52525b', fontSize: '13px' }}>Loading {period.toUpperCase()}...</span>
                  </div>
                ) : currentData?.history.length && currentData.indicators ? (
                  <StockChart data={currentData.history} indicators={currentData.indicators} showIndicators={showIndicators} />
                ) : null}
              </div>

              {/* Analysis Report */}
              <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '24px' }}>
                {analyzing ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#52525b' }}>
                    <Loader className='animate-spin' size={16} style={{ color: '#3b82f6' }} />
                    <span style={{ fontSize: '14px' }}>Generating analysis...</span>
                  </div>
                ) : analysis ? (
                  <AnalysisReport report={analysis} />
                ) : null}
              </div>

              {/* Detected Patterns — full width, two columns */}
              {currentData && currentData.patterns.length > 0 && (
                <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <span style={{ color: '#6366f1' }}>⬡</span>
                    <h3 style={{ color: 'white', fontWeight: 800, fontSize: '15px', margin: 0 }}>Detected Patterns</h3>
                    <span style={{ color: '#3f3f46', fontSize: '11px' }}>1-year window · {currentData.patterns.length} pattern{currentData.patterns.length !== 1 ? 's' : ''} found</span>
                  </div>
                  <div className='patterns-grid'>
                    {currentData.patterns.map((pattern: any, i: number) => (
                      <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${pattern.type === 'bullish' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: '10px', padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                            {pattern.type === 'bullish'
                              ? <TrendingUp size={14} style={{ color: '#34d399' }} />
                              : <TrendingDown size={14} style={{ color: '#f87171' }} />}
                            <span style={{ color: 'white', fontWeight: 600, fontSize: '13px' }}>{pattern.name}</span>
                          </div>
                          <span style={{ color: pattern.confidence >= 75 ? '#34d399' : pattern.confidence >= 50 ? '#fbbf24' : '#71717a', fontSize: '11px', fontWeight: 700 }}>{pattern.confidence?.toFixed(0)}%</span>
                        </div>
                        {/* Confidence bar */}
                        <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginBottom: '6px' }}>
                          <div style={{ height: '100%', borderRadius: '2px', width: `${Math.min(pattern.confidence, 100)}%`, background: pattern.confidence >= 75 ? '#34d399' : pattern.confidence >= 50 ? '#fbbf24' : '#52525b' }} />
                        </div>
                        <p style={{ color: '#71717a', fontSize: '11px', margin: 0 }}>{pattern.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
