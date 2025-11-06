# Cucuru Bridge (Railway) — Guía de desarrollo con Cursor

Microservicio minimal para integrar con Cucuru: crea links de cobro (proxy) y recibe webhooks.

## 1) Instalación
```bash
npm i
npm run dev   # desarrollo local
# o
npm start     # ejecuta con .env
```

## 2) Variables de entorno

Configura `.env` (y en Railway → Variables):

```
PORT=3000
CUCURU_BASE_URL=https://sandbox.api.cucuru.com/app/v1/
CUCURU_API_KEY=REEMPLAZAR
CUCURU_COLLECTOR_ID=REEMPLAZAR
CUCURU_WEBHOOK_SECRET=        # si hay firma HMAC
CUCURU_SIGNATURE_HEADER=X-Cucuru-Signature
CUCURU_HMAC_ALGO=sha256
```

## 3) Endpoints

* `GET /health` → ping.
* `POST /api/payments/link` → proxy a `payments/links` (usa headers X-Cucuru-Api-Key / X-Cucuru-Collector-Id).
* `GET /api/payments/:id` → proxy a `payments/{id}`.
* `POST /api/webhooks/cucuru` → receptor de eventos (firma opcional).

## 4) cURL útiles

Crear link:

```bash
curl -X POST "$CUCURU_BASE_URL/payments/links" \
  -H "Content-Type: application/json" \
  -H "X-Cucuru-Api-Key: $CUCURU_API_KEY" \
  -H "X-Cucuru-Collector-Id: $CUCURU_COLLECTOR_ID" \
  -d '{"amount":12300,"currency":"ARS","reference":"CONST-INV-0001","payer":{"email":"cliente@demo.com","name":"Cliente Demo"},"metadata":{"source":"constanza"}}'
```

Desde tu proxy:

```bash
curl -X POST "http://localhost:3000/api/payments/link" \
  -H "Content-Type: application/json" \
  -d '{"amount":12300,"currency":"ARS","reference":"CONST-INV-0001","payer":{"email":"cliente@demo.com","name":"Cliente Demo"},"metadata":{"source":"constanza"}}'
```

Simular webhook (sin firma):

```bash
curl -X POST "http://localhost:3000/api/webhooks/cucuru" \
  -H "Content-Type: application/json" \
  -d '{"id":"evt_123","event":"payment.succeeded","data":{"payment_id":"pay_001","amount":12300},"created_at":"2025-11-06T20:00:00Z"}'
```

## 5) Deploy en Railway

1. Conectá tu repo en **Railway → New Project → Deploy from GitHub**.
2. Variables: `PORT`, `CUCURU_BASE_URL`, `CUCURU_API_KEY`, `CUCURU_COLLECTOR_ID` (+ firma si aplica).
3. Copiá tu URL pública y configurá el webhook en Cucuru a `https://TU-APP.railway.app/api/webhooks/cucuru`.

## 6) To-Do

* Idempotencia con DB (Railway Postgres).
* Enrutamiento por tipo de evento.
* Act logs y métricas.

