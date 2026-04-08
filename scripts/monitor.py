#!/usr/bin/env python3
"""
Finance Seer Local Monitor — runs every 10 min during NYSE hours
1. Sync portfolio from IBKR
2. Check SL/TP on open positions
3. Scan market for buy opportunities
4. Send Telegram alerts for trades (3-min approval window)
5. Execute approved trades via IBKR
6. Push updated portfolio to KV + GitHub
"""
import json, sys, time, subprocess, urllib.request, urllib.parse
from datetime import datetime, timezone
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
IBKR_HOST    = '172.23.160.1'
IBKR_PORT    = 4002
IBKR_ACCOUNT = 'DU7992310'
PORTFOLIO    = Path(__file__).parent.parent / 'data' / 'portfolio.json'
SCRIPTS      = Path(__file__).parent
IBKR_CLI     = SCRIPTS / 'ibkr_trade.py'
SYNC_SCRIPT  = SCRIPTS / 'sync_from_ibkr.py'
KV_URL       = 'https://clean-eagle-92052.upstash.io'
KV_TOKEN     = 'gQAAAAAAAWeUAAIncDFiZmRiYzc1NDY1YjI0NjU3YTYwMzc4Y2Y4ZTIxZWUzNHAxOTIwNTI'
TG_TOKEN     = '8609316971:AAFhvA7fOyXRx5ch5Mm740ajcjMRD5brIr4'
TG_CHAT      = '786437034'
FINANCE_SEER = 'https://finance-seer.vercel.app'

MAX_POSITIONS    = 5
MIN_CASH_RESERVE = 0.20  # 20% cash reserve
MAX_POSITION_PCT = 0.20  # 20% max per position
APPROVAL_TIMEOUT = 180   # 3 minutes
GROQ_KEY = ''
GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

# ── Helpers ───────────────────────────────────────────────────────────────────
def log(msg): print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def kv_set(data: dict):
    req = urllib.request.Request(f'{KV_URL}/set/portfolio',
        data=json.dumps(data).encode(),
        headers={'Authorization': f'Bearer {KV_TOKEN}', 'Content-Type': 'application/json'},
        method='POST')
    urllib.request.urlopen(req, timeout=10)

def send_telegram(msg: str, buttons=None) -> int | None:
    body: dict = {'chat_id': TG_CHAT, 'text': msg, 'parse_mode': 'Markdown'}
    if buttons:
        body['reply_markup'] = {'inline_keyboard': buttons}
    data = json.dumps(body).encode()
    req = urllib.request.Request(f'https://api.telegram.org/bot{TG_TOKEN}/sendMessage',
        data=data, headers={'Content-Type': 'application/json'})
    resp = json.loads(urllib.request.urlopen(req, timeout=10).read())
    return resp.get('result', {}).get('message_id')

def get_recent_messages(since_ts: float) -> list[str]:
    """Poll Telegram for recent messages since timestamp"""
    try:
        url = f'https://api.telegram.org/bot{TG_TOKEN}/getUpdates?timeout=1&allowed_updates=["message","callback_query"]'
        resp = json.loads(urllib.request.urlopen(url, timeout=5).read())
        messages = []
        for update in resp.get('result', []):
            msg = update.get('message', {})
            cb  = update.get('callback_query', {})
            ts  = msg.get('date', 0) or cb.get('message', {}).get('date', 0)
            if ts >= since_ts:
                text = msg.get('text', '') or cb.get('data', '')
                if text:
                    messages.append(text.upper())
        return messages
    except:
        return []

def ibkr_trade(action: str, ticker: str, shares: int, price: float = None) -> dict:
    args = [sys.executable, str(IBKR_CLI), action, ticker, str(shares)]
    if price:
        args.append(str(round(price, 2)))
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    try:
        return json.loads(result.stdout)
    except:
        return {'error': result.stderr or result.stdout or 'Unknown'}

def get_live_price(ticker: str) -> float | None:
    """Get live price from IBKR"""
    try:
        from ib_insync import IB, Stock
        ib = IB()
        ib.connect(IBKR_HOST, IBKR_PORT, clientId=35, timeout=10)
        contract = Stock(ticker, 'SMART', 'USD')
        ib.qualifyContracts(contract)
        ticker_data = ib.reqMktData(contract, '', False, False)
        ib.sleep(2)
        price = ticker_data.last or ticker_data.close or None
        ib.cancelMktData(contract)
        ib.disconnect()
        return float(price) if price else None
    except:
        return None

def push_portfolio(p: dict):
    """Save to local file, KV, and git"""
    with open(PORTFOLIO, 'w') as f:
        json.dump(p, f, indent=2)
    kv_set(p)
    try:
        repo = str(PORTFOLIO.parent.parent)
        subprocess.run(['git', 'add', '-f', 'data/portfolio.json'], cwd=repo, capture_output=True)
        subprocess.run(['git', 'commit', '-m', 'Portfolio update via local monitor'], cwd=repo, capture_output=True)
        subprocess.run(['git', 'push', 'origin', 'master'], cwd=repo, capture_output=True)
    except:
        pass

def await_approval(signal_ts: float, ticker: str, action: str) -> str:
    """Wait up to 3 mins for APPROVE/REJECT. Default: APPROVE."""
    deadline = signal_ts + APPROVAL_TIMEOUT
    while time.time() < deadline:
        time.sleep(10)
        msgs = get_recent_messages(signal_ts)
        for m in msgs:
            if 'REJECT' in m or 'CANCEL' in m or ticker in m and 'NO' in m:
                return 'REJECT'
            if 'APPROVE' in m or 'EXECUTE' in m or 'YES' in m:
                return 'APPROVE'
    return 'APPROVE'  # auto-execute after timeout

# ── Local Screener (IBKR-native) ───────────────────────────────────────────────
def calc_rsi(closes: list, period=14) -> float:
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i-1]
        gains.append(max(d,0)); losses.append(max(-d,0))
    if len(gains) < period: return 50.0
    ag = sum(gains[-period:]) / period
    al = sum(losses[-period:]) / period
    return 100 - (100 / (1 + ag/al)) if al > 0 else 100.0

def calc_sma(closes: list, period: int) -> float:
    return sum(closes[-period:]) / period if len(closes) >= period else 0.0

def calc_atr(bars: list, period=14) -> float:
    trs = [max(b.high-b.low, abs(b.high-bars[i-1].close), abs(b.low-bars[i-1].close))
           for i,b in enumerate(bars) if i > 0]
    return sum(trs[-period:]) / period if len(trs) >= period else 0.0

def get_ibkr_technicals(ib, ticker: str) -> dict | None:
    """Get live quote + historical indicators from IBKR"""
    try:
        from ib_insync import Stock
        contract = Stock(ticker, 'SMART', 'USD')
        ib.qualifyContracts(contract)
        # Historical bars for indicators
        bars = ib.reqHistoricalData(contract, endDateTime='', durationStr='6 M',
            barSizeSetting='1 day', whatToShow='ADJUSTED_LAST', useRTH=True)
        if not bars or len(bars) < 30:
            return None
        closes = [b.close for b in bars]
        price  = closes[-1]
        return {
            'price':  price,
            'rsi':    calc_rsi(closes),
            'sma50':  calc_sma(closes, 50),
            'sma200': calc_sma(closes, 200),
            'atr':    calc_atr(bars),
            'sl_base': max(calc_sma(closes, 20) * 0.97, price * 0.92),
            'tp_base': min(price + calc_atr(bars) * 3, price * 1.15),
        }
    except:
        return None

def get_technicals(ticker: str) -> dict | None:
    """Fetch RSI, MACD, MAs from tvscreener"""
    try:
        from tvscreener import StockScreener, StockField, Market, FilterOperator
        sc = StockScreener()
        sc.set_markets(Market.AMERICA)
        sc.add_filter(StockField.NAME, FilterOperator.EQUAL, ticker)
        df = sc.get()
        if df.empty:
            return None
        row = df.iloc[0].to_dict()
        import math
        def clean(v):
            try:
                return None if math.isnan(float(v)) else float(v)
            except: return None
        return {
            'price':     clean(row.get('Price')),
            'change':    clean(row.get('Change %')),
            'rsi':       clean(row.get('Relative Strength Index (14)')),
            'macd':      clean(row.get('MACD Level (12, 26)')),
            'macd_sig':  clean(row.get('MACD Signal (12, 26)')),
            'sma20':     clean(row.get('Simple Moving Average (20)')),
            'sma50':     clean(row.get('Simple Moving Average (50)')),
            'sma200':    clean(row.get('Simple Moving Average (200)')),
            'bb_upper':  clean(row.get('Bollinger Upper Band (20)')),
            'bb_lower':  clean(row.get('Bollinger Lower Band (20)')),
            'atr':       clean(row.get('Average True Range (14)')),
            'stoch_k':   clean(row.get('Stochastic %K (14, 3, 3)')),
            'tv_rating': clean(row.get('Recommend.All')),
        }
    except Exception as e:
        return None

def groq_decision(ticker: str, tech: dict, portfolio_value: float) -> dict | None:
    """Ask Groq LLM for BUY/SELL/HOLD decision"""
    try:
        p = tech
        prompt = f"""Analyse {ticker} for a ${portfolio_value:,.0f} portfolio. Give a trading decision.

Price: ${p.get('price',0):.2f} | Change: {p.get('change',0):+.2f}%
RSI: {p.get('rsi',50):.1f} | MACD: {p.get('macd',0):.4f} vs Signal: {p.get('macd_sig',0):.4f}
SMA20: ${p.get('sma20',0):.2f} | SMA50: ${p.get('sma50',0):.2f} | SMA200: ${p.get('sma200',0):.2f}
BB Upper: ${p.get('bb_upper',0):.2f} | BB Lower: ${p.get('bb_lower',0):.2f}
Stochastic K: {p.get('stoch_k',50):.1f} | ATR: {p.get('atr',0):.2f}
TV Rating: {p.get('tv_rating',0):.2f} (-1=strong sell, +1=strong buy)

Respond with JSON only: {{"action":"BUY"|"SELL"|"HOLD","stopLoss":<price>,"takeProfit":<price>,"reason":"<1 sentence with numbers>"}}""" 
        data = json.dumps({{
            'model': 'llama-3.3-70b-versatile',
            'messages': [{{'role': 'user', 'content': prompt}}],
            'temperature': 0.2, 'max_tokens': 200,
            'response_format': {{'type': 'json_object'}}
        }}).encode()
        req = urllib.request.Request(GROQ_URL, data=data, headers={{
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {GROQ_KEY}'
        }})
        resp = json.loads(urllib.request.urlopen(req, timeout=15).read())
        content = resp['choices'][0]['message']['content']
        return json.loads(content)
    except:
        return None

def local_screen(portfolio: dict, cash_usd: float, total_usd: float) -> list:
    """Screen using IBKR scanner + IBKR historical data for indicators"""
    held = [p['ticker'] for p in portfolio.get('positions', [])]
    candidates = []
    MIN_RR = 1.5

    try:
        from ib_insync import IB, ScannerSubscription
        ib = IB()
        ib.connect(IBKR_HOST, IBKR_PORT, clientId=30, timeout=15)

        # Run multiple IBKR scans to find candidates
        scan_codes = [
            ('HIGH_VS_13W_HL', 'Breaking 13-week high'),   # momentum
            ('TOP_PERC_GAIN',  'Top % gainer today'),       # momentum
            ('HOT_BY_VOLUME',  'High volume activity'),     # volume surge
        ]

        scan_tickers = set()
        for code, label in scan_codes:
            try:
                sub = ScannerSubscription(
                    instrument='STK', locationCode='STK.US.MAJOR',
                    scanCode=code, numberOfRows=20,
                    abovePrice=20, aboveVolume=500000,
                )
                results = ib.reqScannerData(sub)
                for r in results:
                    sym = r.contractDetails.contract.symbol
                    if sym not in held and len(sym) <= 5 and sym.isalpha():
                        scan_tickers.add(sym)
                log(f'  Scan {code}: {len(results)} results')
            except Exception as e:
                log(f'  Scan {code} error: {e}')

        log(f'  Total unique candidates from scanner: {len(scan_tickers)}')

        # Analyse each candidate
        for ticker in list(scan_tickers)[:20]:  # cap at 20
            if len(candidates) >= 5:
                break
            tech = get_ibkr_technicals(ib, ticker)
            if not tech:
                continue

            price  = tech['price']
            rsi    = tech['rsi']
            sma50  = tech['sma50']
            sma200 = tech['sma200']
            atr    = tech['atr']

            # Trend filter
            above_sma50  = sma50  > 0 and price > sma50
            above_sma200 = sma200 > 0 and price > sma200
            oversold     = rsi < 35
            if not above_sma50 and not above_sma200 and not oversold:
                log(f'  Skip {ticker}: below SMA50/200, RSI {rsi:.0f}')
                continue

            # ATR-based SL/TP
            sl = round(max(price - atr * 1.5, price * 0.92), 2)
            tp = round(min(price + atr * 3.0, price * 1.15), 2)
            risk   = price - sl
            reward = tp - price
            rr     = round(reward / risk, 1) if risk > 0 else 0

            if rr < MIN_RR:
                log(f'  Skip {ticker}: R/R {rr} < {MIN_RR}')
                continue

            reason = (f'IBKR scanner pick. RSI {rsi:.0f}'
                      f'{" (oversold)" if oversold else ""}'
                      f'. {"Above SMA50" if above_sma50 else "Above SMA200" if above_sma200 else ""}'
                      f'. ATR-based SL ${sl} | TP ${tp}. R/R 1:{rr}.')

            candidates.append({'type':'BUY','ticker':ticker,'price':price,
                                'sl':sl,'tp':tp,'reason':reason,'rr':rr})
            log(f'  ✅ {ticker} @ ${price:.2f} | RSI {rsi:.0f} | R/R 1:{rr} | SL ${sl} TP ${tp}')

        ib.disconnect()

    except Exception as e:
        log(f'IBKR screener error: {e}')

    candidates.sort(key=lambda x: x['rr'], reverse=True)
    return candidates


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    log('Starting monitor run')

    # 1. Sync from IBKR
    log('Syncing from IBKR...')
    result = subprocess.run([sys.executable, str(SYNC_SCRIPT)], capture_output=True, text=True, timeout=60)
    try:
        sync = json.loads(result.stdout)
        log(f"Synced: NLV ${sync.get('nlv_usd',0):,.0f}, positions: {sync.get('positions',0)}")
    except:
        log(f'Sync warning: {result.stderr or result.stdout}')

    with open(PORTFOLIO) as f:
        p = json.load(f)

    positions = p.get('positions', [])
    cash_usd  = p['cashByValue'].get('USD', 0)
    total_usd = cash_usd + sum(pos.get('currentPrice', pos['buyPrice']) * pos['shares'] for pos in positions)

    # 2. Check SL/TP on open positions
    for pos in list(positions):
        price = get_live_price(pos['ticker'])
        if not price:
            continue

        # Update current price
        idx = next((i for i,x in enumerate(p['positions']) if x['ticker']==pos['ticker']), -1)
        if idx >= 0:
            p['positions'][idx]['currentPrice'] = price

        sl = pos.get('stopLoss')
        tp = pos.get('takeProfit')
        trigger = None
        reason  = ''

        if sl and price <= sl:
            trigger = 'SELL'
            reason  = f'Stop-loss hit at ${price:.2f} (SL: ${sl:.2f})'
        elif tp and price >= tp:
            trigger = 'SELL'
            reason  = f'Take-profit hit at ${price:.2f} (TP: ${tp:.2f})'

        if trigger:
            shares = pos['shares']
            emoji  = '🟢' if price >= pos['buyPrice'] else '🔴'
            pnl    = (price - pos['buyPrice']) * shares
            signal_ts = time.time()

            msg = (f"⚡ Trade Signal: SELL {shares}x *{pos['ticker']}* @ ${price:.2f}\n"
                   f"Reason: {reason}\n"
                   f"P&L: {'+' if pnl>=0 else ''}${pnl:.0f}\n"
                   f"Executing in 3 mins unless you reject.")
            send_telegram(msg, buttons=[[
                {'text': '✅ Execute Now', 'callback_data': f'APPROVE_SELL_{pos["ticker"]}'},
                {'text': '❌ Reject',      'callback_data': f'REJECT_SELL_{pos["ticker"]}'},
            ]])
            log(f'SL/TP triggered: SELL {shares}x {pos["ticker"]} @ ${price:.2f}')

            decision = await_approval(signal_ts, pos['ticker'], 'SELL')

            if decision == 'REJECT':
                send_telegram(f'❌ Trade cancelled: SELL {shares}x *{pos["ticker"]}*')
                log('Trade rejected by user')
                continue

            # Execute
            ibkr = ibkr_trade('SELL', pos['ticker'], shares, price)
            if ibkr.get('error'):
                send_telegram(f'⚠️ IBKR error: {ibkr["error"]}')
                log(f'IBKR error: {ibkr["error"]}')
                continue

            today = datetime.now().strftime('%Y-%m-%d')
            proceeds = price * shares
            p['cashByValue']['USD'] = round(cash_usd + proceeds, 2)
            p['positions'] = [x for x in p['positions'] if x['ticker'] != pos['ticker']]
            p.setdefault('closedPositions', []).append({
                'ticker': pos['ticker'], 'shares': shares,
                'buyDate': pos.get('buyDate'), 'buyPrice': pos['buyPrice'],
                'sellDate': today, 'sellPrice': price,
                'reason': reason, 'pnl': pnl, 'pnlPct': pnl/(pos['buyPrice']*shares)*100,
                'currency': 'USD'
            })
            p.setdefault('history', []).append({
                'date': today, 'action': 'SELL', 'ticker': pos['ticker'],
                'shares': shares, 'price': price, 'total': proceeds,
                'reason': reason, 'currency': 'USD'
            })
            push_portfolio(p)
            valueK = (p['cashByValue']['USD'] + sum(x.get('currentPrice',x['buyPrice'])*x['shares'] for x in p['positions'])) / 1000
            send_telegram(f'{emoji} Portfolio Trade: SELL {shares}x *{pos["ticker"]}* @ ${price:.2f} — {reason}. P&L: {"+" if pnl>=0 else ""}${abs(pnl):.0f}. Portfolio: ${valueK:.1f}K')
            log(f'SELL executed: {shares}x {pos["ticker"]} @ ${price:.2f}')
            cash_usd = p['cashByValue']['USD']

    # 3. Scan for buy opportunities
    n_positions = len(p['positions'])
    if n_positions >= MAX_POSITIONS:
        log(f'Max positions ({MAX_POSITIONS}) reached, skipping buy scan')
        return

    min_cash   = total_usd * MIN_CASH_RESERVE
    deployable = cash_usd - min_cash
    if deployable < 5000:
        log(f'Insufficient deployable cash (${deployable:.0f}), skipping buy scan')
        return

    # Local screener using tvscreener + Groq LLM
    log('Scanning market locally via tvscreener...')
    candidates = local_screen(p, cash_usd, total_usd)
    log(f'Local screener found {len(candidates)} candidates')

    buys_done = 0
    for trade in candidates:
        if trade.get('type') != 'BUY':
            continue
        if buys_done >= 2:
            break
        if n_positions + buys_done >= MAX_POSITIONS:
            break

        ticker = trade['ticker']
        price  = trade.get('price') or get_live_price(ticker) or 0
        if not price or price != price:  # check for NaN
            continue

        max_cost    = total_usd * MAX_POSITION_PCT
        position_sz = min(deployable, max_cost)
        shares      = int(position_sz / price)
        if shares <= 0:
            continue

        sl = trade.get('sl', round(price * 0.95, 2))
        tp = trade.get('tp', round(price * 1.10, 2))
        reason = trade.get('reason', f'Screener buy signal @ ${price:.2f}')
        cost = shares * price

        signal_ts = time.time()
        msg = (f"⚡ Buy Signal: BUY {shares}x *{ticker}* @ ${price:.2f}\n"
               f"Cost: ~${cost:,.0f} | TP ${tp:.2f} | SL ${sl:.2f}\n"
               f"_{reason[:120]}_\n"
               f"Executing in 3 mins unless you reject.")
        send_telegram(msg, buttons=[[
            {'text': '✅ Execute Now', 'callback_data': f'APPROVE_BUY_{ticker}'},
            {'text': '❌ Reject',      'callback_data': f'REJECT_BUY_{ticker}'},
        ]])
        log(f'Buy signal: {shares}x {ticker} @ ${price:.2f}')

        decision = await_approval(signal_ts, ticker, 'BUY')

        if decision == 'REJECT':
            send_telegram(f'❌ Trade cancelled: BUY {shares}x *{ticker}*')
            log('Buy rejected by user')
            continue

        ibkr = ibkr_trade('BUY', ticker, shares, price)
        if ibkr.get('error'):
            send_telegram(f'⚠️ IBKR error: {ibkr["error"]}')
            log(f'IBKR error: {ibkr["error"]}')
            continue

        today = datetime.now().strftime('%Y-%m-%d')
        p['positions'].append({
            'ticker': ticker, 'shares': shares,
            'avgCost': price, 'buyPrice': price, 'currentPrice': price,
            'buyDate': today, 'stopLoss': sl, 'takeProfit': tp,
            'signal': 'BUY', 'currency': 'USD', 'reason': reason,
            'ibkrOrderId': ibkr.get('orderId'),
        })
        p['cashByValue']['USD'] = round(p['cashByValue']['USD'] - cost, 2)
        p.setdefault('history', []).append({
            'date': today, 'action': 'BUY', 'ticker': ticker,
            'shares': shares, 'price': price, 'total': cost,
            'reason': reason, 'currency': 'USD'
        })
        p.setdefault('strategyNotes', []).append({
            'date': datetime.now().isoformat(),
            'note': f'Bought {shares} {ticker} @ ${price:.2f} (-${cost:,.0f}). SL ${sl} | TP ${tp}. Cash now ${p["cashByValue"]["USD"]:,.0f}.'
        })
        push_portfolio(p)
        valueK = (p['cashByValue']['USD'] + sum(x.get('currentPrice',x['buyPrice'])*x['shares'] for x in p['positions'])) / 1000
        send_telegram(f'🟢 Portfolio Trade: BUY {shares}x *{ticker}* @ ${price:.2f} — {reason[:100]}. TP ${tp:.2f} | SL ${sl:.2f}. Portfolio: ${valueK:.1f}K')
        log(f'BUY executed: {shares}x {ticker} @ ${price:.2f}')
        buys_done += 1
        deployable -= cost
        n_positions += 1

    log('Monitor run complete')

if __name__ == '__main__':
    main()
