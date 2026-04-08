#!/usr/bin/env python3
"""
Fetch TradingView technical data for a US stock ticker via tvscreener.
Usage: python3 tv_quote.py NVDA
Output: JSON with key technical indicators
"""
import sys
import json
import math

def clean(v):
    if v is None: return None
    try:
        if math.isnan(float(v)): return None
    except: pass
    return v

def get_tv_data(ticker: str) -> dict:
    try:
        from tvscreener import StockScreener, StockField, Market, FilterOperator
        sc = StockScreener()
        sc.set_markets(Market.AMERICA)
        sc.add_filter(StockField.NAME, FilterOperator.EQUAL, ticker.upper())
        df = sc.get()
        if df.empty:
            return {'error': f'No data for {ticker}'}

        row = df.iloc[0].to_dict()
        return {
            'ticker': ticker.upper(),
            'price':        clean(row.get('Price', row.get('close', row.get('Close')))),
            'change_pct':   clean(row.get('change', row.get('Change %'))),
            'volume':       clean(row.get('volume', row.get('Volume'))),
            'rsi':          clean(row.get('Relative Strength Index (14)')),
            'macd':         clean(row.get('MACD Level (12, 26)')),
            'macd_signal':  clean(row.get('MACD Signal (12, 26)')),
            'macd_hist':    clean(row.get('MACD Histogram (12, 26)')),
            'sma20':        clean(row.get('Simple Moving Average (20)')),
            'sma50':        clean(row.get('Simple Moving Average (50)')),
            'sma200':       clean(row.get('Simple Moving Average (200)')),
            'ema20':        clean(row.get('Exponential Moving Average (20)')),
            'ema200':       clean(row.get('Exponential Moving Average (200)')),
            'bb_upper':     clean(row.get('Bollinger Upper Band (20)')),
            'bb_lower':     clean(row.get('Bollinger Lower Band (20)')),
            'stoch_k':      clean(row.get('Stochastic %K (14, 3, 3)')),
            'stoch_d':      clean(row.get('Stochastic %D (14, 3, 3)')),
            'atr':          clean(row.get('Average True Range (14)')),
            'week52_high':  clean(row.get('52 Week High')),
            'week52_low':   clean(row.get('52 Week Low')),
            'tv_rating':    clean(row.get('Recommend.All')),      # -1=strong sell, +1=strong buy
            'ma_rating':    clean(row.get('Recommend.MA')),
            'osc_rating':   clean(row.get('Recommend.Other')),
            'analyst_rating': clean(row.get('Analyst Rating')),
            # Candlestick patterns detected (non-zero = active)
            'patterns': {k.replace('Candle.',''):v for k,v in row.items() if k.startswith('Candle.') and v and v != 0},
        }
    except Exception as e:
        return {'error': str(e)}

if __name__ == '__main__':
    ticker = sys.argv[1].upper() if len(sys.argv) > 1 else 'AAPL'
    print(json.dumps(get_tv_data(ticker), indent=2, default=str))
