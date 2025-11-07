import express, { Request, Response } from "express";
import axios from "axios";

const app = express();

// Body parser JSON normal
app.use(express.json({ type: "*/*" }));

// Helpers de env
const required = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
};

const BASE = required("CUCURU_BASE_URL"); // https://api.cucuru.com/app/v1/
const API_KEY = required("CUCURU_API_KEY");
const COLLECTOR = required("CUCURU_COLLECTOR_ID");

const INBOUND_HEADER_NAME = process.env.INBOUND_HEADER_NAME || "";
const INBOUND_HEADER_VALUE = process.env.INBOUND_HEADER_VALUE || "";

function cucuruHeaders() {
  return {
    "X-Cucuru-Api-Key": API_KEY,
    "X-Cucuru-Collector-Id": COLLECTOR,
  };
}

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "cucuru-bridge", ts: new Date().toISOString() });
});

// Proxy: crear link/intento de cobro
app.post("/api/payments/link", async (req: Request, res: Response) => {
  try {
    const r = await axios.post(`${BASE}payments/links`, req.body, {
      headers: {
        "Content-Type": "application/json",
        ...cucuruHeaders(),
      },
      timeout: 15000
    });
    res.status(200).json(r.data);
  } catch (err: any) {
    res
      .status(err?.response?.status || 500)
      .json({ error: "upstream_error", detail: err?.response?.data || err.message });
  }
});

// Proxy: consultar estado por ID
app.get("/api/payments/:id", async (req: Request, res: Response) => {
  try {
    const r = await axios.get(`${BASE}payments/${req.params.id}`, {
      headers: cucuruHeaders(),
      timeout: 10000
    });
    res.status(200).json(r.data);
  } catch (err: any) {
    res
      .status(err?.response?.status || 500)
      .json({ error: "upstream_error", detail: err?.response?.data || err.message });
  }
});

// GET /api/collections?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
app.get("/api/collections", async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const r = await axios.get(`${BASE}collection/collections`, {
      headers: cucuruHeaders(),
      params: { date_from, date_to },
      timeout: 15000,
    });
    res.status(200).json(r.data);
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({ error: "upstream_error", detail: err?.response?.data || err.message });
  }
});

// GET /api/settlements?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
app.get("/api/settlements", async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const r = await axios.get(`${BASE}collection/settlements`, {
      headers: cucuruHeaders(),
      params: { date_from, date_to },
      timeout: 15000,
    });
    res.status(200).json(r.data);
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({ error: "upstream_error", detail: err?.response?.data || err.message });
  }
});

// POST /api/webhooks/register  (registra o modifica tu endpoint en Cucuru)
app.post("/api/webhooks/register", async (req, res) => {
  try {
    const baseUrl = (req.body?.url as string) || "https://cucuru-bridge-production.up.railway.app/api/webhooks";
    const header = req.body?.header || (
      INBOUND_HEADER_NAME && INBOUND_HEADER_VALUE
        ? { name: INBOUND_HEADER_NAME, value: INBOUND_HEADER_VALUE }
        : undefined
    );
    const payload: any = { url: baseUrl };
    if (header) payload.header = header;

    const r = await axios.post(`${BASE}collection/webhooks/endpoint`, payload, {
      headers: { ...cucuruHeaders(), "Content-Type": "application/json" },
      timeout: 15000,
    });
    res.status(200).json(r.data);
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({ error: "upstream_error", detail: err?.response?.data || err.message });
  }
});

// GET /api/webhooks/endpoint
app.get("/api/webhooks/endpoint", async (_req, res) => {
  try {
    const r = await axios.get(`${BASE}collection/webhooks/endpoint`, { headers: cucuruHeaders(), timeout: 10000 });
    res.status(200).json(r.data);
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({ error: "upstream_error", detail: err?.response?.data || err.message });
  }
});

// DELETE /api/webhooks/endpoint
app.delete("/api/webhooks/endpoint", async (_req, res) => {
  try {
    const r = await axios.delete(`${BASE}collection/webhooks/endpoint`, { headers: cucuruHeaders(), timeout: 10000 });
    res.status(200).json(r.data);
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({ error: "upstream_error", detail: err?.response?.data || err.message });
  }
});

function verifyInboundHeader(req: Request): boolean {
  if (!INBOUND_HEADER_NAME || !INBOUND_HEADER_VALUE) return true; // validación desactivada
  return req.header(INBOUND_HEADER_NAME) === INBOUND_HEADER_VALUE;
}

function rejectIfInvalidHeader(req: Request, res: Response): boolean {
  if (!verifyInboundHeader(req)) {
    res.status(401).json({ ok: false, error: "invalid_inbound_header" });
    return true;
  }
  return false;
}

// Endpoints entrantes (Cucuru te golpea estas URLs)
// Registrá en Cucuru esta URL base: https://cucuru-bridge-production.up.railway.app/api/webhooks
// Cucuru llamará:
// POST /api/webhooks/collection_received
// POST /api/webhooks/settlement_received

app.post("/api/webhooks/collection_received", (req, res) => {
  if (rejectIfInvalidHeader(req, res)) return;
  const attempt = req.header("X-Redelivery-Attempt") || "0";
  console.log("COBRO RECIBIDO", { attempt, payload: req.body });
  // TODO: idempotencia y actualización de orden/factura
  res.status(200).json({ received: true });
});

app.post("/api/webhooks/settlement_received", (req, res) => {
  if (rejectIfInvalidHeader(req, res)) return;
  const attempt = req.header("X-Redelivery-Attempt") || "0";
  console.log("LIQUIDACIÓN RECIBIDA", { attempt, payload: req.body });
  // TODO: idempotencia y actualización de ledger/conciliación
  res.status(200).json({ received: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`cucuru-bridge listening on :${port}`));
