import express, { Request, Response, NextFunction } from "express";
import axios from "axios";
import crypto from "crypto";

const app = express();

/**
 * Middleware universal:
 * - Guarda rawBody (para posible verificación HMAC).
 * - Parsea JSON si corresponde.
 */
app.use((req: any, _res: Response, next: NextFunction) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    req.rawBody = Buffer.concat(chunks);
    // Intenta parsear si Content-Type es JSON
    const ct = req.headers["content-type"] || "";
    if (ct.includes("application/json")) {
      try {
        req.body = req.rawBody.length ? JSON.parse(req.rawBody.toString("utf8")) : {};
      } catch {
        req.body = {};
      }
    }
    next();
  });
});

// ===== ENV obligatorias / recomendadas =====
const required = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
};

// Core de Cucuru (PRODUCCIÓN)
const BASE = required("CUCURU_BASE_URL");       // ej: https://api.cucuru.com/app/v1/
const API_KEY = required("CUCURU_API_KEY");
const COLLECTOR = required("CUCURU_COLLECTOR_ID");

// Autenticación entrante por header propio (recomendado)
const INBOUND_HEADER_NAME = process.env.INBOUND_HEADER_NAME || "";   // ej: X-Mi-Token
const INBOUND_HEADER_VALUE = process.env.INBOUND_HEADER_VALUE || ""; // ej: abcdef123456

// HMAC opcional (si Cucuru o vos lo configuran a futuro)
const WEBHOOK_SECRET = process.env.CUCURU_WEBHOOK_SECRET || "";        // secret compartido
const SIGNATURE_HEADER = process.env.CUCURU_SIGNATURE_HEADER || "X-Cucuru-Signature"; // nombre del header de firma
const HMAC_ALGO = (process.env.CUCURU_HMAC_ALGO || "sha256") as string; // sha256 por defecto

// Helpers
function cucuruHeaders() {
  return {
    "X-Cucuru-Api-Key": API_KEY,
    "X-Cucuru-Collector-Id": COLLECTOR
  };
}

/**
 * Verifica seguridad entrante del webhook.
 * - Header propio (INBOUND_HEADER_NAME/INBOUND_HEADER_VALUE) si están definidos.
 * - Firma HMAC si WEBHOOK_SECRET está definido (usa rawBody).
 * Si ambos están configurados, ambos deben validar.
 */
function verifyInboundAuth(req: any): boolean {
  // 1) Header propio
  if (INBOUND_HEADER_NAME && INBOUND_HEADER_VALUE) {
    const incoming = req.header(INBOUND_HEADER_NAME);
    if (incoming !== INBOUND_HEADER_VALUE) return false;
  }

  // 2) HMAC opcional
  if (WEBHOOK_SECRET) {
    const signature = req.header(SIGNATURE_HEADER);
    if (!signature) return false;
    // Soporta firmas en hex o base64 (intentamos ambas)
    const h = crypto.createHmac(HMAC_ALGO, WEBHOOK_SECRET).update(req.rawBody || Buffer.alloc(0));
    const digestHex = h.digest("hex");
    const okHex = timingSafeEq(signature, digestHex);
    let ok = okHex;
    if (!okHex) {
      // reintentar en base64
      const h2 = crypto.createHmac(HMAC_ALGO, WEBHOOK_SECRET).update(req.rawBody || Buffer.alloc(0));
      const digestB64 = h2.digest("base64");
      ok = timingSafeEq(signature, digestB64);
    }
    if (!ok) return false;
  }

  return true;
}

function timingSafeEq(a: string, b: string): boolean {
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// ===== Health =====
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "cucuru-bridge",
    ts: new Date().toISOString(),
    // Exponemos solo si están definidos (sin valores):
    inbound_header_enabled: Boolean(INBOUND_HEADER_NAME && INBOUND_HEADER_VALUE),
    hmac_enabled: Boolean(WEBHOOK_SECRET)
  });
});

// ===== Proxy: crear link/intento de cobro =====
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

// ===== Proxy: consultar estado por ID =====
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

// ===== Consultas de producción =====
app.get("/api/collections", async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const r = await axios.get(`${BASE}collection/collections`, {
      headers: cucuruHeaders(),
      params: { date_from, date_to },
      timeout: 15000
    });
    res.status(200).json(r.data);
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({
      error: "upstream_error",
      detail: err?.response?.data || err.message
    });
  }
});

app.get("/api/settlements", async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const r = await axios.get(`${BASE}collection/settlements`, {
      headers: cucuruHeaders(),
      params: { date_from, date_to },
      timeout: 15000
    });
    res.status(200).json(r.data);
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({
      error: "upstream_error",
      detail: err?.response?.data || err.message
    });
  }
});

// ===== Administración del webhook (proxy a Cucuru) =====
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
      timeout: 15000
    });

    // Usamos send() para respetar si Cucuru devuelve texto plano:
    res.status(200).send(r.data);
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({
      error: "upstream_error",
      detail: err?.response?.data || err.message
    });
  }
});

app.get("/api/webhooks/endpoint", async (_req, res) => {
  try {
    const r = await axios.get(`${BASE}collection/webhooks/endpoint`, {
      headers: cucuruHeaders(),
      timeout: 10000
    });
    res.status(200).json(r.data);
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({
      error: "upstream_error",
      detail: err?.response?.data || err.message
    });
  }
});

app.delete("/api/webhooks/endpoint", async (_req, res) => {
  try {
    const r = await axios.delete(`${BASE}collection/webhooks/endpoint`, {
      headers: cucuruHeaders(),
      timeout: 10000
    });
    res.status(200).send(r.data);
  } catch (err: any) {
    res.status(err?.response?.status || 500).json({
      error: "upstream_error",
      detail: err?.response?.data || err.message
    });
  }
});

// ===== Webhooks entrantes (Cucuru -> nosotros) =====
function rejectIfInvalidAuth(req: Request, res: Response): boolean {
  if (!verifyInboundAuth(req)) {
    res.status(401).json({ ok: false, error: "invalid_webhook_auth" });
    return true;
  }
  return false;
}

app.post("/api/webhooks/collection_received", (req: any, res: Response) => {
  if (rejectIfInvalidAuth(req, res)) return;
  const attempt = req.header("X-Redelivery-Attempt") || "0";
  // TODO: idempotencia con req.body.collection_id / trace_id
  console.log("COBRO RECIBIDO", { attempt, payload: req.body });
  res.status(200).json({ received: true });
});

app.post("/api/webhooks/settlement_received", (req: any, res: Response) => {
  if (rejectIfInvalidAuth(req, res)) return;
  const attempt = req.header("X-Redelivery-Attempt") || "0";
  // TODO: idempotencia con req.body.settlement_id
  console.log("LIQUIDACIÓN RECIBIDA", { attempt, payload: req.body });
  res.status(200).json({ received: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`cucuru-bridge (PROD) listening on :${port}`));
