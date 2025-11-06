import express, { Request, Response, NextFunction } from "express";
import axios from "axios";
import crypto from "crypto";

const app = express();

/**
 * Middleware para conservar el raw body (necesario si el webhook firma el evento).
 * También intenta parsear JSON del body.
 */
app.use((req: any, _res: Response, next: NextFunction) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    req.rawBody = Buffer.concat(chunks);
    try {
      req.body = req.rawBody.length ? JSON.parse(req.rawBody.toString("utf8")) : {};
    } catch {
      req.body = {};
    }
    next();
  });
});

// Helpers de env
const required = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
};

// En sandbox, coloca la base que te dieron. Debe terminar con /app/v1/ si así lo define Cucuru.
const BASE = required("CUCURU_BASE_URL");
const API_KEY = required("CUCURU_API_KEY");
const COLLECTOR = required("CUCURU_COLLECTOR_ID");

function verifySignature(req: any): boolean {
  const secret = process.env.CUCURU_WEBHOOK_SECRET;
  if (!secret) return true; // si no hay secret, no validamos (modo dev/QA)
  const headerName = process.env.CUCURU_SIGNATURE_HEADER || "X-Cucuru-Signature";
  const algo = (process.env.CUCURU_HMAC_ALGO || "sha256") as string;
  const signature = req.header(headerName);
  if (!signature) return false;

  const digest = crypto.createHmac(algo, secret).update(req.rawBody).digest("hex");

  // Si la firma viene en hex. Si te la dan en base64, adaptar:
  // const digestB64 = crypto.createHmac(algo, secret).update(req.rawBody).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    return false;
  }
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
        "X-Cucuru-Api-Key": API_KEY,
        "X-Cucuru-Collector-Id": COLLECTOR
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
      headers: {
        "X-Cucuru-Api-Key": API_KEY,
        "X-Cucuru-Collector-Id": COLLECTOR
      },
      timeout: 10000
    });
    res.status(200).json(r.data);
  } catch (err: any) {
    res
      .status(err?.response?.status || 500)
      .json({ error: "upstream_error", detail: err?.response?.data || err.message });
  }
});

// Webhook receptor
app.post("/api/webhooks/cucuru", (req: any, res: Response) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ ok: false, error: "invalid_signature" });
  }
  const { id, event, data, created_at } = req.body || {};
  // TODO: idempotencia -> guardar id del evento y evitar reprocesar
  // TODO: enrutamiento -> actuar según tipo de evento (payment.succeeded, failed, expired, etc.)
  console.log("WEBHOOK RECIBIDO:", { id, event, created_at });
  return res.status(200).json({ received: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`cucuru-bridge listening on :${port}`));

