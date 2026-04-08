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
    try:
        import urllib.request
        url = 'https://query2.finance.yahoo.com/v8/finance/chart/SGDUSD=X?interval=1d&range=1d'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        data = json.loads(urllib.request.urlopen(req, timeout=10).read())
        return float(data['chart']['result'][0]['meta']['regularMarketPrice'])
    except:
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

            positions.append({
                'ticker': ticker,
                'shares': shares,
                'avgCost': avg_cost,
                'buyPrice': avg_cost,
                'currentPrice': current_price,
                'buyDate': datetime.now().strftime('%Y-%m-%d'),
                'signal': 'HOLD',
                'currency': 'USD',
                'reason': 'Synced from IBKR',
                'stopLoss': round(avg_cost * 0.95, 2),
                'takeProfit': round(avg_cost * 1.10, 2),
            })

        today = datetime.now().strftime('%Y-%m-%d')

        # Load existing portfolio to preserve history, watchlist etc.
        try:
            with open(PORTFOLIO_PATH) as f:
                portfolio = json.load(f)
        except:
            portfolio = {}

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

        with open(PORTFOLIO_PATH, 'w') as f:
            json.dump(portfolio, f, indent=2)

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
