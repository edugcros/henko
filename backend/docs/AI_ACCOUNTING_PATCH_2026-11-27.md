# Parche de contabilidad IA — HENKO
Fecha: 2026-11-27

## Archivos modificados

1. `src/services/ai/aiBudgetService.js`
   - `openOperation()` deja de fallar abierto cuando Mongo devuelve un error distinto de `E11000`.
   - En un reintento con clave duplicada, los errores de lectura/recuperación ya no se convierten en un falso replay.
   - `reserveAiBudget()` revierte las reservas de plataforma y tenant si no puede crear/recuperar la operación durable. Si el rollback también falla, propaga un `AggregateError` y registra ambas fallas.
   - Los errores al liberar reservas ya no se silencian.
   - `claimConsumption()` deja de tratar un error de persistencia de `AiProviderCall` como si el registro hubiese sido exitoso.
   - Si el registro de una llamada ya existe (E11000), reintenta la liquidación de la reserva antes de salir. Esto cubre el caso en que la fila durable se insertó pero falló la liquidación posterior.

2. `src/services/ai/aiPlanPolicy.js`
   - La reserva estimada para `marketAnalyses` sube de USD 0,01 a USD 0,06. La cifra cubre el baseline histórico observado de USD 0,0195 de Gemini más cuatro créditos Tavily a USD 0,008 cada uno (USD 0,032), redondeado hacia arriba.

3. `src/services/marketIntelligence/marketIntelligenceService.js`
   - Ya no se suprime el error de `recordToolSpend()`. Si el proveedor de búsqueda cobró y no se pudo persistir el consumo, el request falla visiblemente en vez de devolver un análisis como si el registro contable estuviera completo.

4. `src/test/aiOperationIdempotency.test.js`
   - Se agrega regresión para fallo al persistir `AiOperation`, comprobando que la reserva de cuota y los agregados financieros no queden aplicados.
   - Se agrega prueba de la estimación mínima de Market Intelligence.

## Validación ejecutada

- `node --check` sobre los tres módulos modificados y el test de idempotencia: OK.
- No se ejecutó Jest ni ESLint: el ZIP no incluye `node_modules` y este entorno no tiene dependencias instaladas. La prueba de integración requiere MongoDB en memoria y las dependencias declaradas por el proyecto.

## Riesgos que siguen requiriendo una segunda etapa

Este parche corrige fallos de persistencia que podían convertirse silenciosamente en cobros o reservas sin trazabilidad. No debe interpretarse como una certificación de contabilidad transaccional completa.

1. **Liquidación multi-documento:** `AiOperation`, `AiUsage`, `AiPlatformUsage` y `AiConsumptionLedger` siguen siendo escrituras separadas. Un crash entre el reclamo de la reserva y la actualización de las proyecciones puede dejar una diferencia. La solución estructural es un flujo de liquidación durable e idempotente por operación, o transacciones MongoDB en un replica set con una política explícita de disponibilidad.
2. **Refund multi-documento:** el cambio de estado de la operación y los decrementos de cuota/costo no forman una única transacción. Requiere la misma estrategia durable.
3. **Presupuesto Market Intelligence:** USD 0,06 es un estimado basado en el baseline medido, no un límite máximo garantizado. Deben existir límites explícitos de créditos Tavily, URLs extraídas y tokens de salida; el costo real puede superar el estimado.
4. **Fallback de generación de imágenes:** el proveedor final puede diferir del proveedor reservado. El controlador corrige el costo después de generar; si la segunda reserva es denegada, registra el gasto con `forceCharge`. La protección más fuerte es reservar previamente el peor costo de la cadena o reservar cada intento antes de invocarlo.
5. **BYOK e idempotencia:** los caminos que registran consumos sin `operationId` no pueden aprovechar la unicidad `(tenant, operation, call)`. Hay que asegurar una identidad durable para cada llamada BYOK, incluso cuando el costo para HENKO sea cero.
6. **Conciliación contra factura:** el catálogo estima tarifas de lista. Los tiers, créditos promocionales, cuotas gratuitas y planes contratados de cada proveedor pueden diferir del importe facturado. La conciliación financiera final necesita importar usage/billing real de cada proveedor.

## Aplicación

El ZIP contiene el backend completo recibido, con estos cambios aplicados. No se modificó GitHub ni ningún entorno de producción. Antes de desplegar, ejecutar en el proyecto:

```bash
npm ci
npm test -- --runInBand src/test/aiOperationIdempotency.test.js
npm run lint
```

Revisar especialmente las pruebas de idempotencia y ejecutar la reconciliación en modo lectura sobre una copia de la base de datos antes de cualquier reparación con `--apply`.
