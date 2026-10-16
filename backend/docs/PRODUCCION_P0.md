# Bloqueantes de producción: qué cambió y qué hay que hacer a mano

Resultado de la auditoría de cobros. Lo que se resolvió en código está abajo; lo
que no se puede resolver en código está en "Pasos manuales" y **no está hecho**.

## Qué cambió en el código

| # | Problema | Cambio |
|---|----------|--------|
| 1 | Los webhooks de pago se validaban solo con `MP_WEBHOOK_SECRET`, pero cada comercio cobra con su propia aplicación de Mercado Pago | Cada comercio puede cargar su **clave secreta de webhook** (cifrada, `integrations.mercadopago.webhookSecret`, campo nuevo en Configuración de pagos). Se acepta la firma hecha con el secreto del comercio **o** con el global. |
| 2 | Un cobro cuyo id no llegó a guardarse quedaba huérfano: ni el webhook ni la auditoría lo veían | El id del pago se guarda apenas Mercado Pago responde. La `notification_url` lleva `order_id` y `tenant_id`; sin id guardado, el webhook encuentra la orden por esa pista y **solo vincula el pago si Mercado Pago confirma `external_reference` y monto**. La auditoría de 6 h busca por `external_reference` y reporta `provider-payment-unlinked`. |
| 3 | Los índices únicos de `Order` (`providerPaymentId`, `idempotencyKey`) llevaban `$ne: null` (y `sparse` junto a `partialFilterExpression`), que MongoDB rechaza; con `autoIndex: false` nunca se crearon | Definiciones corregidas (`$type: 'string'`). Nuevo índice para la búsqueda del webhook por `providerPaymentId` sin comercio. Script `npm run ensure:indexes` y aviso al arrancar en producción. |
| 5 | El stock se descontaba antes de llamar a Mercado Pago y la marca `stockReservedAt` se guardaba después; una caída dejaba stock perdido y el reintento lo descontaba otra vez. Liberar tragaba errores y limpiaba la marca igual | Descuento y marca se confirman **en la misma transacción**. `releaseReservedStock` devuelve `true/false` y la marca solo se limpia si liberó. Cancelar/reembolsar desde el panel corta con 503 si no pudo liberar. |

## Pasos manuales (no están hechos)

1. **Índices en producción — hacerlo antes de desplegar nada más.**
   ```bash
   cd backend
   npm run ensure:indexes:prod          # simulación: lista lo que falta
   npm run ensure:indexes:prod:apply    # crea lo que falta
   ```
   Crear un índice único falla si ya hay duplicados guardados (el script lo
   informa por modelo y sigue con los demás). Hacerlo fuera de horas pico.

2. **Secretos de webhook por comercio.** Cada comercio debe pegar en
   *Configuración de pagos → Clave secreta del webhook* la que muestra su
   cuenta en Mercado Pago (*Tus integraciones → Webhooks → Clave secreta*).
   Después, comprobar con **una segunda tienda real** que un pago pendiente que
   se aprueba más tarde llega por webhook (el log no debe mostrar
   `MP_WEBHOOK_SIGNATURE_INVALID`).

3. **Hosting que no se duerma.** El plan actual duerme el servicio y los ocho
   trabajos periódicos dependen de `.github/workflows/trabajos-periodicos.yml`.
   Para miles de comercios hace falta un plan que mantenga el proceso vivo. Es
   una decisión de infraestructura; este cambio no la toca.

## Qué NO se cambió, a propósito

- **Doble cobro por reintento con otra tarjeta**: se descartó. La clave de
  idempotencia usa `order.paymentIntent.id`, que se fija al crear la orden y no
  depende del token de tarjeta.
- Las órdenes siguen sin guardar envío, impuestos ni costo de mercadería, y los
  pedidos contra entrega siguen naciendo "aprobados". Son decisiones de modelo
  de negocio, no bloqueantes de cobro.

## Cómo se probó

`src/test/paymentRecovery.test.js` (30 pruebas, sin base de datos) cubre firma
con secreto de comercio, pistas de la URL, vínculo por `external_reference`,
reserva/liberación de stock y la auditoría de cobros sin vincular.

**No se pudo probar aquí**: que la transacción real revierta descuento y marca
juntos, y que Mongo cree los índices corregidos. Ambas necesitan una réplica de
MongoDB; el CI las ejerce con `mongodb-memory-server`, y el paso 1 de arriba lo
confirma contra la base real.
