/**
 * AlphaPairs Market Data Service
 * Upstream: Yahoo Finance Chart API
 */

export async function fetchMarketData({ tickers, lookback_days = 30 }) {
  if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
    const err = new Error("At least one ticker must be provided");
    err.status = 400;
    throw err;
  }

  const cleanTickers = tickers.slice(0, 20).map(t => String(t).trim().toUpperCase());
  const days = Math.min(Math.max(Number(lookback_days) || 30, 5), 120);

  const now = Math.floor(Date.now() / 1000);
  const start = now - (days * 86400);

  const tickerData = {};
  const summaries = [];

  for (const ticker of cleanTickers) {
    const url1 = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${now}&interval=1d`;
    const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${now}&interval=1d`;
    let response;
    const fetchOptions = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    };

    try {
      response = await fetch(url1, fetchOptions);
      if (!response.ok) {
        response = await fetch(url2, fetchOptions);
      }
    } catch (networkErr) {
      try {
        response = await fetch(url2, fetchOptions);
      } catch (err2) {
        const err = new Error(`Network failure connecting to Yahoo Finance API: ${networkErr.message}`);
        err.status = 502;
        throw err;
      }
    }

    if (!response.ok) {
      const err = new Error(`Yahoo Finance API returned error for ticker ${ticker}`);
      err.status = response.status;
      throw err;
    }

    const json = await response.json();
    const result = json?.chart?.result?.[0];
    if (!result || !result.timestamp || result.timestamp.length === 0) {
      const err = new Error(`No market data records returned for ticker ${ticker}`);
      err.status = 404;
      throw err;
    }

    const timestamps = result.timestamp;
    const quote = result.indicators?.quote?.[0] || {};
    const bars = [];

    for (let i = 0; i < timestamps.length; i++) {
      const close = quote.close?.[i];
      const open = quote.open?.[i];
      if (close != null && open != null) {
        bars.push({
          date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
          open: Number(open.toFixed(2)),
          high: Number((quote.high?.[i] ?? open).toFixed(2)),
          low: Number((quote.low?.[i] ?? open).toFixed(2)),
          close: Number(close.toFixed(2)),
          volume: quote.volume?.[i] ?? 0
        });
      }
    }

    // Up to 20 recent daily OHLCV bars per ticker
    const recentBars = bars.slice(-20);
    tickerData[ticker] = recentBars;

    if (recentBars.length > 0) {
      const latest = recentBars[recentBars.length - 1];
      const previous = recentBars.length > 1 ? recentBars[recentBars.length - 2] : latest;
      const changePct = previous.close > 0 ? Number((((latest.close - previous.close) / previous.close) * 100).toFixed(2)) : 0;
      summaries.push({
        ticker,
        latest_date: latest.date,
        close: latest.close,
        change_pct: changePct,
        bars_count: recentBars.length
      });
    }
  }

  return {
    source: "Yahoo Finance Market Data API",
    fetched_at: new Date().toISOString(),
    tickers: cleanTickers,
    lookback_days: days,
    data: tickerData,
    summaries: summaries.slice(0, 20)
  };
}
