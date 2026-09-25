import { detectDeviations } from "../lib/deviations.js";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const params = req.method === "POST" ? req.body : req.query;
    const target = params.target || "NVDA";
    const peers = Array.isArray(params.peers)
      ? params.peers
      : typeof params.peers === "string"
      ? params.peers.split(",").map(p => p.trim())
      : ["AMD", "INTC", "TSM"];
    const z_threshold = Number(params.z_threshold) || 2.0;
    const lookback_days = Number(params.lookback_days) || 60;

    const data = await detectDeviations({ target, peers, z_threshold, lookback_days });
    res.status(200).json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}
