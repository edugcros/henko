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

### Arranque automático en Windows (PM2)

Instalación de una sola vez, en PowerShell como administrador:

```powershell
npm install -g pm2 pm2-windows-startup
pm2-startup install
```

Luego, desde esta carpeta (`agent-image-watcher/`), con el `.env` ya configurado
(ver sección Configuración arriba):

```powershell
npm install
npm run service:install
npm run service:save
```

`pm2-startup install` registra un servicio de Windows que arranca PM2 al
iniciar la máquina; `pm2 save` guarda la lista de procesos actual para que
se restauren automáticamente en ese arranque. A partir de acá, el agente
sobrevive a reinicios de la PC y se reinicia solo si el proceso crashea
(hasta 10 reintentos, con 30s de estabilidad mínima entre reinicios).

Comandos útiles después de instalado:

```powershell
npm run service:status   # ver si está corriendo
npm run service:logs     # logs en vivo (Ctrl+C para salir)
npm run service:restart  # reiniciar manualmente
npm run service:stop     # detener sin desinstalar
npm run service:remove   # sacarlo de PM2 por completo
```

El estado del agente (conectado / última vez visto / cola pendiente) también
se ve remotamente desde el panel admin, en **Agente IA**
(`/admin/product-analysis`), sin necesidad de acceder a esta PC.
