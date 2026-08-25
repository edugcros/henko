# Correo en producción y multi-tenant

Agosto 2026. Qué hace falta para que los correos lleguen de verdad, y cómo
cada comercio manda desde su propia marca.

## El servicio de Render se administra a mano, no por Blueprint

`henko-api` **nunca estuvo enlazado como Blueprint activo** a un
`render.yaml` — se creó y se administra a mano desde el dashboard de
Render → Environment. El repo tuvo un `render.yaml` documentando la
intención (qué variables debería tener el servicio y por qué), pero
commitear un cambio ahí **nunca aplicó nada solo** — alguien tenía que
replicarlo a mano en el dashboard igual.

El 14/08/2026 esto causó exactamente el bug de este documento: el PR que
agregaba `EMAIL_TRANSPORT`/`EMAIL_HOST`/`EMAIL_PORT`/`EMAIL_USER` se mergeó
y deployó, pero esas cuatro variables nunca llegaron al servicio real —
solo los dos secretos (`EMAIL_PASS`, `EMAIL_FROM`) que se habían cargado a
mano seguían el flujo correcto. El mismo patrón volvió a aparecer el
25/08/2026 con `AI_PLATFORM_MONTHLY_TOKEN_BUDGET`/`AI_PLATFORM_PER_TENANT_SHARE`
(ver `AI_COST_CONTAINMENT.md`) — confirmado que tampoco llegaron nunca al
servicio real. Por eso el archivo se eliminó del repo el 25/08/2026: hacía
más daño pareciendo activo que el que evitaba como documentación.

**Regla que queda**: cualquier variable de entorno nueva o cambiada se
carga directo en Render → Environment del servicio correspondiente. Nunca
asumir que un archivo en el repo la aplicó.

## Lo que decide el remitente

Una sola función: `resolveSenderAddress` en `services/emailService.js`. El
orden es:

1. **Dominio propio del comercio**, si su estado es `verified`.
2. **Dominio de la plataforma**: `EMAIL_FROM` (o `EMAIL_USER` como
   respaldo).

Sin ninguno de los dos, no hay sandbox al que caer: el envío falla
explícito en vez de fingir que salió.

El estado `verified` no es burocracia. Un dominio que todavía no publica
SPF/DKIM no autoriza a nadie a enviar en su nombre: usarlo como remitente no
es "casi funcionar", es garantizar el rebote o la carpeta de spam. Por eso
`pending` y `failed` siguen saliendo por la plataforma.

El panel resuelve la dirección efectiva **con esta misma función**, no con una
copia de la regla. Si pudieran discrepar, un comercio vería "verificado"
mientras sus correos siguen saliendo por la plataforma.

## El transporte

Proveedor único: **SendGrid**, por su Web API HTTPS (`POST
/v3/mail/send`), autenticada con `EMAIL_PASS` (o `SENDGRID_API_KEY` si se
quiere separar una key de solo-envío de una con permiso de administrar
dominios). No hay SMTP ni un segundo proveedor de respaldo en el código —
`emailService.js` solo sabe hablar con la Web API de SendGrid.

Esto no siempre fue así. Durante un tiempo el comentario en el código decía
que SMTP "muere en Render", basado en un incidente real contra
`smtp.gmail.com:465`, y después se corrigió a "eso era solo el plan free, y
este proyecto corre en `starter` (pago), así que SMTP funciona". Esa segunda
versión también estaba mal: la corrección se apoyó en lo que decía
`render.yaml` (`plan: starter`) sin chequear el servicio real. `henko-api`
corre en el plan **Free** de Render — confirmado el 14/08/2026 contra la
propia API de Render (`GET /v1/services/{id}` → `serviceDetails.plan:
"free"`), no contra el archivo. Un intento real con SMTP contra
`smtp.sendgrid.net:587` lo confirmó en producción: la conexión se quedó
colgada sin error ni éxito — consistente con un bloqueo silencioso de
puerto, no con credenciales rotas.

El proyecto también tuvo Resend disponible como alternativa en algún
momento (paralelo a SMTP). Se retiró del código por completo: mantener dos
proveedores vivos —cada uno con su propia lógica de remitente, su propio
formato de error, su propia gestión de dominios— era la fuente real de los
bugs de este documento (la variable correcta configurada para el proveedor
equivocado, el default silencioso cuando faltaba una key). Con un solo
proveedor, esa clase entera de bug deja de ser posible.

Fuente: [Render changelog — Free web services will no longer allow outbound
traffic to SMTP
ports](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports).

## Paso 0 — que la plataforma pueda enviar

Sin esto no llega ningún correo, de ningún comercio. El transporte (SendGrid
por su Web API) se verificó en vivo el 14/08/2026 — confirmado con un
registro real contra `https://henko.onrender.com`: `[EMAIL] Proveedor:
SendGrid (Web API)` en los logs de Render, sin error, con `x-message-id` de
SendGrid en la respuesta. Eso sigue siendo cierto.

**Pero el 25/08/2026 se encontró un problema distinto, más serio**:
`EMAIL_FROM` está cargado con una dirección `@gmail.com`. SendGrid acepta
el envío (devuelve `messageId`, no hay error en los logs), pero ningún
proveedor de correo real (Gmail, Outlook, Yahoo) confía en un mensaje que
dice venir de `@gmail.com` sin salir de la infraestructura de Google — se
pierde en el camino, sin error visible en ningún lado. El transporte
funciona; el remitente no es de fiar. Ver la sección "Paso 0" para el
diagnóstico completo y qué falta para arreglarlo de verdad (dominio propio
autenticado, hoy pendiente de comprar el dominio).

Antes de llegar al transporte actual, el 14/08/2026 se probó SMTP en
producción y se colgó sin error — el servicio corre en el plan Free de
Render, que bloquea los puertos SMTP salientes. Ver "El transporte" arriba
para el detalle completo de por qué el código solo soporta la Web API.

### SendGrid por su Web API

Faltan cargar dos **secretos**, directo en Render → Environment (nunca en
el repo):

```
EMAIL_PASS=SG.xxxxxxxx           # API key de SendGrid, Full Access
EMAIL_FROM=alguien@undominio.com # la dirección verificada como Single Sender
```

Dos requisitos que no son obvios desde la documentación de SendGrid, así que
quedan anotados acá:

- **La key tiene que ser Full Access**, no solo "Mail Send". El scope
  `whitelabel.*` (dominios) es lo que además le permite al panel administrar
  el dominio de cada comercio (`tenantEmailDomainService.js`) — con una key
  restringida, "conectar mi dominio" queda roto para todos los comercios,
  aunque el envío de la plataforma funcione. **Confirmado el 25/08/2026 que
  la key actual NO tiene ese scope**: `GET /v3/verified_senders`,
  `/v3/whitelabel/domains` y `/v3/stats` devuelven `403 access forbidden`
  con la key real de producción, mientras que `POST /v3/mail/send` funciona
  sin problema — consistente con una key limitada a "Mail Send" únicamente.
  Hay que generar una key nueva con Full Access en SendGrid y reemplazarla
  en Render. **Resuelto el 25/08/2026**: key nueva generada con Full Access,
  confirmado en vivo que `/v3/verified_senders`, `/v3/whitelabel/domains` y
  `/v3/stats` devuelven `200` (antes `403`), y cargada en Render →
  `EMAIL_PASS`. Un envío real de prueba (`POST /v3/mail/send` directo a
  SendGrid, mismo remitente verificado que usa producción) devolvió `202`
  con `x-message-id` real, y el correo **llegó, pero a spam** — confirma en
  vivo el problema de remitente de abajo, ya no es solo teórico.
- **`EMAIL_FROM` tiene que ser exactamente la dirección que se verificó como
  Single Sender** (Settings → Sender Authentication → Verify a Single
  Sender en SendGrid — requiere clic en un mail de confirmación, no DNS). La
  documentación pública de SendGrid dice que `address`/`city`/`country` son
  opcionales al crear el sender; la API real los exige — probado en vivo,
  no asumido del doc.

## Paso 1 — que cada comercio mande desde su dominio

La pantalla del panel (`SendingDomainSection`) y los endpoints hablan
siempre con SendGrid:

1. El comercio carga la dirección desde la que quiere enviar
   (`PUT /api/tenants/me/email-domain`). El dominio se da de alta en
   SendGrid y quedan guardados los registros DNS a publicar.
2. El comercio carga esos registros en su DNS.
3. Pide verificar (`POST /api/tenants/me/email-domain/verify`). Si
   SendGrid confirma, el estado pasa a `verified` y **desde el siguiente
   correo** el remitente es suyo.

Mientras tanto, todo sigue funcionando por la plataforma. No hay ventana en la
que el comercio se quede sin correos.

### Requiere una key con permisos

Dar de alta y consultar dominios necesita una API key de administración:

```
SENDGRID_API_KEY=SG.xxxxxxxx   # opcional: si no está, se reusa EMAIL_PASS
```

La MISMA key que autentica el envío normalmente alcanza — `SENDGRID_API_KEY`
solo hace falta si se quiere separar una key de solo-envío de una con
permiso de administrar dominios (SendGrid controla esto por scope de la
key).

Sin la key de administración correspondiente, el alta se registra igual en
estado `pending` con el motivo explicado en `email.lastError`, y alguien lo
completa a mano desde el panel de SendGrid. El sistema nunca queda creyendo
que manda desde un dominio que no controla.

## Endpoints

```
GET    /api/tenants/me/email-domain          estado e identidad efectiva
PUT    /api/tenants/me/email-domain          declara la dirección de envío
POST   /api/tenants/me/email-domain/verify   vuelve a consultar el estado
DELETE /api/tenants/me/email-domain          vuelve al remitente de la plataforma
```

## Qué controla el comercio, con dominio propio y sin él

|  | Sin dominio propio | Con dominio verificado |
|---|---|---|
| Nombre visible | ✅ el suyo | ✅ el suyo |
| Responder a | ✅ el suyo | ✅ el suyo |
| Dirección del remitente | ❌ de la plataforma | ✅ la suya |
| Entregabilidad | la de la plataforma | la de su propio dominio |

Ver `services/emailService.js` para el detalle del envío y
`services/email/tenantEmailDomainService.js` para el detalle de la
verificación de dominio.

## Inventario de correos

Dieciséis, todos conectados. Cubiertos por `src/test/emailFlows.test.js`
(contenido y remitente de cada correo) y
`src/test/tenantEmailDomain.test.js` (alta y verificación de dominio):

**Cuenta** — verificación (comprador), verificación (comercio), reenvío de
verificación, bienvenida, reseteo de contraseña, aviso de contraseña
modificada.

**Pedido** — confirmación al comprador, aviso de venta al comercio, enviado,
entregado, cancelado, reembolsado, reenvío manual de la confirmación.

**Marketing** — recuperación de carrito (WhatsApp o correo, según qué contacto
haya), aviso de promoción a quienes tienen el producto en su lista de deseos.

**Contacto** — consulta del formulario de la tienda, al comercio.
