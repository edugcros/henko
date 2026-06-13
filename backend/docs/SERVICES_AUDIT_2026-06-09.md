# Auditoría de servicios backend

Fecha: 2026-06-09  
Alcance: `backend/src/services`, controladores/modelos/rutas necesarios para pago y email.  
Exclusión: carpetas y archivos de test.

## Veredicto ejecutivo

El módulo tenía una base funcional, pero el flujo de pago no estaba listo para
producción. Las fallas principales eran credenciales globales que podían
reemplazar las del tenant, idempotencia inestable, `issuer_id` descartado,
reserva de stock contra un campo inexistente, variantes incompletas, webhook
confirmado antes de persistir y dos sistemas de email incompatibles.

Las correcciones críticas quedaron implementadas. Sintaxis, ESLint, entorno de
desarrollo, entorno de producción y autenticación SMTP fueron verificados.

## Correcciones aplicadas

- Credenciales Mercado Pago resueltas como una unidad por tenant.
- Eliminado el reemplazo oculto del token del tenant por `MP_ACCESS_TOKEN`.
- Validación de coincidencia TEST/producción entre Public Key y Access Token.
- `issuer_id` vuelve a enviarse cuando es válido.
- Idempotencia estable por tenant, orden, intención y token de tarjeta.
- El email del pagador se toma del usuario autenticado, no del body.
- Reconciliación de pagos pendientes mediante consulta al proveedor.
- Webhook responde éxito únicamente después de persistir el resultado.
- Unificado el procesamiento de estado, stock, carrito y notificaciones.
- Eliminada la cola de email inactiva y su cron sin dependencia instalada.
- Envíos de cliente y administrador idempotentes mediante estado en la orden.
- Un fallo SMTP ya no convierte un pago aprobado en pago fallido.
- Reserva de stock sobre `stock`, con variantes y rollback parcial.
- Eliminados logs directos de usuarios, destinatarios y HTML de emails.
- Errores de GA4 y GCS integrados al logger central.

## Auditoría por archivo

| Archivo | Estado | Observación |
|---|---|---|
| `aiLearningPromotionService.js` | Aprobado con seguimiento | Reglas por tenant correctas; conviene agregar métricas de promociones descartadas. |
| `aiLearningService.js` | Aprobado | Separación razonable entre feedback y promoción de reglas. |
| `aiVisionService.js` | Aprobado con seguimiento | Servicio extenso; faltan circuit breaker y presupuesto por tenant. |
| `analytics/ga4Reporting.service.js` | Aprobado | Cliente encapsulado y consumido dinámicamente. |
| `analyticsService.js` | Obsoleto | No tiene consumidores; duplica parcialmente GA4 Reporting. Candidato a eliminación. |
| `cartPricingService.js` | Aprobado | Pequeño y enfocado. |
| `email/verificationEmail.service.js` | Aprobado | Flujo independiente de emails transaccionales. |
| `emailService.js` | Aprobado con seguimiento | SMTP compartido con branding por tenant; adecuado si la plataforma es el remitente. |
| `orderAdminMutationService.js` | Aprobado | Mutaciones y auditoría separadas del controlador. |
| `orderAdminQueryService.js` | Aprobado | Consultas tenant-scoped. |
| `orderCartService.js` | Aprobado | Construcción de líneas desacoplada. |
| `orderCouponService.js` | Aprobado | Consumo y validación encapsulados. |
| `orderEmailService.js` | Corregido | Único constructor y despachador idempotente. |
| `orderExecutionService.js` | Aprobado con riesgo conocido | Fallback sin transacción solo para desarrollo. |
| `orderInventoryService.js` | Aprobado | Fuente canónica para stock simple y variantes. |
| `paymentConcurrencyService.js` | Corregido | Locks tenant-scoped y limpieza explícita de expirados. |
| `paymentEmailService.js` | Simplificado | Adaptador del despachador real; sin modelo/worker fantasma. |
| `paymentMercadoPagoService.js` | Corregido | Payload, issuer, estados, errores e idempotencia alineados. |
| `paymentOrderOpsService.js` | Corregido | Reserva/restauración usa inventario canónico y variantes. |
| `paymentOrderService.js` | Aprobado | Snapshot e integridad monetaria correctos. |
| `paymentTenantConfigService.js` | Corregido | Credenciales atómicas por tenant y fallback solo en desarrollo. |
| `paymentWebhookService.js` | Aprobado con seguimiento | Firma e idempotencia correctas; los logs TTL son apropiados. |
| `promotionalBlockService.js` | Aprobado | Consultas tenant-scoped. |
| `statsService.js` | Funcional, requiere división | Más de 1.300 líneas; separar dashboard, marketing, órdenes y catálogo. |
| `storageService.js` | Corregido con seguimiento | Logging centralizado; `makePublic()` debe reemplazarse por CDN/URLs firmadas si el bucket es privado. |
| `wishlistPromotionNotifierService.js` | Corregido con seguimiento | Eliminada exposición de PII; aún merece dividir selección, deduplicación y envío. |

## Riesgos pendientes antes del despliegue

1. Rotar las credenciales que hayan sido compartidas o almacenadas en archivos
   locales y mover secretos a un secret manager.
2. Reemplazar el placeholder de `MP_WEBHOOK_SECRET` de producción.
3. Verificar que `EMAIL_FROM` sea un remitente/alias autorizado por el SMTP de
   producción para evitar fallos SPF, DKIM o DMARC.
4. Configurar `PUBLIC_BACKEND_URL` con HTTPS público para recibir webhooks.
5. Crear una tarea de reconciliación para órdenes pendientes antiguas, de modo
   que libere stock si el comprador nunca vuelve y el webhook no llega.
6. Eliminar `analyticsService.js` después de confirmar que no existe consumo
   externo fuera del repositorio.

## Validaciones ejecutadas

- `node --check` sobre todos los servicios y archivos modificados.
- ESLint sobre pago, email, orden, inventario, métricas y storage.
- `npm run check:env:dev`.
- `npm run check:env:prod`.
- Autenticación SMTP mediante `transporter.verify()` sin enviar correo.

