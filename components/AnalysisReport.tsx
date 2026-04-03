'use client'

import { AnalysisReport } from '@/lib/analysis'
import { TrendingUp, TrendingDown, Download, BarChart3, AlertTriangle, FileText, Zap, Target, Shield, DollarSign, BarChart2 } from 'lucide-react'
import jsPDF from 'jspdf'

export function AnalysisReportComponent({ report }: { report: AnalysisReport }) {
  const isPositiveSentiment = report.recommendation === 'BUY'
  const isSellSentiment = report.recommendation === 'SELL'

  const getRecommendationColor = () => {
    if (isPositiveSentiment) return 'from-green-600 to-green-700'
    if (isSellSentiment) return 'from-red-600 to-red-700'
    return 'from-yellow-600 to-yellow-700'
  }

  const getRecommendationBg = () => {
    if (isPositiveSentiment) return 'bg-green-500/10 border-green-500/30'
    if (isSellSentiment) return 'bg-red-500/10 border-red-500/30'
    return 'bg-yellow-500/10 border-yellow-500/30'
  }

  const downloadPDF = () => {
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 20
    const maxWidth = pageWidth - margin * 2
    let y = 20
    let currentPage = 1

    // Track all content per page so we can render bg first, then content
    const pages: Array<Array<() => void>> = [[]]

    const ensureSpace = (needed: number) => {
      if (y + needed > pageHeight - 20) {
        doc.addPage()
        currentPage++
        pages.push([])
        y = 20
      }
    }

    const addText = (text: string, size: number, style: 'normal' | 'bold' = 'normal', color: [number, number, number] = [200, 200, 210]) => {
      doc.setFontSize(size)
      doc.setFont('helvetica', style)
      doc.setTextColor(color[0], color[1], color[2])
      const cleaned = text.replace(/\*\*/g, '')
      const lines = doc.splitTextToSize(cleaned, maxWidth)
      for (const line of lines) {
        ensureSpace(size * 0.55)
        doc.text(line, margin, y)
        y += size * 0.5
      }
      y += 2
    }

    const addSection = (title: string, body: string) => {
      y += 6
      ensureSpace(20)
      addText(title, 13, 'bold', [100, 160, 255])
      y += 1
      addText(body, 9, 'normal', [190, 190, 200])
      y += 2
    }

    // ── Page backgrounds ──
    const addBgToAllPages = () => {
      const total = doc.getNumberOfPages()
      for (let i = 1; i <= total; i++) {
        doc.setPage(i)
        doc.setFillColor(15, 15, 20)
        doc.rect(0, 0, pageWidth, pageHeight, 'F')
      }
    }

    // Render content to measure pages first
    // We'll render twice: once to generate pages, then add bg underneath

    // ── Content ──
    addText('FINANCE ORACLE', 24, 'bold', [100, 160, 255])
    addText(`Analysis Report — ${report.ticker}`, 12, 'normal', [140, 140, 150])
    addText(new Date(report.timestamp).toLocaleString(), 8, 'normal', [100, 100, 110])
    y += 8

    const recColor: [number, number, number] = isPositiveSentiment ? [16, 185, 129] : isSellSentiment ? [239, 68, 68] : [245, 158, 11]
    addText(`Recommendation: ${report.recommendation}`, 20, 'bold', recColor)
    y += 2
    addText(report.recommendationReason, 9, 'normal', [190, 190, 200])
    y += 4

    addSection('Executive Summary', report.executiveSummary)
    addSection('Technical Analysis', report.technicalAnalysis)
    addSection('Fundamental Analysis', report.fundamentalAnalysis)
    addSection('Volume Analysis', report.volumeAnalysis || 'N/A')
    addSection('News & Sentiment', report.newsAnalysis || 'N/A')
    addSection('Risk Assessment', report.riskAssessment)

    // Price Targets
    y += 6
    ensureSpace(20)
    addText('Price Targets', 13, 'bold', [100, 160, 255])
    y += 2
    if (report.priceTargets.support.length > 0)
      addText('Support: ' + report.priceTargets.support.map(p => '$' + p.toFixed(2)).join(', '), 10, 'bold', [16, 185, 129])
    if (report.priceTargets.resistance.length > 0)
      addText('Resistance: ' + report.priceTargets.resistance.map(p => '$' + p.toFixed(2)).join(', '), 10, 'bold', [239, 68, 68])

    addSection('Entry Strategy', report.tradingStrategy.entryPoint)
    addSection('Stop Loss', report.tradingStrategy.stopLoss)
    addSection('Take Profit', report.tradingStrategy.takeProfit)

    // Now add backgrounds and footers
    const totalPages = doc.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)
      // Footer
      doc.setFontSize(7)
      doc.setTextColor(70, 70, 80)
      doc.text('Finance Oracle — For informational purposes only. Not financial advice.', margin, pageHeight - 10)
      doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin - 20, pageHeight - 10)
    }

    doc.save(`${report.ticker}_analysis.pdf`)
  }

  // Render markdown-like bold in analysis text
  const renderText = (text: string) => {
    if (!text) return null
    const parts = text.split(/(\*\*.*?\*\*|\n\n|\n)/g)
    return parts.map((part, i) => {
      if (part === '\n\n') return <br key={i} />
      if (part === '\n') return <br key={i} />
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className='text-white font-semibold'>{part.slice(2, -2)}</strong>
      }
      return <span key={i}>{part}</span>
    })
  }

  return (
    <div className='space-y-4'>
      {/* Header + Download */}
      <div className='card-glass p-6'>
        <div className='flex items-center justify-between'>
          <h2 className='text-2xl font-bold'>Analysis Report</h2>
          <button onClick={downloadPDF} className='btn-primary flex items-center gap-2 text-sm'>
            <Download size={16} /> Download PDF
          </button>
        </div>
      </div>

      {/* Recommendation */}
      <div className={`bg-gradient-to-r ${getRecommendationColor()} p-0.5 rounded-xl`}>
        <div className={`${getRecommendationBg()} border rounded-xl p-5`}>
          <p className='text-zinc-500 text-xs font-medium tracking-widest mb-2'>RECOMMENDATION</p>
          <h3 className='text-3xl font-extrabold text-gradient'>{report.recommendation}</h3>
          <p className='text-zinc-300 text-sm mt-3 leading-relaxed'>{renderText(report.recommendationReason)}</p>
        </div>
      </div>

      {/* Executive Summary */}
      <div className='card-glass p-5'>
        <div className='flex items-center gap-2 mb-3'>
          <FileText size={18} className='text-blue-400' />
          <h4 className='font-semibold'>Executive Summary</h4>
        </div>
        <p className='text-zinc-300 text-sm leading-relaxed'>{renderText(report.executiveSummary)}</p>
      </div>

      {/* Technical + Fundamental side by side on desktop, stacked on mobile */}
      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
        <div className='card-glass p-5'>
          <div className='flex items-center gap-2 mb-3'>
            <BarChart3 size={18} className='text-purple-400' />
            <h4 className='font-semibold'>Technical Analysis</h4>
          </div>
          <div className='text-zinc-300 text-sm leading-relaxed'>{renderText(report.technicalAnalysis)}</div>
        </div>
        <div className='card-glass p-5'>
          <div className='flex items-center gap-2 mb-3'>
            <DollarSign size={18} className='text-yellow-400' />
            <h4 className='font-semibold'>Fundamental Analysis</h4>
          </div>
          <div className='text-zinc-300 text-sm leading-relaxed'>{renderText(report.fundamentalAnalysis)}</div>
        </div>
      </div>

      {/* Volume Analysis — full width */}
      {report.volumeAnalysis && (
        <div className='card-glass p-5'>
          <div className='flex items-center gap-2 mb-3'>
            <BarChart2 size={18} className='text-blue-400' />
            <h4 className='font-semibold'>Volume Analysis</h4>
          </div>
          <div className='text-zinc-300 text-sm leading-relaxed'>{renderText(report.volumeAnalysis)}</div>
        </div>
      )}

      {/* News + Risk side by side */}
      <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
        <div className='card-glass p-5'>
          <div className='flex items-center gap-2 mb-3'>
            <Zap size={18} className='text-cyan-400' />
            <h4 className='font-semibold'>News & Sentiment</h4>
          </div>
          <div className='text-zinc-300 text-sm leading-relaxed'>{renderText(report.newsAnalysis)}</div>
        </div>
        <div className='card-glass p-5'>
          <div className='flex items-center gap-2 mb-3'>
            <AlertTriangle size={18} className='text-red-400' />
            <h4 className='font-semibold'>Risk Assessment</h4>
          </div>
          <div className='text-zinc-300 text-sm leading-relaxed'>{renderText(report.riskAssessment)}</div>
        </div>
      </div>

      {/* Price Targets */}
      <div className='grid grid-cols-2 gap-4'>
        <div style={{ background: '#0a0a0a', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '12px', padding: '16px' }}>
          <p className='text-zinc-500 text-xs tracking-widest mb-2'>SUPPORT</p>
          <div className='space-y-1'>
            {report.priceTargets.support.length > 0 ? report.priceTargets.support.map((price, i) => (
              <div key={i} className='text-xl font-bold text-emerald-400'>${price.toFixed(2)}</div>
            )) : <div className='text-zinc-600 text-sm'>None detected</div>}
          </div>
        </div>
        <div style={{ background: '#0a0a0a', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', padding: '16px' }}>
          <p className='text-zinc-500 text-xs tracking-widest mb-2'>RESISTANCE</p>
          <div className='space-y-1'>
            {report.priceTargets.resistance.length > 0 ? report.priceTargets.resistance.map((price, i) => (
              <div key={i} className='text-xl font-bold text-red-400'>${price.toFixed(2)}</div>
            )) : <div className='text-zinc-600 text-sm'>None detected</div>}
          </div>
        </div>
      </div>

      {/* Trading Strategy — stacked on mobile, 3-col on desktop */}
      <div className='space-y-3'>
        <h3 className='text-lg font-bold flex items-center gap-2'>
          <Target size={18} className='text-blue-400' /> Trading Strategy
        </h3>
        <div className='grid grid-cols-1 md:grid-cols-3 gap-3'>
          <div style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: '12px', padding: '14px' }}>
            <p className='text-zinc-500 text-xs tracking-widest mb-2'>ENTRY POINT</p>
            <p className='text-white text-sm leading-relaxed'>{renderText(report.tradingStrategy.entryPoint)}</p>
          </div>
          <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', padding: '14px' }}>
            <p className='text-zinc-500 text-xs tracking-widest mb-2'>STOP LOSS</p>
            <p className='text-red-300 text-sm leading-relaxed'>{renderText(report.tradingStrategy.stopLoss)}</p>
          </div>
          <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '12px', padding: '14px' }}>
            <p className='text-zinc-500 text-xs tracking-widest mb-2'>TAKE PROFIT</p>
            <p className='text-emerald-300 text-sm leading-relaxed'>{renderText(report.tradingStrategy.takeProfit)}</p>
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '12px 16px' }}>
        <p className='text-zinc-600 text-xs leading-relaxed'>
          <Shield size={12} className='inline mr-1 mb-0.5' />
          This analysis is generated algorithmically from technical indicators and market data. It is for informational purposes only and does not constitute financial advice. Always conduct your own research and consult a licensed financial advisor before making investment decisions.
        </p>
      </div>
    </div>
  )
}

export { AnalysisReportComponent as AnalysisReport }
