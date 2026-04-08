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

MAX_POSITIONS    = 8
MIN_CASH_RESERVE = 0.15  # 15% cash reserve
MAX_POSITION_PCT = 0.15  # 15% max per position (matches Vercel screener settings)


# ── Helpers ───────────────────────────────────────────────────────────────────
def log(msg): print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def kv_set(data: dict):
    req = urllib.request.Request(f'{KV_URL}/set/portfolio',
        data=json.dumps(data).encode(),
        headers={'Authorization': f'Bearer {KV_TOKEN}', 'Content-Type': 'application/json'},
        method='POST')
    urllib.request.urlopen(req, timeout=10)

def send_telegram(msg: str, buttons=None) -> int | None:
    try:
        body: dict = {'chat_id': TG_CHAT, 'text': msg, 'parse_mode': 'Markdown'}
        if buttons:
            body['reply_markup'] = {'inline_keyboard': buttons}
        data = json.dumps(body).encode()
        req = urllib.request.Request(f'https://api.telegram.org/bot{TG_TOKEN}/sendMessage',
            data=data, headers={'Content-Type': 'application/json'})
        resp = json.loads(urllib.request.urlopen(req, timeout=10).read())
        return resp.get('result', {}).get('message_id')
    except Exception as e:
        log(f'Telegram send failed: {e}')
        return None

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

def propose_trade(action: str, ticker: str, shares: int, price: float, sl: float, tp: float, reason: str, rsi: float = 0, volume: int = 0):
    """Send trade proposal via Telegram — execution handled by main OpenClaw session."""
    import subprocess
    script = str(Path(__file__).parent / 'propose_trade.py')
    subprocess.run([sys.executable, script, action, ticker, str(shares),
                    str(price), str(sl), str(tp), reason[:120],
                    str(round(rsi, 1)), str(int(volume))],
                   capture_output=True, timeout=15)

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

def local_screen(portfolio: dict, cash_usd: float, total_usd: float) -> list:
    """Screen using IBKR scanner + IBKR historical data for indicators"""
    held = [p['ticker'] for p in portfolio.get('positions', [])]
    candidates = []
    MIN_RR = 2.0  # Min 1:2 R/R

    try:
        from ib_insync import IB, ScannerSubscription
        ib = IB()
        ib.connect(IBKR_HOST, IBKR_PORT, clientId=30, timeout=15)

        # Run multiple IBKR scans to find candidates
        scan_codes = [
            ('HIGH_VS_13W_HL', 'Breaking 13-week high — momentum'),
            ('TOP_PERC_GAIN',  'Top % gainer — strong momentum'),
        ]

        scan_tickers = set()
        for code, label in scan_codes:
            try:
                sub = ScannerSubscription(
                    instrument='STK', locationCode='STK.US.MAJOR',
                    scanCode=code, numberOfRows=15,
                    abovePrice=25,          # min $25
                    aboveVolume=2000000,    # min 2M volume
                    belowPrice=1000,        # exclude ultra-high-priced
                    marketCapAbove=2000e6,  # min $2B market cap
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

            # Stricter trend filter: must be above SMA200 OR clearly oversold (RSI<40)
            above_sma200 = sma200 > 0 and price > sma200
            oversold     = rsi < 40
            if not above_sma200 and not oversold:
                log(f'  Skip {ticker}: below SMA200, RSI {rsi:.0f}')
                continue
            # Also skip if RSI > 75 (overbought)
            if rsi > 75:
                log(f'  Skip {ticker}: overbought RSI {rsi:.0f}')
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
                                'sl':sl,'tp':tp,'reason':reason,'rr':rr,
                                'rsi':rsi,'volume':0})
            log(f'  ✅ {ticker} @ ${price:.2f} | RSI {rsi:.0f} | R/R 1:{rr} | SL ${sl} TP ${tp}')

        ib.disconnect()

    except Exception as e:
        log(f'IBKR screener error: {e}')

    candidates.sort(key=lambda x: x['rr'], reverse=True)
    return candidates[:1]  # Only best candidate per run — avoid overwhelming


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
    total_usd = cash_usd + sum((pos.get('currentPrice') or pos.get('buyPrice') or 0) * pos['shares'] for pos in positions)

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
            pnl = (price - pos['buyPrice']) * shares
            full_reason = f"{reason} P&L if sold: {'+' if pnl>=0 else ''}${pnl:.0f}"
            propose_trade('SELL', pos['ticker'], shares, price,
                          pos.get('stopLoss', round(price*0.95,2)),
                          pos.get('takeProfit', round(price*1.08,2)),
                          full_reason)
            log(f'SL/TP signal proposed: SELL {shares}x {pos["ticker"]} @ ${price:.2f}')

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
        if not price or price != price or price <= 0:
            continue
        shares      = int(position_sz / price)
        if shares <= 0:
            continue
        if shares <= 0:
            continue

        sl = trade.get('sl', round(price * 0.95, 2))
        tp = trade.get('tp', round(price * 1.10, 2))
        reason = trade.get('reason', f'Screener buy signal @ ${price:.2f}')
        cost = shares * price

        msg = (f"⚡ Buy Signal: BUY {shares}x *{ticker}* @ ${price:.2f}\n"
               f"Cost: ~${cost:,.0f} | TP ${tp:.2f} | SL ${sl:.2f}\n"
               f"_{reason[:120]}_\n"
               f"Executing in 3 mins unless you reject.")
        send_telegram(msg, buttons=[[
            {'text': '✅ Execute Now', 'callback_data': f'APPROVE_BUY_{ticker}'},
            {'text': '❌ Reject',      'callback_data': f'REJECT_BUY_{ticker}'},
        ]])
        propose_trade('BUY', ticker, shares, price, sl, tp, reason,
                     rsi=trade.get('rsi', 0), volume=trade.get('volume', 0))
        log(f'Buy signal proposed: {shares}x {ticker} @ ${price:.2f}')
        buys_done += 1
        deployable -= cost
        n_positions += 1

    log('Monitor run complete')

if __name__ == '__main__':
    main()
