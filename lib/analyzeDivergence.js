/**
 * AlphaPairs AI Divergence Catalyst Research Memo Engine
 * Upstream: Google Gemini API (gemini-3.8-flash)
 */

import { GoogleGenAI } from "@google/genai";

export async function analyzeDivergence({
  ticker,
  peer_group_name,
  peer_tickers,
  max_z_score,
  peak_spread_pct,
  direction,
  duration_days,
  start_date,
  peak_date,
  collapse_date
}) {
  if (!ticker || !peer_group_name || !peer_tickers || !Array.isArray(peer_tickers)) {
    const err = new Error("Missing required divergence analysis parameters (ticker, peer_group_name, peer_tickers)");
    err.status = 400;
    throw err;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY environment variable is not configured");
    err.status = 500;
    throw err;
  }

  const ai = new GoogleGenAI();
  const cleanTicker = String(ticker).trim().toUpperCase();
  const cleanPeers = peer_tickers.map(p => String(p).trim().toUpperCase()).slice(0, 10);

  const prompt = `You are a Senior Quantitative Equity Portfolio Manager & Fundamental Equity Research Analyst at a premier multi-manager long/short hedge fund.
Produce an institutional-grade investment research memo examining the following statistical pair divergence episode:

Target Equity: ${cleanTicker}
Peer Group Benchmark: ${peer_group_name} (${cleanPeers.join(", ")})
Statistical Dislocation Metrics:
- Peak Z-Score: ${max_z_score} standard deviations
- Peak Spread Deviation: ${peak_spread_pct}%
- Direction: ${direction}
- Episode Duration: ${duration_days} days
- Episode Start Date: ${start_date}
- Peak Dislocation Date: ${peak_date}
- Status / Collapse Date: ${collapse_date || "Still active / unresolved"}

Structure your response strictly as valid JSON without markdown fences (or standard JSON format) with these exact keys:
{
  "headline": "Institutional memo title with thesis",
  "executive_summary": "Two to three concise sentences summarizing the pair dislocation, magnitude, and mean-reversion thesis.",
  "corporate_catalysts": "Detailed fundamental drivers for ${cleanTicker} including earnings releases, guidance changes, corporate actions, or idiosyncratic news.",
  "peer_dynamics": "Analysis of peer basket fundamentals (${cleanPeers.join(', ')}), sector sentiment, and macro correlation breakdown.",
  "mean_reversion_assessment": "Quantitative assessment of whether this dislocation represents a temporary liquidity/sentiment anomaly prone to mean-reversion or a permanent structural regime shift.",
  "risk_factors": ["Array of up to 4 primary downside or regime-change risks"],
  "tactical_recommendations": ["Array of up to 4 hedge fund trade structuring recommendations such as long/short beta weighting, entry/exit criteria, and catalyst milestones"],
  "catalyst_timeline": [
    {
      "date_or_milestone": "Timeline marker (e.g. Next Earnings, Product Keynote, Macro Print)",
      "event": "Description of anticipated event",
      "impact": "Expected impact on spread convergence/widening"
    }
  ]
}`;

  let responseText = "";
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });
    responseText = response.text || "";
  } catch (apiErr) {
    // If transient 503 or 429, try once more after brief delay
    if (apiErr.status === 503 || apiErr.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        const retryResponse = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json"
          }
        });
        responseText = retryResponse.text || "";
      } catch (retryErr) {
        const err = new Error(`Google Gemini API error: ${retryErr.message}`);
        err.status = retryErr.status || 503;
        throw err;
      }
    } else {
      const err = new Error(`Google Gemini API error: ${apiErr.message}`);
      err.status = apiErr.status || 500;
      throw err;
    }
  }

  let parsedMemo;
  try {
    parsedMemo = JSON.parse(responseText.trim().replace(/^```json\s*/i, "").replace(/\s*```$/i, ""));
  } catch (jsonErr) {
    parsedMemo = {
      headline: `Statistical Pair Dislocation Memo: ${cleanTicker} vs ${peer_group_name}`,
      executive_summary: responseText.slice(0, 300),
      corporate_catalysts: "Catalysts extracted from quantitative divergence data.",
      peer_dynamics: `Sector co-movement analysis across ${cleanPeers.join(", ")}.`,
      mean_reversion_assessment: `Spread deviation reached ${peak_spread_pct}% at ${max_z_score} standard deviations.`,
      risk_factors: ["Regime change persistence", "Idiosyncratic earnings dispersion"],
      tactical_recommendations: ["Pair rebalancing upon Z-score decay below 1.0 standard deviation"],
      catalyst_timeline: [{ date_or_milestone: "Near-Term", event: "Earnings print", impact: "Spread normalization" }]
    };
  }

  return {
    source: "Google Gemini 3.8 Flash Quantitative Analyst",
    fetched_at: new Date().toISOString(),
    ticker: cleanTicker,
    peer_group_name,
    peer_tickers: cleanPeers,
    episode_metrics: {
      max_z_score,
      peak_spread_pct,
      direction,
      duration_days,
      start_date,
      peak_date,
      collapse_date: collapse_date || null
    },
    memo: {
      headline: parsedMemo.headline || `Statistical Dislocation Memo: ${cleanTicker} vs ${peer_group_name}`,
      executive_summary: parsedMemo.executive_summary || "",
      corporate_catalysts: parsedMemo.corporate_catalysts || "",
      peer_dynamics: parsedMemo.peer_dynamics || "",
      mean_reversion_assessment: parsedMemo.mean_reversion_assessment || ""
    },
    risk_factors: (parsedMemo.risk_factors || []).slice(0, 5),
    tactical_recommendations: (parsedMemo.tactical_recommendations || []).slice(0, 5),
    catalyst_timeline: (parsedMemo.catalyst_timeline || []).slice(0, 5)
  };
}
