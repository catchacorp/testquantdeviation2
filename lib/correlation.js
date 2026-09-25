/**
 * AlphaPairs Pearson Correlation Engine
 * Continuous Logarithmic Returns Matrix
 * Upstream: Yahoo Finance Market Data API
 */

export async function calculateCorrelation({ tickers, lookback_days = 60 }) {
  if (!tickers || !Array.isArray(tickers) || tickers.length < 2) {
    const err = new Error("At least 2 tickers are required to calculate correlation");
    err.status = 400;
    throw err;
  }

  const cleanTickers = [...new Set(tickers.map(t => String(t).trim().toUpperCase()))].slice(0, 10);
  if (cleanTickers.length < 2) {
    const err = new Error("At least 2 unique tickers are required");
    err.status = 400;
    throw err;
  }

  const days = Math.min(Math.max(Number(lookback_days) || 60, 10), 252);
  const now = Math.floor(Date.now() / 1000);
  const start = now - (days * 86400);

  // Fetch prices for all tickers
  const pricesByDate = {}; // date -> { [ticker]: close }

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
      const err = new Error(`No historical data records returned for ticker ${ticker}`);
      err.status = 404;
      throw err;
    }

    const timestamps = result.timestamp;
    const closes = result.indicators?.quote?.[0]?.close || [];

    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close != null && close > 0) {
        const date = new Date(timestamps[i] * 1000).toISOString().split("T")[0];
        if (!pricesByDate[date]) {
          pricesByDate[date] = {};
        }
        pricesByDate[date][ticker] = close;
      }
    }
  }

  // Find common trading dates where all tickers have closing prices
  const sortedDates = Object.keys(pricesByDate).sort();
  const commonDates = sortedDates.filter(d =>
    cleanTickers.every(t => pricesByDate[d][t] != null)
  );

  if (commonDates.length < 5) {
    const err = new Error("Insufficient overlapping trading dates to compute Pearson correlation");
    err.status = 422;
    throw err;
  }

  // Calculate continuous logarithmic returns: r_t = ln(P_t / P_{t-1})
  const logReturns = {};
  for (const ticker of cleanTickers) {
    logReturns[ticker] = [];
    for (let i = 1; i < commonDates.length; i++) {
      const prevPrice = pricesByDate[commonDates[i - 1]][ticker];
      const currPrice = pricesByDate[commonDates[i]][ticker];
      logReturns[ticker].push(Math.log(currPrice / prevPrice));
    }
  }

  const sampleSize = commonDates.length - 1;

  // Compute mean and standard deviation for each ticker
  const stats = {};
  for (const ticker of cleanTickers) {
    const series = logReturns[ticker];
    const mean = series.reduce((sum, val) => sum + val, 0) / sampleSize;
    const variance = series.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (sampleSize - 1);
    const std = Math.sqrt(variance);
    stats[ticker] = { mean, std };
  }

  // Compute NxN correlation matrix
  const matrix = {};
  const pairs = [];

  for (let i = 0; i < cleanTickers.length; i++) {
    const tA = cleanTickers[i];
    matrix[tA] = {};
    for (let j = 0; j < cleanTickers.length; j++) {
      const tB = cleanTickers[j];
      if (i === j) {
        matrix[tA][tB] = 1.0;
      } else {
        const seriesA = logReturns[tA];
        const seriesB = logReturns[tB];
        const meanA = stats[tA].mean;
        const meanB = stats[tB].mean;
        const stdA = stats[tA].std;
        const stdB = stats[tB].std;

        let covariance = 0;
        for (let k = 0; k < sampleSize; k++) {
          covariance += (seriesA[k] - meanA) * (seriesB[k] - meanB);
        }
        covariance /= (sampleSize - 1);

        const corr = (stdA > 0 && stdB > 0) ? covariance / (stdA * stdB) : 0;
        const clampedCorr = Math.max(-1, Math.min(1, Number(corr.toFixed(4))));
        matrix[tA][tB] = clampedCorr;

        if (i < j) {
          pairs.push({
            pair: `${tA}/${tB}`,
            ticker_a: tA,
            ticker_b: tB,
            correlation: clampedCorr
          });
        }
      }
    }
  }

  // Sort pairs by absolute correlation descending
  pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  return {
    source: "Yahoo Finance Market Data Engine",
    fetched_at: new Date().toISOString(),
    tickers: cleanTickers,
    lookback_days: days,
    trading_days_analyzed: sampleSize,
    matrix,
    pairs: pairs.slice(0, 20)
  };
}
