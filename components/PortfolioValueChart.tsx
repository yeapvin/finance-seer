'use client'

import { useEffect, useRef, useState } from 'react'
import { createChart, ColorType, LineStyle } from 'lightweight-charts'

interface ValuePoint {
  date: string
  value: number
}

interface PortfolioValueChartProps {
  data: ValuePoint[]
  startingCapital: number
}

const RANGES = [
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
  { label: 'All', days: Infinity },
] as const

export default function PortfolioValueChart({ data, startingCapital }: PortfolioValueChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ date: string; value: number; dayChange: number; dayChangePct: number; x: number; y: number } | null>(null)
  const [range, setRange] = useState<typeof RANGES[number]>(RANGES[3]) // default 6M

  // Filter data by selected range, always keeping the first entry (starting day)
  const filteredData = (() => {
    if (range.days === Infinity || data.length === 0) return data
    const cutoff = new Date(Date.now() - range.days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const filtered = data.filter(d => d.date >= cutoff)
    // Always include the very first data point (starting day)
    if (data[0] && (!filtered.length || filtered[0].date !== data[0].date)) {
      return [data[0], ...filtered]
    }
    return filtered
  })()

  useEffect(() => {
    if (!chartRef.current || !filteredData || filteredData.length === 0) return

    const chart = createChart(chartRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0a' },
        textColor: '#71717a',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.03)' },
        horzLines: { color: 'rgba(255,255,255,0.03)' },
      },
      width: chartRef.current.clientWidth,
      height: 280,
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.06)',
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        timeVisible: false,
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.1)', labelBackgroundColor: '#1a1a1a' },
        horzLine: { color: 'rgba(255,255,255,0.1)', labelBackgroundColor: '#1a1a1a' },
      },
    })

    // Baseline series — green above starting capital, red below
    const baselineSeries = chart.addBaselineSeries({
      baseValue: { type: 'price', price: startingCapital },
      topLineColor: '#10b981',
      topFillColor1: 'rgba(16,185,129,0.15)',
      topFillColor2: 'rgba(16,185,129,0.02)',
      bottomLineColor: '#ef4444',
      bottomFillColor1: 'rgba(239,68,68,0.02)',
      bottomFillColor2: 'rgba(239,68,68,0.15)',
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => '$' + price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
      },
    })

    const chartData = filteredData.map(d => ({
      time: d.date as any,
      value: d.value,
    }))

    baselineSeries.setData(chartData)

    // Starting capital reference line
    baselineSeries.createPriceLine({
      price: startingCapital,
      color: 'rgba(255,255,255,0.15)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Start',
    })

    // Crosshair tooltip
    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !chartRef.current) {
        setTooltip(null)
        return
      }
      const seriesData = param.seriesData.get(baselineSeries) as any
      if (!seriesData) { setTooltip(null); return }

      const hoveredDate = String(param.time)
      const hoveredValue = seriesData.value as number
      const idx = filteredData.findIndex(d => d.date === hoveredDate)
      const prevValue = idx > 0 ? filteredData[idx - 1].value : startingCapital
      const dayChange = hoveredValue - prevValue
      const dayChangePct = prevValue > 0 ? (dayChange / prevValue) * 100 : 0

      const rect = chartRef.current.getBoundingClientRect()
      setTooltip({
        date: hoveredDate,
        value: hoveredValue,
        dayChange,
        dayChangePct,
        x: param.point.x,
        y: param.point.y,
      })
    })

    chart.timeScale().fitContent()

    // Prevent chart from hijacking page scroll on touch devices
    const el = chartRef.current
    const preventTouch = (e: TouchEvent) => {
      if (e.touches.length === 1) e.stopPropagation()
    }
    el.addEventListener('touchmove', preventTouch, { passive: true })

    // Clear tooltip when mouse leaves chart
    const onMouseLeave = () => setTooltip(null)
    el.addEventListener('mouseleave', onMouseLeave)

    // Prevent wheel scroll hijack
    const preventWheel = (e: WheelEvent) => { e.stopPropagation() }
    el.addEventListener('wheel', preventWheel, { passive: true })

    const handleResize = () => {
      if (chartRef.current) {
        chart.applyOptions({ width: chartRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      el.removeEventListener('touchmove', preventTouch)
      el.removeEventListener('mouseleave', onMouseLeave)
      el.removeEventListener('wheel', preventWheel)
      chart.remove()
    }
  }, [filteredData, startingCapital])

  if (!data || data.length === 0) {
    return (
      <div style={{ background: '#0a0a0a', borderRadius: '10px', padding: '40px', textAlign: 'center' }}>
        <p className='text-zinc-600 text-sm'>No value history yet. Chart will appear after the first month.</p>
      </div>
    )
  }

  // Calculate stats from filtered data
  const latest = filteredData[filteredData.length - 1]
  const returnAmt = latest.value - startingCapital
  const returnPct = (returnAmt / startingCapital) * 100
  const high = Math.max(...filteredData.map(d => d.value))
  const low = Math.min(...filteredData.map(d => d.value))

  return (
    <div>
      {/* Range toggle */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
        {RANGES.map(r => (
          <button key={r.label} onClick={() => setRange(r)}
            style={{
              padding: '3px 9px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
              cursor: 'pointer', border: 'none',
              background: range.label === r.label ? 'linear-gradient(135deg,#2563eb,#7c3aed)' : 'rgba(255,255,255,0.06)',
              color: range.label === r.label ? 'white' : '#71717a',
            }}>
            {r.label}
          </button>
        ))}
      </div>

      {/* Mini stats row */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap', fontSize: '12px', color: '#a1a1aa' }}>
        <div>
          Current: <span style={{ color: 'white', fontWeight: 600 }}>${latest.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
        <div>
          Return: <span style={{ color: returnAmt >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>
            {returnAmt >= 0 ? '+' : ''}${Math.abs(returnAmt).toLocaleString(undefined, { maximumFractionDigits: 0 })} ({returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%)
          </span>
        </div>
        <div>
          High: <span style={{ color: 'white', fontWeight: 600 }}>${high.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
        <div>
          Low: <span style={{ color: 'white', fontWeight: 600 }}>${low.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
      </div>

      {/* Chart */}
      <div style={{ position: 'relative' }}>
        <div ref={chartRef} style={{ borderRadius: '10px', overflow: 'hidden', touchAction: 'pan-x' }} />
        {tooltip && (
          <div style={{
            position: 'absolute',
            left: Math.min(tooltip.x + 12, (chartRef.current?.clientWidth || 300) - 160),
            top: Math.max(tooltip.y - 60, 4),
            background: 'rgba(15,15,30,0.95)',
            border: `1px solid ${tooltip.dayChange >= 0 ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
            borderRadius: '8px',
            padding: '8px 12px',
            pointerEvents: 'none',
            zIndex: 10,
            minWidth: '150px',
          }}>
            <div style={{ color: '#a5b4fc', fontSize: '11px', marginBottom: '4px' }}>{tooltip.date}</div>
            <div style={{ color: 'white', fontWeight: 700, fontSize: '14px' }}>
              ${tooltip.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ color: tooltip.dayChange >= 0 ? '#34d399' : '#f87171', fontSize: '12px', fontWeight: 600, marginTop: '2px' }}>
              {tooltip.dayChange >= 0 ? '+' : ''}{tooltip.dayChange.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({tooltip.dayChange >= 0 ? '+' : ''}{tooltip.dayChangePct.toFixed(2)}%)
            </div>
            <div style={{ color: '#52525b', fontSize: '10px', marginTop: '2px' }}>vs prev day</div>
          </div>
        )}
      </div>
    </div>
  )
}
