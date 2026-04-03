import { StockData } from './yahoo'
import { IndicatorValues } from './indicators'
import { PatternMatch, findSupportResistance } from './patterns'

export interface AnalysisReport {
  ticker: string
  timestamp: string
  executiveSummary: string
  technicalAnalysis: string
  fundamentalAnalysis: string
  volumeAnalysis: string
  newsAnalysis: string
  riskAssessment: string
  recommendation: 'BUY' | 'SELL' | 'HOLD'
  recommendationReason: string
  priceTargets: {
    support: number[]
    resistance: number[]
  }
  tradingStrategy: {
    entryPoint: string
    stopLoss: string
    takeProfit: string
  }
}

export async function generateAnalysisReport(
  stock: StockData,
  historicalPrices: number[],
  indicators: IndicatorValues,
  patterns: PatternMatch[],
  newsHeadlines: string[],
  historicalVolumes?: number[],
): Promise<AnalysisReport> {
  const { support, resistance } = findSupportResistance(historicalPrices)

  const lastValid = (arr: number[] | undefined) => {
    if (!arr || arr.length === 0) return 0
    for (let i = arr.length - 1; i >= 0; i--) {
      if (!isNaN(arr[i]) && arr[i] !== null && arr[i] !== undefined) return arr[i]
    }
    return 0
  }

  const lastBB = (arr: Array<{upper: number; middle: number; lower: number}> | undefined) => {
    if (!arr || arr.length === 0) return { upper: 0, middle: 0, lower: 0 }
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] && !isNaN(arr[i].middle)) return arr[i]
    }
    return { upper: 0, middle: 0, lower: 0 }
  }

  const reportPrompt = buildPrompt({
    ticker: stock.ticker,
    price: stock.price,
    change: stock.change,
    changePercent: stock.changePercent,
    volume: stock.volume,
    marketCap: stock.marketCap,
    peRatio: stock.peRatio,
    dividendYield: stock.dividendYield,
    week52High: stock.week52High,
    week52Low: stock.week52Low,
    indicators: {
      rsi: lastValid(indicators?.rsi),
      macd: lastValid(indicators?.macd),
      macdSignal: lastValid(indicators?.macdSignal),
      sma20: lastValid(indicators?.sma20),
      sma50: lastValid(indicators?.sma50),
      sma200: lastValid(indicators?.sma200),
      bollingerBands: lastBB(indicators?.bollingerBands),
    },
    patterns: patterns.map((p) => `${p.name} (${(p.confidence).toFixed(0)}% confidence)`),
    support,
    resistance,
    news: newsHeadlines,
  })

  const analysisData = await callLLM(reportPrompt, stock, lastValid(indicators?.rsi), lastValid(indicators?.macd), lastValid(indicators?.macdSignal), lastValid(indicators?.sma20), lastValid(indicators?.sma50), lastValid(indicators?.sma200), lastBB(indicators?.bollingerBands), patterns, support, resistance, newsHeadlines, historicalVolumes || [])

  return parseAnalysisResponse(analysisData, stock.ticker, support, resistance)
}

interface PromptData {
  ticker: string
  price: number
  change: number
  changePercent: number
  volume: number
  marketCap: number
  peRatio: number
  dividendYield: number
  week52High: number
  week52Low: number
  indicators: {
    rsi: number
    macd: number
    macdSignal: number
    sma20: number
    sma50: number
    sma200: number
    bollingerBands: any
  }
  patterns: string[]
  support: number[]
  resistance: number[]
  news: string[]
}

function buildPrompt(data: PromptData): string {
  const fmt = (n: number, dec = 2) => (n && !isNaN(n)) ? n.toFixed(dec) : 'N/A'
  const fmtPct = (n: number) => (n && !isNaN(n)) ? (n * 100).toFixed(2) : 'N/A'

  return `Analyze the stock ${data.ticker} and provide a comprehensive investment analysis report.

Current Price: $${fmt(data.price)}
Change: ${data.change > 0 ? '+' : ''}${fmt(data.change)} (${fmt(data.changePercent)}%)
Volume: ${data.volume ? (data.volume / 1000000).toFixed(2) + 'M' : 'N/A'}
Market Cap: ${data.marketCap ? '$' + (data.marketCap / 1000000000).toFixed(2) + 'B' : 'N/A'}
P/E Ratio: ${fmt(data.peRatio)}
Dividend Yield: ${fmtPct(data.dividendYield)}%
52-Week Range: $${fmt(data.week52Low)} - $${fmt(data.week52High)}

Technical Indicators:
- RSI: ${fmt(data.indicators.rsi)}
- MACD: ${fmt(data.indicators.macd, 4)}
- MACD Signal: ${fmt(data.indicators.macdSignal, 4)}
- SMA 20: $${fmt(data.indicators.sma20)}
- SMA 50: $${fmt(data.indicators.sma50)}
- SMA 200: $${fmt(data.indicators.sma200)}
- Bollinger Bands: Upper $${fmt(data.indicators.bollingerBands?.upper)}, Middle $${fmt(data.indicators.bollingerBands?.middle)}, Lower $${fmt(data.indicators.bollingerBands?.lower)}

Detected Patterns:
${data.patterns.length > 0 ? data.patterns.map((p) => `- ${p}`).join('\n') : '- No significant patterns detected'}

Support Levels: ${data.support.length > 0 ? data.support.map((s) => `$${s.toFixed(2)}`).join(', ') : 'N/A'}
Resistance Levels: ${data.resistance.length > 0 ? data.resistance.map((r) => `$${r.toFixed(2)}`).join(', ') : 'N/A'}

Recent News Sentiment:
${data.news.slice(0, 5).map((n) => `- ${n}`).join('\n')}

Provide a structured JSON response with:
{
  "executiveSummary": "2-3 sentence overview",
  "technicalAnalysis": "Analysis of technical indicators and patterns",
  "fundamentalAnalysis": "Analysis of valuation metrics",
  "newsAnalysis": "Market sentiment based on news",
  "riskAssessment": "Key risks to consider",
  "recommendation": "BUY/SELL/HOLD",
  "recommendationReason": "Why this recommendation",
  "entryPoint": "Suggested entry price or strategy",
  "stopLoss": "Suggested stop loss level",
  "takeProfit": "Suggested take profit target"
}`
}

async function callLLM(prompt: string, stock: StockData, rsi: number, macd: number, macdSignal: number, sma20: number, sma50: number, sma200: number, bb: any, patterns: PatternMatch[], support: number[], resistance: number[], news: string[], volumes: number[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  const apiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions'

  if (!apiKey) {
    return generateDataDrivenAnalysis(stock, rsi, macd, macdSignal, sma20, sma50, sma200, bb, patterns, support, resistance, news, volumes)
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a senior financial analyst. Provide extremely detailed, actionable investment analysis in JSON format. Be specific with numbers, levels, and reasoning. Include specific entry/exit strategies with exact price levels.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      }),
    })

    if (!response.ok) return generateDataDrivenAnalysis(stock, rsi, macd, macdSignal, sma20, sma50, sma200, bb, patterns, support, resistance, news, volumes)
    const data = await response.json()
    return data.choices[0].message.content
  } catch {
    return generateDataDrivenAnalysis(stock, rsi, macd, macdSignal, sma20, sma50, sma200, bb, patterns, support, resistance, news, volumes)
  }
}

function generateDataDrivenAnalysis(stock: StockData, rsi: number, macd: number, macdSignal: number, sma20: number, sma50: number, sma200: number, bb: any, patterns: PatternMatch[], support: number[], resistance: number[], news: string[], volumes: number[]): string {
  const p = stock.price
  const fmt = (n: number) => n ? '$' + n.toFixed(2) : 'N/A'

  // Determine trend
  const aboveSMA20 = sma20 > 0 && p > sma20
  const aboveSMA50 = sma50 > 0 && p > sma50
  const aboveSMA200 = sma200 > 0 && p > sma200
  const sma20Above50 = sma20 > 0 && sma50 > 0 && sma20 > sma50
  const goldenCross = sma20Above50 && aboveSMA200
  const deathCross = sma20 > 0 && sma50 > 0 && sma20 < sma50 && !aboveSMA200

  // RSI analysis
  const rsiOverbought = rsi > 70
  const rsiOversold = rsi < 30
  const rsiNeutral = rsi >= 30 && rsi <= 70
  const rsiBullish = rsi > 50 && rsi <= 70
  const rsiBearish = rsi < 50 && rsi >= 30

  // MACD analysis
  const macdBullish = macd > macdSignal
  const macdBearish = macd < macdSignal
  const macdPositive = macd > 0

  // Bollinger analysis
  const nearUpperBB = bb?.upper > 0 && p > bb.upper * 0.98
  const nearLowerBB = bb?.lower > 0 && p < bb.lower * 1.02
  const bbWidth = bb?.upper > 0 && bb?.lower > 0 ? ((bb.upper - bb.lower) / bb.middle * 100).toFixed(1) : '0'

  // 52-week position
  const range52 = stock.week52High - stock.week52Low
  const pos52 = range52 > 0 ? ((p - stock.week52Low) / range52 * 100).toFixed(0) : '50'
  const near52High = stock.week52High > 0 && p > stock.week52High * 0.95
  const near52Low = stock.week52Low > 0 && p < stock.week52Low * 1.05

  // Score signals
  let bullSignals = 0, bearSignals = 0
  if (aboveSMA20) bullSignals++; else bearSignals++
  if (aboveSMA50) bullSignals++; else bearSignals++
  if (aboveSMA200) bullSignals++; else bearSignals++
  if (macdBullish) bullSignals++; else bearSignals++
  if (rsiBullish || rsiOversold) bullSignals++
  if (rsiBearish || rsiOverbought) bearSignals++
  if (goldenCross) bullSignals += 2
  if (deathCross) bearSignals += 2

  const patternBull = patterns.filter(p => p.type === 'bullish').length
  const patternBear = patterns.filter(p => p.type === 'bearish').length
  bullSignals += patternBull
  bearSignals += patternBear

  let recommendation: string
  let recReason: string

  if (bullSignals >= bearSignals + 3) {
    recommendation = 'BUY'
    recReason = `Strong bullish conviction with ${bullSignals} bullish signals vs ${bearSignals} bearish. ${goldenCross ? 'Golden cross pattern confirms uptrend. ' : ''}${macdBullish ? 'MACD is above signal line showing momentum. ' : ''}${rsiOversold ? 'RSI indicates oversold conditions — a potential bounce opportunity. ' : rsiBullish ? 'RSI confirms bullish momentum without being overbought. ' : ''}Price is ${aboveSMA200 ? 'above' : 'below'} the 200-day SMA, ${aboveSMA50 ? 'above' : 'below'} the 50-day SMA. ${near52Low ? 'Trading near 52-week lows presents a potential value entry.' : ''}`
  } else if (bearSignals >= bullSignals + 3) {
    recommendation = 'SELL'
    recReason = `Strong bearish pressure with ${bearSignals} bearish signals vs ${bullSignals} bullish. ${deathCross ? 'Death cross pattern warns of sustained downtrend. ' : ''}${macdBearish ? 'MACD below signal line shows fading momentum. ' : ''}${rsiOverbought ? 'RSI in overbought territory suggests a pullback is likely. ' : rsiBearish ? 'RSI confirms bearish momentum. ' : ''}Price is ${!aboveSMA200 ? 'below the critical 200-day SMA, a bearish sign. ' : 'still above 200-day SMA but showing weakness. '}${near52High ? 'Near 52-week highs with deteriorating technicals suggests distribution.' : ''}`
  } else {
    recommendation = 'HOLD'
    recReason = `Mixed signals with ${bullSignals} bullish and ${bearSignals} bearish indicators. The market is showing indecision — ${macdBullish ? 'MACD favors bulls' : 'MACD favors bears'} while RSI at ${rsi.toFixed(0)} is ${rsiNeutral ? 'neutral' : rsiOverbought ? 'overbought' : 'oversold'}. Wait for a clearer directional signal before committing capital. A break above ${fmt(resistance[0])} would confirm bullish continuation; a break below ${fmt(support[0])} would signal further downside.`
  }

  const supportStr = support.length > 0 ? support.map(s => fmt(s)).join(', ') : 'N/A'
  const resistanceStr = resistance.length > 0 ? resistance.map(r => fmt(r)).join(', ') : 'N/A'

  // Volume analysis
  const volFmt = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : n.toFixed(0)
  let avgVolume = 0, volTrend = '', volVsCurrent = '', volSpike = false
  if (volumes.length > 0) {
    const recent20 = volumes.slice(-20)
    avgVolume = recent20.reduce((a, b) => a + b, 0) / recent20.length
    const recent5 = volumes.slice(-5)
    const avg5 = recent5.reduce((a, b) => a + b, 0) / recent5.length
    const older = volumes.slice(-20, -5)
    const avgOlder = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : avgVolume

    const currentVol = stock.volume || volumes[volumes.length - 1] || 0
    const ratio = avgVolume > 0 ? currentVol / avgVolume : 1

    if (ratio > 1.5) { volVsCurrent = `Current volume (${volFmt(currentVol)}) is **${ratio.toFixed(1)}x above** the 20-day average (${volFmt(avgVolume)}), indicating heightened interest and conviction behind the move.`; volSpike = true }
    else if (ratio > 1.1) volVsCurrent = `Current volume (${volFmt(currentVol)}) is slightly above the 20-day average (${volFmt(avgVolume)}), showing moderate participation.`
    else if (ratio > 0.7) volVsCurrent = `Current volume (${volFmt(currentVol)}) is in line with the 20-day average (${volFmt(avgVolume)}), suggesting normal trading activity.`
    else volVsCurrent = `Current volume (${volFmt(currentVol)}) is **below** the 20-day average (${volFmt(avgVolume)}), indicating reduced interest. Low volume moves are less reliable.`

    if (avg5 > avgOlder * 1.3) volTrend = 'Volume is trending **higher** over the past 5 days compared to the prior 15 days, suggesting growing market interest.'
    else if (avg5 < avgOlder * 0.7) volTrend = 'Volume is trending **lower** over the past 5 days, suggesting fading interest. Price moves on declining volume are less trustworthy.'
    else volTrend = 'Volume has been relatively stable over the past 20 trading sessions.'
  }

  const volumeAnalysisText = volumes.length > 0
    ? `**Current Volume:** ${volFmt(stock.volume)} shares traded. **20-Day Average:** ${volFmt(avgVolume)}.\n\n${volVsCurrent}\n\n${volTrend}\n\n**Volume-Price Relationship:** ${
      stock.change > 0 && volSpike ? 'Price is rising on above-average volume — this is a bullish confirmation. Strong volume behind an up-move suggests institutional buying and increases the probability of continuation.' :
      stock.change < 0 && volSpike ? 'Price is falling on above-average volume — this is a bearish confirmation. Heavy selling pressure suggests institutional distribution and the decline may continue.' :
      stock.change > 0 && !volSpike ? 'Price is rising but on average or below-average volume. This advance may lack conviction — watch for volume expansion to confirm the move.' :
      'Price is declining on normal volume. This could be routine profit-taking rather than panic selling.'
    }`
    : 'Volume data not available for analysis.'

  // Anchor all price targets relative to current price
  const nearestSupport = support[0] || (sma50 > 0 && sma50 < p ? sma50 : p * 0.95)
  const nearestResistance = resistance[0] || (sma50 > 0 && sma50 > p ? sma50 : p * 1.08)
  const stopLossPrice = nearestSupport * 0.97
  const takeProfitPrice = nearestResistance * 1.02

  // Sanity: clamp stop loss to no more than 12% below current price
  const clampedStopLoss = Math.max(stopLossPrice, p * 0.88)
  // Sanity: clamp take profit to no more than 20% above current price
  const clampedTakeProfit = Math.min(takeProfitPrice, p * 1.20)

  const supportLabel = support.length > 0 ? fmt(support[0]) : fmt(nearestSupport) + ' (SMA/estimated)'
  const resistanceLabel = resistance.length > 0 ? fmt(resistance[0]) : fmt(nearestResistance) + ' (SMA/estimated)'

  return JSON.stringify({
    executiveSummary: `${stock.name || stock.ticker} (${stock.ticker}) is currently trading at ${fmt(p)}, ${stock.changePercent > 0 ? 'up' : 'down'} ${Math.abs(stock.changePercent).toFixed(2)}% recently. The stock sits at ${pos52}% of its 52-week range (${fmt(stock.week52Low)} – ${fmt(stock.week52High)}). ${bullSignals > bearSignals ? 'Technical momentum is leaning bullish' : bearSignals > bullSignals ? 'Technical indicators are signaling caution' : 'The technical picture is mixed'} with RSI at ${rsi.toFixed(0)} and MACD ${macdBullish ? 'in bullish territory' : 'showing bearish divergence'}. ${patterns.length > 0 ? 'Pattern analysis has detected ' + patterns.map(p => p.name).join(', ') + '.' : 'No significant chart patterns detected at this time.'}`,

    technicalAnalysis: `**Moving Averages:** Price at ${fmt(p)} is ${aboveSMA20 ? 'above' : 'below'} the 20-day SMA (${fmt(sma20)}), ${aboveSMA50 ? 'above' : 'below'} the 50-day SMA (${fmt(sma50)}), and ${aboveSMA200 ? 'above' : 'below'} the 200-day SMA (${fmt(sma200)}). ${goldenCross ? 'A golden cross (20 SMA > 50 SMA) is in effect, historically a strong bullish signal.' : deathCross ? 'A death cross (20 SMA < 50 SMA) is in effect, historically a bearish warning.' : sma20Above50 ? 'The 20-day is above the 50-day, suggesting short-term strength.' : 'The 20-day is below the 50-day, suggesting short-term weakness.'}\n\n**RSI (${rsi.toFixed(1)}):** ${rsiOverbought ? 'RSI is above 70, indicating overbought conditions. This often precedes a pullback or consolidation period. Consider taking partial profits or tightening stops.' : rsiOversold ? 'RSI is below 30, indicating oversold conditions. This can signal a potential bounce or reversal opportunity for contrarian investors.' : rsiBullish ? 'RSI is between 50-70, confirming bullish momentum. There is still room to run before overbought territory.' : rsiBearish ? 'RSI is between 30-50, showing bearish momentum but not yet oversold.' : 'RSI is in neutral territory around 50.'}\n\n**MACD:** The MACD line (${macd.toFixed(4)}) is ${macdBullish ? 'above' : 'below'} the signal line (${macdSignal.toFixed(4)}), indicating ${macdBullish ? 'bullish' : 'bearish'} momentum. ${macdPositive ? 'MACD is positive, suggesting the uptrend has momentum.' : 'MACD is negative, suggesting downward pressure persists.'}\n\n**Bollinger Bands:** Current bandwidth is ${bbWidth}%. ${nearUpperBB ? 'Price is near the upper Bollinger Band, suggesting the stock may be stretched. Watch for mean reversion.' : nearLowerBB ? 'Price is near the lower Bollinger Band, which often acts as dynamic support. A bounce is possible.' : 'Price is within normal Bollinger Band range.'}\n\n**Support & Resistance:** Key support at ${supportStr}. Key resistance at ${resistanceStr}.`,

    fundamentalAnalysis: `${stock.ticker} has a current market capitalization of ${stock.marketCap ? '$' + (stock.marketCap / 1e9).toFixed(2) + 'B' : 'not available'}. ${stock.peRatio > 0 ? 'The trailing P/E ratio is ' + stock.peRatio.toFixed(2) + (stock.peRatio > 30 ? ', which is elevated relative to the broader market average of ~20-25x, suggesting growth expectations are priced in.' : stock.peRatio > 15 ? ', which is reasonable and in line with market averages.' : ', which is below market averages and may indicate value or market concerns about growth.') : 'P/E ratio data is not available.'} ${stock.dividendYield > 0 ? 'The stock offers a dividend yield of ' + (stock.dividendYield * 100).toFixed(2) + '%, providing income alongside potential capital appreciation.' : 'The company does not currently pay a dividend, typical of growth-oriented firms reinvesting earnings.'}`,

    volumeAnalysis: volumeAnalysisText,

    newsAnalysis: `Market sentiment analysis indicates ${bullSignals > bearSignals ? 'a positive bias in recent market activity' : bearSignals > bullSignals ? 'cautious sentiment prevailing' : 'neutral market sentiment'}. ${near52High ? 'The stock is near its 52-week high, suggesting strong momentum but also potential for profit-taking.' : near52Low ? 'Trading near 52-week lows could represent either a value trap or a genuine buying opportunity — further due diligence is recommended.' : 'The stock is in the middle of its 52-week range, offering balanced risk/reward.'} Broader market conditions should be considered alongside this analysis. ${patterns.length > 0 ? 'Chart pattern analysis detected: ' + patterns.map(p => p.name + ' (' + p.confidence.toFixed(0) + '% confidence, ' + p.type + ')').join('; ') + '. These patterns provide additional context for the trading strategy below.' : ''}`,

    riskAssessment: `**Downside Risks:** (1) A break below support at ${supportLabel} could trigger accelerated selling toward ${fmt(support[1] || nearestSupport * 0.95)}. (2) ${rsiOverbought ? 'Overbought RSI conditions increase the probability of a near-term pullback.' : macdBearish ? 'Bearish MACD divergence suggests momentum is fading.' : 'Broader market corrections could drag the stock lower regardless of individual fundamentals.'} (3) ${stock.peRatio > 30 ? 'Elevated valuation (P/E ' + stock.peRatio.toFixed(1) + 'x) leaves limited margin for error on earnings.' : 'Sector-specific headwinds or macro changes could impact the stock.'}\n\n**Upside Catalysts:** (1) A breakout above resistance at ${resistanceLabel} with volume confirmation could target ${fmt(resistance[1] || nearestResistance * 1.05)}. (2) ${goldenCross ? 'The active golden cross is a traditionally strong bullish signal.' : 'Improving technical momentum could attract momentum buyers.'} (3) Positive earnings surprises or guidance upgrades could rerate the stock higher.\n\n**Risk/Reward Assessment:** Current price ${fmt(p)}. Downside to stop at ${fmt(clampedStopLoss)} = ${((p - clampedStopLoss) / p * 100).toFixed(1)}% risk. Upside to target at ${fmt(clampedTakeProfit)} = ${((clampedTakeProfit - p) / p * 100).toFixed(1)}% reward. Risk/reward ratio: 1:${((clampedTakeProfit - p) / (p - clampedStopLoss)).toFixed(1)}.`,

    recommendation,
    recommendationReason: recReason,

    entryPoint: recommendation === 'BUY'
      ? `Current price: ${fmt(p)}. Aggressive entry: Buy now with a small position (25-30% of intended size). Scale in on pullbacks to SMA20 (${fmt(sma20)}) and support near ${supportLabel}. Conservative entry: Wait for a pullback to ${fmt(nearestSupport)} with RSI below 40 for a higher-probability setup.`
      : recommendation === 'SELL'
      ? `Current price: ${fmt(p)}. Exit current long positions at market. If shorting, enter near resistance at ${resistanceLabel} with a stop above ${fmt(nearestResistance * 1.03)}. Wait for confirmed breakdown below ${supportLabel} for additional short entries.`
      : `Current price: ${fmt(p)}. Hold current positions. Accumulate only on dips to ${supportLabel} with confirming bullish signals (RSI bounce from <35, MACD crossover). Reduce exposure if price closes below ${fmt(nearestSupport)} on heavy volume.`,

    stopLoss: `Place stop-loss at ${fmt(clampedStopLoss)} (${((p - clampedStopLoss) / p * 100).toFixed(1)}% below current price ${fmt(p)}). This is set 3% below the nearest support at ${supportLabel}. For swing trades, use a tighter stop at ${supportLabel} — exit on a daily close below this level.`,

    takeProfit: `Primary target: ${fmt(nearestResistance)} (nearest resistance, +${((nearestResistance - p) / p * 100).toFixed(1)}% from current ${fmt(p)}). Secondary target: ${fmt(clampedTakeProfit)} (+${((clampedTakeProfit - p) / p * 100).toFixed(1)}% upside). Consider taking 50% profits at the first target and trailing the stop on the remainder. ${near52High ? 'Near 52-week highs — trail stops tightly as breakout failure is possible.' : ''}`,
  })
}

function parseAnalysisResponse(
  response: string,
  ticker: string,
  support: number[],
  resistance: number[],
): AnalysisReport {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    const analysisData = jsonMatch ? JSON.parse(jsonMatch[0]) : generateMockAnalysisData()

    return {
      ticker,
      timestamp: new Date().toISOString(),
      executiveSummary: analysisData.executiveSummary || 'Analysis generated',
      technicalAnalysis: analysisData.technicalAnalysis || 'Technical analysis unavailable',
      fundamentalAnalysis: analysisData.fundamentalAnalysis || 'Fundamental analysis unavailable',
      volumeAnalysis: analysisData.volumeAnalysis || 'Volume analysis unavailable',
      newsAnalysis: analysisData.newsAnalysis || 'News analysis unavailable',
      riskAssessment: analysisData.riskAssessment || 'Risk assessment unavailable',
      recommendation: (analysisData.recommendation?.toUpperCase() as 'BUY' | 'SELL' | 'HOLD') || 'HOLD',
      recommendationReason: analysisData.recommendationReason || 'Recommendation reasoning unavailable',
      priceTargets: {
        support,
        resistance,
      },
      tradingStrategy: {
        entryPoint: analysisData.entryPoint || 'Not specified',
        stopLoss: analysisData.stopLoss || 'Not specified',
        takeProfit: analysisData.takeProfit || 'Not specified',
      },
    }
  } catch (error) {
    console.error('Error parsing analysis response:', error)
    return generateDefaultReport(ticker, support, resistance)
  }
}

function generateMockAnalysisData() {
  return {
    executiveSummary: 'Technical and fundamental analysis indicate a balanced outlook.',
    technicalAnalysis: 'Price action shows consolidation with key support and resistance levels.',
    fundamentalAnalysis: 'Company maintains healthy valuation metrics.',
    volumeAnalysis: 'Volume is at normal levels with no significant anomalies detected.',
    newsAnalysis: 'Recent news flow is neutral.',
    riskAssessment: 'Market and sector risks present.',
    recommendation: 'HOLD',
    recommendationReason: 'Fair valuation with balanced risk/reward.',
    entryPoint: 'On dips to support levels.',
    stopLoss: 'Below major support.',
    takeProfit: 'At resistance levels.',
  }
}

function generateDefaultReport(ticker: string, support: number[], resistance: number[]): AnalysisReport {
  return {
    ticker,
    timestamp: new Date().toISOString(),
    executiveSummary: 'Analysis in progress. Stock shows normal trading activity.',
    technicalAnalysis: 'Standard technical analysis based on price action and volume.',
    fundamentalAnalysis: 'Valuation metrics within normal range.',
    volumeAnalysis: 'Volume data being processed.',
    newsAnalysis: 'Market sentiment neutral.',
    riskAssessment: 'Standard market risks apply.',
    recommendation: 'HOLD',
    recommendationReason: 'Await clearer signals for directional move.',
    priceTargets: { support, resistance },
    tradingStrategy: {
      entryPoint: `Buy on pullback to support at $${support[0]?.toFixed(2)}`,
      stopLoss: `Below $${(support[0] - support[0] * 0.05)?.toFixed(2)}`,
      takeProfit: `Target $${resistance[0]?.toFixed(2)}`,
    },
  }
}
