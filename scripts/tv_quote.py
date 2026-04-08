#!/usr/bin/env python3
"""
Fetch TradingView technical data for a US stock ticker.
Usage: python3 tv_quote.py AAPL
Output: JSON with full technical indicators
"""
import sys
import json

def get_tv_data(ticker: str) -> dict:
    try:
        from tvscreener import ScreenerClient, Market
        client = ScreenerClient()
        # Try NASDAQ first, then NYSE
        for exchange in ['NASDAQ', 'NYSE', 'AMEX']:
            symbol = f"{exchange}:{ticker}"
            try:
                result = client.query(
                    market=Market.AMERICA,
                    symbols=[symbol],
                    fields=[
                        'name', 'close', 'change', 'change_abs', 'volume',
                        'Relative_Strength_Index_14',
                        'MACD_macd_12_26',
                        'MACD_signal_12_26',
                        'MACD_hist_12_26',
                        'SMA_20', 'SMA_50', 'SMA_200',
                        'EMA_20', 'EMA_50', 'EMA_200',
                        'BB_upper_20', 'BB_lower_20',
                        'Stoch_K_14_3_3', 'Stoch_D_14_3_3',
                        'ATR_14',
                        'Recommend.All',
                        'Recommend.MA',
                        'Recommend.Other',
                        'price_52_week_high',
                        'price_52_week_low',
                    ]
                )
                if result and len(result) > 0:
                    row = result.iloc[0]
                    return {
                        'ticker': ticker,
                        'exchange': exchange,
                        'price': row.get('close'),
                        'change_pct': row.get('change'),
                        'volume': row.get('volume'),
                        'rsi': row.get('Relative_Strength_Index_14'),
                        'macd': row.get('MACD_macd_12_26'),
                        'macd_signal': row.get('MACD_signal_12_26'),
                        'macd_hist': row.get('MACD_hist_12_26'),
                        'sma20': row.get('SMA_20'),
                        'sma50': row.get('SMA_50'),
                        'sma200': row.get('SMA_200'),
                        'ema20': row.get('EMA_20'),
                        'ema200': row.get('EMA_200'),
                        'bb_upper': row.get('BB_upper_20'),
                        'bb_lower': row.get('BB_lower_20'),
                        'stoch_k': row.get('Stoch_K_14_3_3'),
                        'stoch_d': row.get('Stoch_D_14_3_3'),
                        'atr': row.get('ATR_14'),
                        'tv_rating': row.get('Recommend.All'),  # -1 strong sell to +1 strong buy
                        'week52_high': row.get('price_52_week_high'),
                        'week52_low': row.get('price_52_week_low'),
                    }
            except Exception:
                continue
        return {'error': f'No data found for {ticker}'}
    except ImportError:
        return {'error': 'tvscreener not installed'}
    except Exception as e:
        return {'error': str(e)}

if __name__ == '__main__':
    ticker = sys.argv[1].upper() if len(sys.argv) > 1 else 'AAPL'
    print(json.dumps(get_tv_data(ticker), indent=2, default=str))
