import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import handler from "./api/mcp.js";
import { fetchMarketData } from "./lib/marketData.js";
import { calculateCorrelation } from "./lib/correlation.js";
import { detectDeviations } from "./lib/deviations.js";
import { analyzeDivergence } from "./lib/analyzeDivergence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Register MCP server handler on POST and GET
app.post("/api/mcp", handler);
app.get("/api/mcp", handler);

// Direct REST API endpoints
app.post("/api/market-data", async (req, res) => {
  try {
    const data = await fetchMarketData(req.body || {});
    res.json(data);
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post("/api/calculate-correlation", async (req, res) => {
  try {
    const data = await calculateCorrelation(req.body || {});
    res.json(data);
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post("/api/detect-deviations", async (req, res) => {
  try {
    const data = await detectDeviations(req.body || {});
    res.json(data);
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post("/api/ai/analyze-divergence", async (req, res) => {
  try {
    const data = await analyzeDivergence(req.body || {});
    res.json(data);
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Vite middleware for dev or static files for prod
if (process.env.NODE_ENV !== "production") {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve(__dirname, "dist")));
  app.get("*", (req, res) => {
    res.sendFile(path.resolve(__dirname, "dist", "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`AlphaPairs Quant server listening on port ${PORT}`);
});
