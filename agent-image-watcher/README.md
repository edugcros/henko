# Henko Product Image Agent

Worker local de ingesta para el pipeline de análisis visual de productos.

## Responsabilidad

El proceso observa una carpeta, valida cada imagen, la entrega de forma idempotente
al backend y conserva el archivo en `processed` o `failed`. El análisis IA se
ejecuta en el backend mediante Gemini, dentro del contexto del tenant.

No crea una segunda implementación de IA local. Su función es garantizar una
entrega confiable, observable y limitada hacia el servicio central.

## Garantías operativas

- clave técnica ligada al tenant en el backend;
- análisis IA habilitado por defecto;
- validación de extensión, tamaño y firma binaria;
- cola con concurrencia configurable;
- reintentos exponenciales para fallos transitorios;
- deduplicación local de eventos e idempotencia por SHA-256;
- bloqueo de instancia para evitar procesamientos dobles;
- escritura atómica de `agent-status.json`;
- preservación de errores en archivos `.error.json`;
- cierre ordenado mediante `SIGINT` y `SIGTERM`;
- el `ADMIN_TOKEN` queda prohibido en producción.

## Configuración

Copiar `agent.env.example` como `.env` y completar únicamente secretos locales.

La clave enviada en `AGENT_API_KEY` debe estar registrada como hash SHA-256 para
el mismo `TENANT_DOMAIN` en `PRODUCT_ANALYSIS_AGENT_KEYS_JSON` del backend.

Para generar el hash:

```powershell
node -e "const c=require('crypto'); console.log(c.createHash('sha256').update(process.argv[1]).digest('hex'))" "CLAVE_DEL_AGENTE"
```

## Sidecar opcional

Una imagen `producto.jpg` puede acompañarse con `producto.schedule.json`:

```json
{
  "sendAt": "2026-06-10T09:30:00-03:00",
  "autoAnalyze": true,
  "autoCreateProduct": false,
  "autoSaveProduct": false,
  "autoPublishProduct": false
}
```

`autoPublishProduct` sólo es válido junto con `autoCreateProduct`.

## Estados

- `processed`: el backend aceptó la imagen o confirmó que ya existía.
- `failed`: validación, autenticación o procesamiento rechazado.
- `agent-status.json`: salud, heartbeat, cola, contadores y eventos recientes.

Los archivos fallidos incluyen un `<imagen>.error.json` con código HTTP y motivo.

## Producción

Ejecutar mediante un supervisor como systemd, Windows Service, Docker o PM2.
Debe existir una sola instancia por `WATCH_FOLDER`. `API_BASE_URL` debe utilizar
HTTPS y cada tenant debe disponer de una credencial independiente.
