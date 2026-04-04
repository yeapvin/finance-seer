'use client'

import { AnalysisReport } from '@/lib/analysis'
import { TrendingUp, TrendingDown, Download, Shield, Target, BarChart2, FileText, Newspaper, AlertTriangle, Zap } from 'lucide-react'
import jsPDF from 'jspdf'

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px' }}>
        <span style={{ color: '#6366f1' }}>{icon}</span>
        <h4 style={{ color: '#a5b4fc', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', margin: 0 }}>{title}</h4>
      </div>
      <div style={{ color: '#d4d4d8', fontSize: '13px', lineHeight: '1.7' }}>
        {typeof children === 'string'
          ? children.split('\n\n').map((para, i) => (
              <p key={i} style={{ margin: '0 0 8px 0' }}
                dangerouslySetInnerHTML={{ __html: para.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#e4e4e7">$1</strong>') }} />
            ))
          : children}
      </div>
    </div>
  )
}

function RecommendationBadge({ rec }: { rec: string }) {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    BUY: { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.4)', text: '#34d399' },
    SELL: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)', text: '#f87171' },
    HOLD: { bg: 'rgba(234,179,8,0.12)', border: 'rgba(234,179,8,0.4)', text: '#fbbf24' },
  }
  const c = colors[rec] || colors.HOLD
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: '10px', padding: '16px', textAlign: 'center', marginBottom: '12px' }}>
      <div style={{ color: c.text, fontSize: '28px', fontWeight: 900, letterSpacing: '2px' }}>{rec}</div>
      <div style={{ color: c.text, fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>Recommendation</div>
    </div>
  )
}

export function AnalysisReportComponent({ report, patterns }: { report: AnalysisReport; patterns?: any[] }) {
  const downloadPDF = () => {
    const doc = new jsPDF()
    let y = 20
    const margin = 20
    const maxWidth = doc.internal.pageSize.getWidth() - margin * 2

    const addText = (text: string, size = 10, bold = false, color: [number,number,number] = [200,200,210]) => {
      doc.setFontSize(size); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setTextColor(...color)
      const lines = doc.splitTextToSize(text.replace(/\*\*/g,''), maxWidth)
      lines.forEach((line: string) => {
        if (y > 270) { doc.addPage(); y = 20 }
        doc.text(line, margin, y); y += size * 0.5
      })
      y += 4
    }

    addText(`Finance Seer — Analysis Report`, 16, true, [255,255,255])
    addText(`${report.ticker} · Generated ${new Date(report.timestamp).toLocaleString()}`, 10, false, [150,150,180])
    y += 4
    const sections = [
      ['RECOMMENDATION', `${report.recommendation} — ${report.recommendationReason}`],
      ['EXECUTIVE SUMMARY', report.executiveSummary],
      ['TECHNICAL ANALYSIS', report.technicalAnalysis],
      ['FUNDAMENTAL ANALYSIS', report.fundamentalAnalysis],
      ['VOLUME ANALYSIS', report.volumeAnalysis],
      ['NEWS & SENTIMENT', report.newsAnalysis],
      ['RISK ASSESSMENT', report.riskAssessment],
      ['TRADING STRATEGY', `Entry: ${report.tradingStrategy.entryPoint}\nStop Loss: ${report.tradingStrategy.stopLoss}\nTake Profit: ${report.tradingStrategy.takeProfit}`],
    ]
    sections.forEach(([title, body]) => {
      addText(title, 11, true, [165,180,252])
      addText(body, 10)
    })
    doc.save(`${report.ticker}-analysis.pdf`)
  }

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={16} style={{ color: '#facc15' }} />
          <h3 style={{ color: 'white', fontWeight: 800, fontSize: '16px', margin: 0 }}>Analysis Report</h3>
          <span style={{ color: '#e4e4e7', fontSize: '11px' }}>{new Date(report.timestamp).toLocaleString()}</span>
        </div>
        <button onClick={downloadPDF}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', borderRadius: '7px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#a1a1aa', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
          <Download size={12} /> PDF
        </button>
      </div>

      {/* ── Two-column main body ── */}
      <div className='analysis-grid' style={{ marginBottom: '24px' }}>

        {/* LEFT: Analysis sections */}
        <div>
          <Section icon={<FileText size={13} />} title="Executive Summary">{report.executiveSummary}</Section>
          <Section icon={<BarChart2 size={13} />} title="Technical Analysis">{report.technicalAnalysis}</Section>
          <Section icon={<Target size={13} />} title="Fundamental Analysis">{report.fundamentalAnalysis}</Section>
          <Section icon={<BarChart2 size={13} />} title="Volume Analysis">{report.volumeAnalysis}</Section>
          <Section icon={<Newspaper size={13} />} title="News & Sentiment">{report.newsAnalysis}</Section>
          <Section icon={<Shield size={13} />} title="Risk Assessment">{report.riskAssessment}</Section>
        </div>

        {/* RIGHT: Recommendation + S/R + Strategy */}
        <div>
          {/* Recommendation */}
          <RecommendationBadge rec={report.recommendation} />
          <div style={{ color: '#e4e4e7', fontSize: '12px', lineHeight: '1.6', marginBottom: '20px', padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
            {report.recommendationReason}
          </div>

          {/* Support & Resistance side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
            <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '10px', padding: '12px' }}>
              <div style={{ color: '#34d399', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' }}>Support</div>
              {report.priceTargets.support.length > 0
                ? report.priceTargets.support.map((s, i) => (
                    <div key={i} style={{ color: '#6ee7b7', fontSize: '13px', fontWeight: 600, marginBottom: '3px' }}>${s.toFixed(2)}</div>
                  ))
                : <div style={{ color: '#e4e4e7', fontSize: '12px' }}>N/A</div>}
            </div>
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', padding: '12px' }}>
              <div style={{ color: '#f87171', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' }}>Resistance</div>
              {report.priceTargets.resistance.length > 0
                ? report.priceTargets.resistance.map((r, i) => (
                    <div key={i} style={{ color: '#fca5a5', fontSize: '13px', fontWeight: 600, marginBottom: '3px' }}>${r.toFixed(2)}</div>
                  ))
                : <div style={{ color: '#e4e4e7', fontSize: '12px' }}>N/A</div>}
            </div>
          </div>

          {/* Trading Strategy */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
              <Target size={13} style={{ color: '#6366f1' }} />
              <h4 style={{ color: '#a5b4fc', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', margin: 0 }}>Trading Strategy</h4>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { label: 'Entry Point', value: report.tradingStrategy.entryPoint, color: '#60a5fa' },
                { label: 'Stop Loss', value: report.tradingStrategy.stopLoss, color: '#f87171' },
                { label: 'Take Profit', value: report.tradingStrategy.takeProfit, color: '#34d399' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ color, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px' }}>{label}</div>
                  <div style={{ color: '#d4d4d8', fontSize: '12px', lineHeight: '1.5' }}
                    dangerouslySetInnerHTML={{ __html: value.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#e4e4e7">$1</strong>') }} />
                </div>
              ))}
            </div>
          </div>
          {/* Detected Patterns — right under Trading Strategy */}
          {patterns && patterns.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                <span style={{ color: '#6366f1' }}>⬡</span>
                <h4 style={{ color: '#a5b4fc', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', margin: 0 }}>Detected Patterns</h4>
                <span style={{ color: '#e4e4e7', fontSize: '10px' }}>{patterns.length} found · 6mo</span>
                <span style={{ color: '#52525b', fontSize: '10px', marginLeft: 'auto' }}>latest first ↑</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {[...patterns].sort((a, b) => (b.endIndex ?? 0) - (a.endIndex ?? 0)).map((pattern: any, i: number) => (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${pattern.type === 'bullish' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}`, borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {pattern.type === 'bullish'
                          ? <span style={{ color: '#34d399', fontSize: '12px' }}>▲</span>
                          : <span style={{ color: '#f87171', fontSize: '12px' }}>▼</span>}
                        <span style={{ color: 'white', fontWeight: 600, fontSize: '12px' }}>{pattern.name}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {pattern.endDate && (
                          <span style={{ color: '#e4e4e7', fontSize: '10px' }}>
                            {pattern.startDate && pattern.startDate !== pattern.endDate
                              ? `${pattern.startDate} → ${pattern.endDate}`
                              : pattern.endDate}
                          </span>
                        )}
                        <span style={{ color: pattern.confidence >= 75 ? '#34d399' : pattern.confidence >= 50 ? '#fbbf24' : '#71717a', fontSize: '11px', fontWeight: 700 }}>{pattern.confidence?.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div style={{ height: '2px', background: 'rgba(255,255,255,0.05)', borderRadius: '1px', marginBottom: '4px' }}>
                      <div style={{ height: '100%', borderRadius: '1px', width: `${Math.min(pattern.confidence, 100)}%`, background: pattern.confidence >= 75 ? '#34d399' : pattern.confidence >= 50 ? '#fbbf24' : '#e4e4e7' }} />
                    </div>
                    <p style={{ color: '#e4e4e7', fontSize: '10px', margin: 0 }}>{pattern.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Default export alias
export { AnalysisReportComponent as AnalysisReport }
