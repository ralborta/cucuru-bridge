# Cucuru Bridge Monitor

Bridge de monitoreo para Cucuru con UI moderno.

## Características

- ✅ Health check del bridge
- ✅ Gestión de webhooks (registrar, ver, eliminar)
- ✅ Consultas de collections y settlements
- ✅ Feed en tiempo real de webhooks recibidos
- ✅ UI moderno con Tailwind CSS y modo oscuro

## Variables de Entorno

Las siguientes variables de entorno son requeridas:

- `CUCURU_BASE_URL` - URL base de la API de Cucuru (ej: https://api.cucuru.com/app/v1/)
- `CUCURU_API_KEY` - API Key de Cucuru
- `CUCURU_COLLECTOR_ID` - ID del collector

Opcionales:

- `INBOUND_HEADER_NAME` - Nombre del header para autenticación entrante
- `INBOUND_HEADER_VALUE` - Valor del header para autenticación entrante
- `CUCURU_WEBHOOK_SECRET` - Secret para verificación HMAC
- `CUCURU_SIGNATURE_HEADER` - Nombre del header de firma (default: X-Cucuru-Signature)
- `CUCURU_HMAC_ALGO` - Algoritmo HMAC (default: sha256)
- `PORT` - Puerto del servidor (default: 3000)

## Desarrollo Local

```bash
npm install
npm run dev
```

El servidor se iniciará en `http://localhost:3000`

## Despliegue en Vercel

1. Conecta tu repositorio de GitHub a Vercel
2. Configura las variables de entorno en el dashboard de Vercel
3. Vercel detectará automáticamente la configuración y desplegará la aplicación

O usando Vercel CLI:

```bash
npm i -g vercel
vercel
```

## Estructura del Proyecto

```
├── api/
│   └── index.ts          # Handler para Vercel
├── public/
│   └── index.html        # UI del monitor
├── src/
│   └── server.ts        # Servidor Express principal
├── vercel.json          # Configuración de Vercel
└── package.json
```

## API Endpoints

- `GET /` - UI del monitor
- `GET /health` - Health check
- `GET /api/collections` - Consultar collections
- `GET /api/settlements` - Consultar settlements
- `GET /api/webhooks/last` - Últimos webhooks recibidos
- `POST /api/webhooks/register` - Registrar webhook
- `GET /api/webhooks/endpoint` - Ver endpoint configurado
- `DELETE /api/webhooks/endpoint` - Eliminar endpoint
- `POST /api/webhooks/collection_received` - Webhook de collection
- `POST /api/webhooks/settlement_received` - Webhook de settlement
