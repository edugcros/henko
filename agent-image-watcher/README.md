# Henko Product Image Agent

Agente local para tomar imágenes de una carpeta y registrarlas en la cola de AddProduct.

## Flujo

1. Copiá una imagen en `WATCH_FOLDER`.
2. El agente espera a que el archivo termine de copiarse.
3. Sube la imagen al backend como trabajo de AddProduct.
4. Mueve la imagen a `PROCESSED_FOLDER` si salió bien o a `FAILED_FOLDER` si falló.
5. Escribe el estado operativo en `agent-status.json`.

El agente no ejecuta IA. La IA se ejecuta en AddProduct.

## Programar una imagen

Para programar una imagen puntual, agregá un archivo con el mismo nombre y extensión `.schedule.json`.

Ejemplo:

- `zapatilla.jpg`
- `zapatilla.schedule.json`

```json
{
  "sendAt": "2026-05-26T09:30:00-03:00",
  "autoSaveProduct": true,
  "autoPublishProduct": false
}
```

## Automatización global

En `.env`:

```env
AUTO_SAVE_PRODUCT=true
AUTO_PUBLISH_PRODUCT=false
AGENT_DEFAULT_SEND_AT=2026-05-26T09:30:00-03:00
```

`AUTO_SAVE_PRODUCT=true` permite que AddProduct, con modo Auto activo, analice con IA y guarde el producto.

## Avisos de promociones en wishlist

El agente también puede pedirle al backend que revise promociones activas y avise por email a usuarios que tengan esos productos en su lista de deseos.

En `.env`:

```env
PROMOTION_NOTIFIER_ENABLED=true
PROMOTION_NOTIFIER_ENDPOINT=/product-analysis/wishlist-promotions/run
PROMOTION_NOTIFIER_INTERVAL_MINUTES=60
PROMOTION_NOTIFIER_DRY_RUN=false
```

El cruce de datos se hace en backend, respetando `tenantId`. El backend registra cada combinación usuario/producto/promoción para no enviar avisos duplicados.

## Estado visual

El agente imprime un resumen en consola y mantiene `agent-status.json` dentro de `WATCH_FOLDER`.

Ese archivo muestra:

- carpeta monitoreada
- tenant
- endpoint
- contadores de detectadas, enviadas, programadas, duplicadas y fallidas
- últimos 20 eventos
