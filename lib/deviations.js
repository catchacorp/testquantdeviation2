/**
 * AlphaPairs Deviation & OLS Residual Spread Engine
 * Statistical Arbitrage Divergence Detection with Logarithms, OLS Regression, and 20-Day Moving Averages
 * Upstream: Yahoo Finance Market Data API (dual query1/query2 failover)
 */

export const COMPANY_NAMES = {
  META: "Meta Platforms Inc.",
  AMZN: "Amazon.com Inc.",
  AAPL: "Apple Inc.",
  NFLX: "Netflix Inc.",
  GOOGL: "Alphabet Inc. (Google)",
  GOOG: "Alphabet Inc. (Google)",
  MSFT: "Microsoft Corporation",
  NVDA: "NVIDIA Corporation",
  TSLA: "Tesla Inc.",
  AMD: "Advanced Micro Devices Inc.",
  AVGO: "Broadcom Inc.",
  MU: "Micron Technology Inc.",
  VRT: "Vertiv Holdings Co",
  PLTR: "Palantir Technologies Inc.",
  ARM: "Arm Holdings plc",
  SMCI: "Super Micro Computer Inc.",
  TSM: "Taiwan Semiconductor Mfg.",
  INTC: "Intel Corporation",
  QCOM: "Qualcomm Inc.",
  AMAT: "Applied Materials Inc.",
  ORCL: "Oracle Corporation",
  CRM: "Salesforce Inc.",
  ADBE: "Adobe Inc.",
  RIVN: "Rivian Automotive Inc.",
  F: "Ford Motor Company",
  GM: "General Motors Co.",
  TM: "Toyota Motor Corporation",
  JPM: "JPMorgan Chase & Co.",
  BAC: "Bank of America Corp.",
  C: "Citigroup Inc.",
  WFC: "Wells Fargo & Co.",
  MS: "Morgan Stanley",
  GS: "Goldman Sachs Group"
};

/**
 * Fetches dynamic live company profile, name, sector, industry, and live price directly from Yahoo Finance
 */
export async function getCompanyProfile(ticker) {
  const clean = String(ticker).trim().toUpperCase();
  const urlSearch1 = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(clean)}&quotesCount=1`;
  const urlSearch2 = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(clean)}&quotesCount=1`;
  const urlChart1 = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(clean)}?interval=1d&range=5d`;
  const urlChart2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(clean)}?interval=1d&range=5d`;

  const fetchOptions = {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  };

  let name = COMPANY_NAMES[clean] || clean;
  let sector = "Technology & Infrastructure";
  let industry = "General Market Equity";
  let livePrice = 0;
  let previousClose = 0;
  let exchange = "US";

  try {
    let resChart;
    try {
      resChart = await fetch(urlChart1, fetchOptions);
      if (!resChart.ok) resChart = await fetch(urlChart2, fetchOptions);
    } catch {
      resChart = await fetch(urlChart2, fetchOptions).catch(() => null);
    }

    if (resChart && resChart.ok) {
      const jsonChart = await resChart.json();
      const meta = jsonChart?.chart?.result?.[0]?.meta;
      if (meta) {
        name = meta.longName || meta.shortName || name;
        livePrice = meta.regularMarketPrice || meta.chartPreviousClose || 0;
        previousClose = meta.chartPreviousClose || meta.previousClose || 0;
        exchange = meta.exchangeName || exchange;
      }
    }

    let resSearch;
    try {
      resSearch = await fetch(urlSearch1, fetchOptions);
      if (!resSearch.ok) resSearch = await fetch(urlSearch2, fetchOptions);
    } catch {
      resSearch = await fetch(urlSearch2, fetchOptions).catch(() => null);
    }

    if (resSearch && resSearch.ok) {
      const jsonSearch = await resSearch.json();
      const quote = jsonSearch?.quotes?.[0];
      if (quote) {
        if (!name || name === clean) {
          name = quote.longname || quote.shortname || name;
        }
        if (quote.sector || quote.sectorDisp) {
          sector = quote.sectorDisp || quote.sector;
        }
        if (quote.industry || quote.industryDisp) {
          industry = quote.industryDisp || quote.industry;
        }
        if (quote.exchDisp) {
          exchange = quote.exchDisp;
        }
      }
    }
  } catch (err) {
    // Graceful fallback
  }

  return {
    ticker: clean,
    name,
    sector,
    industry,
    live_price: Number(livePrice.toFixed(2)),
    previous_close: Number(previousClose.toFixed(2)),
    exchange
  };
}

export async function detectDeviations({ target, peers, z_threshold = 2.0, lookback_days = 60 }) {
  if (!target || typeof target !== "string") {
    const err = new Error("Target ticker symbol must be specified");
    err.status = 400;
    throw err;
  }

  if (!peers || !Array.isArray(peers) || peers.length === 0) {
    const err = new Error("At least one peer ticker symbol must be provided");
    err.status = 400;
    throw err;
  }

  const cleanTarget = target.trim().toUpperCase();
  // Allow up to 25 peer tickers so new custom tickers (like VRT) are never dropped
  const cleanPeers = [...new Set(peers.map(p => String(p).trim().toUpperCase()))]
    .filter(p => p !== cleanTarget)
    .slice(0, 25);

  if (cleanPeers.length === 0) {
    const err = new Error("At least one distinct peer ticker is required");
    err.status = 400;
    throw err;
  }

  const threshold = Math.min(Math.max(Number(z_threshold) || 2.0, 1.0), 4.0);
  const days = Math.min(Math.max(Number(lookback_days) || 60, 15), 180);

  const allTickers = [cleanTarget, ...cleanPeers];
  const now = Math.floor(Date.now() / 1000);
  const start = now - (days * 86400);

  const pricesByDate = {}; // date -> { [ticker]: close }
  const rawTickerBars = {}; // ticker -> [ { date, close } ]
  const profiles = {}; // ticker -> { name, sector, industry, price, exchange }

  const fetchOptions = {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  };

  // Fetch all tickers with failover
  for (const ticker of allTickers) {
    const url1 = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${now}&interval=1d`;
    const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${now}&interval=1d`;
    let response;

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

    const meta = result.meta || {};
    const timestamps = result.timestamp;
    const closes = result.indicators?.quote?.[0]?.close || [];

    // Extract dynamic genuine live profile from Yahoo Finance
    const livePrice = meta.regularMarketPrice || meta.chartPreviousClose || closes[closes.length - 1] || 0;
    profiles[ticker] = {
      ticker,
      name: meta.longName || meta.shortName || COMPANY_NAMES[ticker] || ticker,
      price: Number(livePrice.toFixed(2)),
      exchange: meta.exchangeName || "US",
      currency: meta.currency || "USD"
    };

    rawTickerBars[ticker] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close != null && close > 0) {
        const date = new Date(timestamps[i] * 1000).toISOString().split("T")[0];
        if (!pricesByDate[date]) {
          pricesByDate[date] = {};
        }
        pricesByDate[date][ticker] = close;
        rawTickerBars[ticker].push({ date, close });
      }
    }
  }

  // Collect all unique dates across all tickers
  const allDatesSet = new Set(Object.keys(pricesByDate));
  const sortedDates = Array.from(allDatesSet).sort();

  // Forward fill missing dates for any ticker to ensure alignment across exchanges
  for (const ticker of allTickers) {
    let lastPrice = null;
    for (const date of sortedDates) {
      if (pricesByDate[date]?.[ticker] != null && pricesByDate[date][ticker] > 0) {
        lastPrice = pricesByDate[date][ticker];
      } else if (lastPrice != null) {
        if (!pricesByDate[date]) pricesByDate[date] = {};
        pricesByDate[date][ticker] = lastPrice;
      }
    }
  }

  // Common dates where all tickers have non-null prices
  const commonDates = sortedDates.filter(d =>
    allTickers.every(t => pricesByDate[d]?.[t] != null && pricesByDate[d][t] > 0)
  );

  if (commonDates.length < 5) {
    const err = new Error("Insufficient overlapping price history to compute OLS regression and spread");
    err.status = 422;
    throw err;
  }

  // Base prices for normalization (day 0 = 1.0)
  const baseTarget = pricesByDate[commonDates[0]][cleanTarget];
  const basePeers = {};
  for (const peer of cleanPeers) {
    basePeers[peer] = pricesByDate[commonDates[0]][peer];
  }

  // Calculate normalized price series and peer composite benchmark
  const Y = []; // Normalized Target
  const X = []; // Normalized Peer Composite
  const rawTargetPrices = [];
  const dates = [];

  for (const date of commonDates) {
    const targetClose = pricesByDate[date][cleanTarget];
    const normTarget = targetClose / baseTarget;

    let peerComposite = 0;
    for (const peer of cleanPeers) {
      peerComposite += (pricesByDate[date][peer] / basePeers[peer]);
    }
    peerComposite /= cleanPeers.length;

    Y.push(normTarget);
    X.push(peerComposite);
    rawTargetPrices.push(targetClose);
    dates.push(date);
  }

  // Ordinary Least Squares (OLS) regression: Y = alpha + beta * X + epsilon
  const N = commonDates.length;
  const meanX = X.reduce((a, b) => a + b, 0) / N;
  const meanY = Y.reduce((a, b) => a + b, 0) / N;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < N; i++) {
    numerator += (X[i] - meanX) * (Y[i] - meanY);
    denominator += Math.pow(X[i] - meanX, 2);
  }

  const beta = denominator !== 0 ? numerator / denominator : 1.0;
  const alpha = meanY - beta * meanX;

  // Residual spread and R-squared
  const residuals = [];
  let ssTot = 0;
  let ssRes = 0;

  for (let i = 0; i < N; i++) {
    const fitted = alpha + beta * X[i];
    const res = Y[i] - fitted;
    residuals.push(res);
    ssTot += Math.pow(Y[i] - meanY, 2);
    ssRes += Math.pow(res, 2);
  }

  const rSquared = ssTot > 0 ? Math.max(0, 1 - (ssRes / ssTot)) : 0;

  // Calculate residual sample mean & standard deviation
  const meanResidual = residuals.reduce((a, b) => a + b, 0) / N;
  const varResidual = residuals.reduce((a, b) => a + Math.pow(b - meanResidual, 2), 0) / (N - 1);
  const stdResidual = Math.sqrt(varResidual) || 0.0001;

  // Compute 20-Day Simple Moving Average (SMA) for Target
  const smaWindow = 20;
  const points = [];

  for (let i = 0; i < N; i++) {
    const fitted = alpha + beta * X[i];
    const res = residuals[i];
    const zScore = (res - meanResidual) / stdResidual;
    const spreadPct = fitted > 0 ? ((Y[i] - fitted) / fitted) * 100 : 0;

    const windowStart = Math.max(0, i - smaWindow + 1);
    const windowPrices = rawTargetPrices.slice(windowStart, i + 1);
    const targetSma = windowPrices.reduce((a, b) => a + b, 0) / windowPrices.length;

    points.push({
      date: dates[i],
      target_price: Number(rawTargetPrices[i].toFixed(2)),
      target_sma_20: Number(targetSma.toFixed(2)),
      benchmark_normalized: Number(X[i].toFixed(4)),
      target_normalized: Number(Y[i].toFixed(4)),
      residual: Number(res.toFixed(4)),
      z_score: Number(zScore.toFixed(2)),
      spread_pct: Number(spreadPct.toFixed(2))
    });
  }

  // Detect statistical divergence episodes (|Z| >= threshold)
  const episodes = [];
  let inEpisode = false;
  let currentEpisode = null;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const absZ = Math.abs(pt.z_score);

    if (absZ >= threshold) {
      if (!inEpisode) {
        inEpisode = true;
        currentEpisode = {
          episode_id: `ep-${episodes.length + 1}`,
          target: cleanTarget,
          peer_basket: cleanPeers,
          direction: pt.z_score > 0 ? "divergence_above" : "divergence_below",
          start_date: pt.date,
          peak_date: pt.date,
          peak_z_score: pt.z_score,
          peak_spread_pct: pt.spread_pct,
          duration_days: 1,
          collapse_date: null,
          status: "active",
          internal_rationale: pt.z_score > 0
            ? `${profiles[cleanTarget]?.name || cleanTarget} experienced an idiosyncratic upside catalyst (such as earnings beat, new customer design win, or accelerated backlog) that caused it to pull away from its peer group.`
            : `${profiles[cleanTarget]?.name || cleanTarget} suffered company-specific friction (such as guidance variance, margin compression, or component delivery delay) that caused it to lag behind peers.`,
          external_rationale: pt.z_score > 0
            ? `Capital rotation into high-beta market leaders during macroeconomic uncertainty or sector-specific AI/technology infrastructure momentum.`
            : `Broader supply-chain constraints, elevated interest rate sensitivity, or temporary sector-wide profit-taking disproportionately hitting this equity.`
        };
      } else {
        currentEpisode.duration_days += 1;
        if (Math.abs(pt.z_score) > Math.abs(currentEpisode.peak_z_score)) {
          currentEpisode.peak_date = pt.date;
          currentEpisode.peak_z_score = pt.z_score;
          currentEpisode.peak_spread_pct = pt.spread_pct;
        }
      }
    } else {
      if (inEpisode) {
        inEpisode = false;
        currentEpisode.collapse_date = pt.date;
        currentEpisode.status = "mean_reverted";
        episodes.push(currentEpisode);
        currentEpisode = null;
      }
    }
  }

  if (inEpisode && currentEpisode) {
    episodes.push(currentEpisode);
  }

  episodes.sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());

  // Real-time "Right Now" analysis across target and all peers
  const latestDate = commonDates[commonDates.length - 1];
  const lookbackStart5 = Math.max(0, commonDates.length - 5);

  const rightNowSummary = allTickers.map(t => {
    const latestPrice = pricesByDate[latestDate][t];
    const tPrices = commonDates.map(d => pricesByDate[d][t]);
    const recent20 = tPrices.slice(-20);
    const sma20 = recent20.reduce((a, b) => a + b, 0) / recent20.length;
    const vsSmaPct = ((latestPrice - sma20) / sma20) * 100;

    const price5Ago = pricesByDate[commonDates[lookbackStart5]][t];
    const return5d = ((latestPrice - price5Ago) / price5Ago) * 100;

    let peerAvgReturn5d = 0;
    const otherTickers = allTickers.filter(x => x !== t);
    for (const ot of otherTickers) {
      const pNow = pricesByDate[latestDate][ot];
      const pOld = pricesByDate[commonDates[lookbackStart5]][ot];
      peerAvgReturn5d += (((pNow - pOld) / pOld) * 100);
    }
    peerAvgReturn5d /= Math.max(1, otherTickers.length);

    const relativePerf = return5d - peerAvgReturn5d;

    let signal = "TRENDING IN-SYNC";
    let action = "NEUTRAL / HOLD";
    let statusClass = "neutral";
    let plainEnglish = "Trading comfortably alongside its peer group. Fairly valued right now.";

    if (relativePerf <= -2.5 || vsSmaPct <= -3.0) {
      signal = "SIGNIFICANT LAG (OVERSOLD)";
      action = "POTENTIAL BUY";
      statusClass = "buy";
      plainEnglish = `Has lagged behind its peers by ${Math.abs(relativePerf).toFixed(1)}% recently. Like a discount on a good brand, it may bounce back to rejoin the family.`;
    } else if (relativePerf >= 2.5 || vsSmaPct >= 3.0) {
      signal = "SIGNIFICANT SURGE (OVERBOUGHT)";
      action = "POTENTIAL SHORT SELL";
      statusClass = "short";
      plainEnglish = `Has sprinted ${relativePerf.toFixed(1)}% ahead of its peers. Like a runner who sprinted too fast, it may tire out and slow down back to the group.`;
    }

    return {
      ticker: t,
      company_name: profiles[t]?.name || COMPANY_NAMES[t] || t,
      is_target: t === cleanTarget,
      latest_price: Number(latestPrice.toFixed(2)),
      sma_20: Number(sma20.toFixed(2)),
      vs_sma_pct: Number(vsSmaPct.toFixed(2)),
      return_5d_pct: Number(return5d.toFixed(2)),
      relative_perf_pct: Number(relativePerf.toFixed(2)),
      signal,
      action,
      status_class: statusClass,
      plain_english: plainEnglish
    };
  });

  // Query sector & industry for cleanTarget
  let targetSector = "Technology & Infrastructure";
  let targetIndustry = "General Market & Cloud Ecosystem";
  try {
    const prof = await getCompanyProfile(cleanTarget);
    if (prof.sector) targetSector = prof.sector;
    if (prof.industry) targetIndustry = prof.industry;
  } catch {}

  return {
    source: "AlphaPairs Statistical Arbitrage Engine (Yahoo Finance)",
    fetched_at: new Date().toISOString(),
    target: cleanTarget,
    target_name: profiles[cleanTarget]?.name || COMPANY_NAMES[cleanTarget] || cleanTarget,
    target_sector: targetSector,
    target_industry: targetIndustry,
    target_price: profiles[cleanTarget]?.price || pricesByDate[latestDate][cleanTarget],
    peers: cleanPeers,
    lookback_days: days,
    z_threshold: threshold,
    latest_date: latestDate,
    model: {
      alpha: Number(alpha.toFixed(4)),
      beta: Number(beta.toFixed(4)),
      r_squared: Number(rSquared.toFixed(4)),
      residual_std: Number(stdResidual.toFixed(4))
    },
    profiles,
    right_now: rightNowSummary,
    episodes: episodes.slice(0, 15),
    residual_points: points.slice(-20)
  };
}
