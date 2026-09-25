import { fetchMarketData } from "../lib/marketData.js";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const params = req.method === "POST" ? req.body : req.query;
    const tickers = Array.isArray(params.tickers)
      ? params.tickers
      : typeof params.tickers === "string"
      ? params.tickers.split(",").map(t => t.trim())
      : ["AAPL", "MSFT"];
    const lookback_days = Number(params.lookback_days) || 30;

    const data = await fetchMarketData({ tickers, lookback_days });
    res.status(200).json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}
