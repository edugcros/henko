# Contención de costo de IA

Agosto 2026. Documenta el refactor que unificó el control de gasto de IA.

## El problema

Había **tres vías de gasto contra una sola API key de Google**, medidas por
tres mecanismos que no se conocían entre sí:

| Vía | Medidor previo | Problema |
|---|---|---|
| Análisis de imagen (`aiVisionService`) | Cuota mensual por plan | Correcto, pero era el único |
| Agente comercial (`aiAgentBrainService`) | `agent.quotas.*` del schema | Mismo tope para free y enterprise |
| Editor de imágenes (`imageAiService`) | Ninguno | Sin límite de ningún tipo |

Los dos hallazgos que motivaron el trabajo:

1. **La cuota del agente no dependía del plan.** `aiAgentModel` define
   `monthlyMessageLimit: 3000` como default del schema, y el aprovisionamiento
   nunca lo sobrescribía. Un tenant gratuito tenía derecho a 3000 mensajes
   mensuales contra la key de la plataforma — del orden de USD 9/mes por
   comercio que no paga nada.

2. **El comercio podía subirse su propia cuota.** `PUT /api/ai-agent/config`
   aceptaba `quotas.monthlyMessageLimit` del body, y `reserveAgentMessageQuota`
   interpretaba `0` como *ilimitado*. Cualquier admin de tenant autenticado se
   quedaba sin tope mandando un `0`.

Además, la llamada de reparación de respuesta del agente
(`repairAiResponseIfNeeded`) gastaba una segunda vuelta de tokens que no se
registraba en ningún contador.

## La arquitectura nueva

Cuatro piezas, una responsabilidad cada una:

```
aiPlanPolicy.js       ¿cuánto le corresponde a este plan?   (política, sin I/O)
aiBudgetService.js    ¿le queda? cobrá y registrá            (medidor atómico)
aiCredentialsService  ¿con qué API key corre este tenant?    (BYOK + cache)
aiEntitlementMiddleware  cortar temprano en la ruta          (portero)
```

Reglas de diseño que conviene no romper:

- **El middleware chequea, el servicio cobra.** El cobro atómico vive pegado a
  la llamada real al proveedor porque es el único lugar que sabe si el gasto
  ocurrió: un cache-hit del análisis de imagen no cuesta nada y no descuenta.
  Si el middleware también reservara, todo lo que muere entre el router y el
  proveedor le descontaría cuota al comercio sin darle nada.
- **Reservar antes de gastar, devolver si el proveedor falló.** Una caída de
  Google no es culpa del comercio.
- **Los tokens no se reservan, se registran.** Recién se conocen después de la
  respuesta; actúan como guarda del mensaje siguiente.
- **El autolímite del comercio solo aprieta.** `agent.quotas.monthlyMessageLimit`
  sobrevive como preferencia para gastar *menos* que el plan. `applyLimitOverride`
  lo garantiza en un solo lugar.

### Métricas

| Métrica | Qué cuenta | Dónde se cobra |
|---|---|---|
| `vision` | Análisis de imagen de producto | `aiVisionService.analyzeImage` |
| `agentMessages` | Mensajes contestados por el agente | `aiAgentBrainService` |
| `agentTokens` | Tokens del agente (incluye reparación) | post-hoc, guarda del siguiente mensaje |
| `imageEdits` | Generación de fondo con IA | `imageAiCtrl.handleGenerateVariation` |

Quitar el fondo **no** lleva cuota: corre local en el proceso y no le cuesta
plata a nadie (ver `services/ai/backgroundRemoval.js`). Lo que lo limita es la
memoria del contenedor, no la factura.

### El disyuntor

`AI_PLATFORM_MONTHLY_TOKEN_BUDGET` es el techo duro de la plataforma. Sin él,
el máximo gasto posible es la *suma* de las cuotas de todos los tenants:
alcanza un plan mal cargado, un tenant enterprise o un bug de aprovisionamiento
para que no haya techo real. Con él, la factura tiene un límite que no depende
de que ninguna otra cuenta esté bien puesta.

Los tenants con key propia (BYOK) no se ven afectados por el disyuntor: su
gasto no toca la factura de la plataforma.

### El techo por tenant sobre la key compartida

El disyuntor solo tiene sentido acompañado de esta regla, porque **corta para
todos los que comparten la key**. Un único tenant "ilimitado" corriendo sobre
la key de la plataforma podía consumir el presupuesto entero y dejar sin
asistente al resto: el grande no perdía nada y los chicos se quedaban afuera.

"Ilimitado" es una entitlement coherente cuando el comercio paga su propio
consumo, y una contradicción cuando corre sobre la key de todos. Por eso, sobre
la key compartida, un plan sin tope pasa a tener uno derivado del presupuesto:
`AI_PLATFORM_PER_TENANT_SHARE` (0.5 por defecto, o sea la mitad).

Solo aplica a los tokens — es la métrica que traduce a dinero — y solo cuando
el tope del plan es ilimitado. Los topes finitos son deliberados y no se tocan.

**Cómo dimensionar el presupuesto:** por encima de la suma esperada de las
cuotas de los tenants activos, no por debajo. Un disyuntor por debajo de esa
suma deja de ser un backstop de anomalías y se convierte en un embudo
compartido, donde el consumo normal de unos pocos deja sin servicio al resto.
Con 20M y el plan free en 150k tokens, hacen falta más de 130 comercios
gratuitos activos para acercarse al techo.

## Variables de entorno

Todas opcionales; los defaults están calibrados para que un tenant gratuito
cueste centavos y aun así pueda probar el producto.

```bash
# Topes por plan y métrica: AI_LIMIT_<PLAN>_<METRICA>
AI_LIMIT_FREE_AGENT_MESSAGES=300
AI_LIMIT_FREE_AGENT_TOKENS=150000
AI_LIMIT_FREE_VISION=50
AI_LIMIT_FREE_IMAGE_EDITS=10
# ...ídem STARTER, PRO, ENTERPRISE

# Disyuntor global (sin definir = sin disyuntor, no recomendado en prod).
# En producción va declarado en render.yaml, no en el dashboard.
AI_PLATFORM_MONTHLY_TOKEN_BUDGET=20000000

# Fracción máxima del presupuesto que puede consumir un solo tenant sobre la
# key compartida. Solo aplica a planes con tope ilimitado.
AI_PLATFORM_PER_TENANT_SHARE=0.5

# Corte por suscripción. DEFAULT: apagado — ver "Compatibilidad".
AI_ENFORCE_SUBSCRIPTION=false
AI_SUBSCRIPTION_GRACE_DAYS=7      # días de gracia en past_due

# BYOK: planes habilitados a traer su propia key
AI_BYOK_ALLOWED_PLANS=pro,enterprise

# Costo estimado para el panel (tarifa mezclada, solo visibilidad)
AI_COST_USD_PER_1M_TOKENS=0.9

# Cache del perfil de tenant (plan + suscripción + credencial)
AI_PROFILE_CACHE_TTL_SEC=60
```

Las variables viejas de la cuota de visión (`AI_MONTHLY_LIMIT_FREE`,
`_STARTER`, `_PRO`, `_ENTERPRISE`) **se siguen respetando**: si el deploy
actual las tiene puestas, mandan ellas. La variable nueva le gana a la vieja.

## Compatibilidad

Este refactor no le cambia los límites a nadie sin aviso:

- **No requiere migración de datos.** Los topes se derivan del plan al momento
  de leer. Los documentos de `AiUsage` anteriores solo tienen `analysisCount`;
  `reserveAiBudget` detecta el contador faltante y lo crea sin bloquear al
  tenant (`reason: 'ok_backfilled'`).
- **`analysisCount` se mantiene sincronizado** con `counters.vision` porque el
  panel de análisis lo lee por ese nombre.
- **`GET /api/product-analysis/ai-usage` conserva su forma.** Devuelve el
  contrato viejo en `data` y el mes completo en `budget`, para que el panel
  migre sin deploy coordinado.
- **El corte por suscripción viene apagado, y eso es deliberado.** El alta
  (`userCtrl`) crea el tenant con `subscriptionStatus: 'trialing'` y
  `trialEndsAt` a 14 días, y **no hay un solo lugar en el backend que después
  lo pase a `'active'`**: todavía no existe un flujo de facturación. Con el
  corte encendido, todo comercio que se registre perdería la IA a los 14 días
  sin forma de recuperarla salvo editando la base a mano. Una regla que nada
  puede satisfacer no es una regla, es una trampa. La maquinaria está escrita
  y probada; se enciende con `AI_ENFORCE_SUBSCRIPTION=true` el día que exista
  cobranza que mantenga el campo.
- **El corte solo afecta IA.** La tienda, el checkout y el panel siguen
  funcionando con la suscripción caída. Cortarle las ventas a un cliente por
  una tarjeta rechazada es una forma cara de perderlo.

## Endpoints nuevos

```
GET    /api/ai-agent/budget        Consumo del mes, plan, suscripción y origen de la key
PUT    /api/ai-agent/credentials   Guarda la API key propia (se verifica contra Google)
DELETE /api/ai-agent/credentials   Vuelve a la key de la plataforma
```

La key se persiste cifrada con el mismo AES-256-GCM que ya usan los tokens de
WhatsApp y Mercado Pago, y nunca se devuelve: el snapshot solo dice si hay una
configurada.

## Qué NO cubre

- **La UI del panel.** El backend expone el presupuesto y el alta de BYOK, pero
  `AiAgentConfigPage` todavía muestra los campos viejos de cuota como si fueran
  el tope real. Es el próximo paso obvio.
- **El costo de WhatsApp.** `aiCartRecoveryWorkerService` manda mensajes
  salientes por plantilla, que Meta cobra por conversación. No pasa por Gemini,
  así que no lo mide este medidor.
- **Replicate.** `AI_METRICS.IMAGE_EDITS` cuenta generaciones, no distingue si
  las resolvió Replicate (pago) o HuggingFace (gratis).
- **Facturación real.** `estimateCostUsd` usa una tarifa mezclada: sirve para
  ver quién quema la factura, no para cobrarle a nadie. Si algún día se factura
  de verdad, hay que separar `promptTokenCount` de `candidatesTokenCount`.

## Checklist de deploy

1. El disyuntor y la fracción por tenant viajan en `render.yaml`, así que se
   aplican solos al desplegar. No hace falta tocar el dashboard.
2. Revisar los topes por plan contra el precio real de cada plan, y el
   presupuesto contra la suma esperada de cuotas (ver arriba).
3. Desplegar. No hay migración que correr.
4. Mirar `GET /api/ai-agent/budget` de un par de tenants y confirmar que el
   consumo se registra.
5. Al mes siguiente, ajustar el presupuesto con el consumo real que quedó en
   `AiPlatformUsage` en vez de con la estimación inicial.
6. Cuando exista facturación —algo que mantenga `subscriptionStatus` y escriba
   `subscriptionPastDueAt`— recién ahí encender `AI_ENFORCE_SUBSCRIPTION=true`.
   Antes de eso el corte solo puede hacer daño: dejaría sin IA a cada comercio
   nuevo a los 14 días del alta.

`AI_AGENT_SECRET_ENCRYPTION_KEY` no se declara en `render.yaml` a propósito:
ya está en la lista de variables requeridas de `config/env.js`, que aborta el
arranque en producción si falta. La dependencia está cubierta donde importa y
duplicarla en el blueprint solo agrega un lugar más donde desincronizarse.
