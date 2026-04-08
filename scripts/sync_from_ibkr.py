#!/usr/bin/env python3
"""
Sync Finance Seer portfolio.json from IBKR paper account.
Run this to pull actual positions + cash from IBKR and overwrite portfolio.json.

Usage: python3 sync_from_ibkr.py
"""
import json, sys
from datetime import datetime
from pathlib import Path
from ib_insync import IB, Stock

HOST = '172.23.160.1'
PORT = 4002
ACCOUNT = 'DU7992310'
PORTFOLIO_PATH = Path(__file__).parent.parent / 'data' / 'portfolio.json'
SGD_USD_FALLBACK = 0.7854

def get_sgd_usd(ib=None) -> float:
    """Get live SGD/USD rate via exchange-rates skill (XE.com)"""
    import subprocess
    try:
        result = subprocess.run(
            ['node', '/home/joobi/.openclaw/workspace/skills/exchange-rates/scripts/xe-rate.mjs', 'SGD', 'USD'],
            capture_output=True, text=True, timeout=15
        )
        data = json.loads(result.stdout)
        rate = float(data.get('rate', 0))
        if rate > 0:
            return rate
    except:
        pass
    return SGD_USD_FALLBACK

def main():
    ib = IB()
    try:
        ib.connect(HOST, PORT, clientId=20, timeout=15)
    except Exception as e:
        print(json.dumps({'error': f'Connection failed: {e}'}))
        sys.exit(1)

    try:
        # Get account summary
        summary = {s.tag: float(s.value) for s in ib.accountSummary(ACCOUNT)
                   if s.currency in ('SGD', 'USD', '') and s.tag in
                   ('NetLiquidation', 'TotalCashValue', 'UnrealizedPnL', 'RealizedPnL')}

        rate = get_sgd_usd(ib)
        nlv_sgd = summary.get('NetLiquidation', 0)
        cash_sgd = summary.get('TotalCashValue', 0)
        nlv_usd = round(nlv_sgd * rate, 2)
        cash_usd = round(cash_sgd * rate, 2)

        # Load existing portfolio first (needed to preserve position data)
        try:
            with open(PORTFOLIO_PATH) as f:
                portfolio = json.load(f)
        except:
            portfolio = {}

        # Get positions
        ibkr_positions = ib.positions(ACCOUNT)
        positions = []
        for pos in ibkr_positions:
            if pos.position == 0:
                continue
            ticker = pos.contract.symbol
            shares = int(pos.position)
            avg_cost = round(pos.avgCost, 4)

            # Get current price
            try:
                contract = Stock(ticker, 'SMART', 'USD')
                ib.qualifyContracts(contract)
                mkt = ib.reqMktData(contract, '', False, False)
                ib.sleep(1)
                current_price = round(mkt.last or mkt.close or avg_cost, 4)
                ib.cancelMktData(contract)
            except:
                current_price = avg_cost

            # Preserve existing position data (reason, SL, TP, signal, buyDate)
            existing = next((x for x in (portfolio.get('positions') or []) if x.get('ticker') == ticker), {})
            positions.append({
                'ticker': ticker,
                'shares': shares,
                'avgCost': existing.get('avgCost', avg_cost),
                'buyPrice': existing.get('buyPrice', avg_cost),
                'currentPrice': current_price,
                'buyDate': existing.get('buyDate', datetime.now().strftime('%Y-%m-%d')),
                'signal': existing.get('signal', 'HOLD'),
                'currency': 'USD',
                'reason': existing.get('reason', f'Position synced from IBKR @ ${avg_cost:.2f}'),
                'stopLoss': existing.get('stopLoss', round(avg_cost * 0.95, 2)),
                'takeProfit': existing.get('takeProfit', round(avg_cost * 1.10, 2)),
                'ibkrOrderId': existing.get('ibkrOrderId'),
            })

        today = datetime.now().strftime('%Y-%m-%d')

        # Update only positions and cash — preserve history, watchlist, settings
        portfolio['positions'] = positions
        portfolio['cashByValue'] = {'USD': cash_usd}
        portfolio['startingCapital'] = portfolio.get('startingCapital', nlv_usd)
        portfolio['ibkrNLV'] = {'sgd': nlv_sgd, 'usd': nlv_usd, 'rate': rate, 'syncedAt': datetime.utcnow().isoformat() + 'Z'}

        # Update value history
        history = portfolio.get('valueHistory', [])
        if not history or history[-1]['date'] != today:
            history.append({'date': today, 'value': nlv_usd})
        else:
            history[-1]['value'] = nlv_usd
        portfolio['valueHistory'] = history

        # Sanitize: replace NaN/Inf with None before writing
        import math
        def sanitize(obj):
            if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
                return None
            if isinstance(obj, dict):
                return {k: sanitize(v) for k, v in obj.items()}
            if isinstance(obj, list):
                return [sanitize(v) for v in obj]
            return obj
        portfolio = sanitize(portfolio)

        with open(PORTFOLIO_PATH, 'w') as f:
            json.dump(portfolio, f, indent=2)

        # Also push to Upstash KV so Vercel dashboard stays in sync
        kv_url = 'https://clean-eagle-92052.upstash.io'
        kv_token = 'gQAAAAAAAWeUAAIncDFiZmRiYzc1NDY1YjI0NjU3YTYwMzc4Y2Y4ZTIxZWUzNHAxOTIwNTI'
        try:
            import urllib.request as ur
            req = ur.Request(f'{kv_url}/set/portfolio',
                data=json.dumps(portfolio).encode(),
                headers={'Authorization': f'Bearer {kv_token}', 'Content-Type': 'application/json'},
                method='POST')
            ur.urlopen(req, timeout=10)
        except Exception as kv_err:
            import sys
            print(f'KV sync warning: {kv_err}', file=sys.stderr)

        print(json.dumps({
            'synced': True,
            'nlv_usd': nlv_usd,
            'cash_usd': cash_usd,
            'positions': len(positions),
            'rate': rate,
        }))

    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
    finally:
        ib.disconnect()

if __name__ == '__main__':
    main()
