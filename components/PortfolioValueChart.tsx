'use client'

import { useEffect, useRef } from 'react'
import { createChart, ColorType, LineStyle } from 'lightweight-charts'

interface ValuePoint {
  date: string
  value: number
}

interface PortfolioValueChartProps {
  data: ValuePoint[]
  startingCapital: number
}

export default function PortfolioValueChart({ data, startingCapital }: PortfolioValueChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartRef.current || !data || data.length === 0) return

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

    const chartData = data.map(d => ({
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

    chart.timeScale().fitContent()

    const handleResize = () => {
      if (chartRef.current) {
        chart.applyOptions({ width: chartRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [data, startingCapital])

  if (!data || data.length === 0) {
    return (
      <div style={{ background: '#0a0a0a', borderRadius: '10px', padding: '40px', textAlign: 'center' }}>
        <p className='text-zinc-600 text-sm'>No value history yet. Chart will appear after the first month.</p>
      </div>
    )
  }

  // Calculate stats
  const latest = data[data.length - 1]
  const returnAmt = latest.value - startingCapital
  const returnPct = (returnAmt / startingCapital) * 100
  const high = Math.max(...data.map(d => d.value))
  const low = Math.min(...data.map(d => d.value))

  return (
    <div>
      {/* Mini stats row */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div className='text-xs text-zinc-500'>
          Current: <span className='text-white font-semibold'>${latest.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
        <div className='text-xs text-zinc-500'>
          Return: <span className={(returnAmt >= 0 ? 'text-emerald-400' : 'text-red-400') + ' font-semibold'}>
            {returnAmt >= 0 ? '+' : ''}${Math.abs(returnAmt).toLocaleString(undefined, { maximumFractionDigits: 0 })} ({returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%)
          </span>
        </div>
        <div className='text-xs text-zinc-500'>
          High: <span className='text-zinc-300'>${high.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
        <div className='text-xs text-zinc-500'>
          Low: <span className='text-zinc-300'>${low.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
      </div>

      {/* Chart */}
      <div ref={chartRef} style={{ borderRadius: '10px', overflow: 'hidden' }} />
    </div>
  )
}
