# Correo en producción y multi-tenant

Agosto 2026. Qué hace falta para que los correos lleguen de verdad, y cómo
cada comercio manda desde su propia marca.

## Lo que decide el remitente

Una sola función: `resolveSenderAddress` en `services/emailService.js`. El
orden es:

1. **Dominio propio del comercio**, si su estado es `verified`. Esto vale
   para los dos transportes por igual — un comercio con su dominio verificado
   sale desde su dirección tanto si la plataforma envía por Resend como por
   SMTP.
2. **Dominio de la plataforma**: `RESEND_FROM_EMAIL` bajo Resend, `EMAIL_FROM`
   (o `EMAIL_USER`) bajo SMTP.
3. Con Resend y nada configurado, cae al **sandbox del proveedor**
   (`onboarding@resend.dev`), que solo entrega a la casilla dueña de la
   cuenta. SMTP no tiene sandbox: sin `EMAIL_FROM`/`EMAIL_USER` no hay
   remitente, y el envío falla explícito en vez de fingir que salió.

El estado `verified` no es burocracia. Un dominio que todavía no publica
SPF/DKIM no autoriza a nadie a enviar en su nombre: usarlo como remitente no
es "casi funcionar", es garantizar el rebote o la carpeta de spam. Por eso
`pending` y `failed` siguen saliendo por la plataforma.

El panel resuelve la dirección efectiva **con esta misma función**, no con una
copia de la regla. Si pudieran discrepar, un comercio vería "verificado"
mientras sus correos siguen saliendo por la plataforma.

## El transporte

`EMAIL_TRANSPORT` elige el mecanismo de envío:

- **resend** (default): API HTTPS de Resend.
- **smtp**: `EMAIL_TRANSPORT=smtp`, nodemailer contra un relay SMTP real —
  hoy configurado para SendGrid.

Durante un tiempo el comentario en el código decía que SMTP "muere en
Render", basado en un incidente real contra `smtp.gmail.com:465`. Eso
resultó ser **específico del plan gratuito**: Render bloquea los puertos SMTP
salientes (25, 465, 587) solo en instancias free desde septiembre 2025; en
planes pagos 465 y 587 funcionan (el 25 sigue bloqueado para todos, como en
casi cualquier host serio, contra abuso). `henko-api` corre en `starter`
(pago) — confirmado en `render.yaml` — así que SMTP es una opción real en
este proyecto, no solo para desarrollo local.

Fuente: [Render changelog — Free web services will no longer allow outbound
traffic to SMTP
ports](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports).

## Paso 0 — que la plataforma pueda enviar

Sin esto no llega ningún correo, de ningún comercio. **Estado: resuelto y
verificado en vivo el 13/08/2026** — SendGrid por SMTP, no Resend. Cuatro
correos reales confirmados end-to-end contra el flujo real (no un mock):
verificación de cuenta, activación al hacer clic, reseteo de contraseña,
aviso de contraseña modificada — los cuatro con message-id real de SendGrid.

### SendGrid por SMTP (la opción activa)

`render.yaml` ya declara `EMAIL_TRANSPORT`, `EMAIL_HOST`, `EMAIL_PORT` y
`EMAIL_USER` como valores fijos, versionados. Faltan cargar dos **secretos**
en el dashboard de Render (`sync: false` — el blueprint los pide, nunca van
al repo):

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
  aunque el envío de la plataforma funcione.
- **`EMAIL_FROM` tiene que ser exactamente la dirección que se verificó como
  Single Sender** (Settings → Sender Authentication → Verify a Single
  Sender en SendGrid — requiere clic en un mail de confirmación, no DNS). La
  documentación pública de SendGrid dice que `address`/`city`/`country` son
  opcionales al crear el sender; la API real los exige — probado en vivo,
  no asumido del doc.

### Resend por API (alternativa, no configurada hoy)

```
RESEND_API_KEY=re_xxxxxxxx
RESEND_FROM_EMAIL=no-reply@henko.com
```

`RESEND_FROM_EMAIL` está vacía tanto en `.env.development` como en
`.env.production`, y no está declarada en `render.yaml`. Mientras
`EMAIL_TRANSPORT=smtp` sea el transporte activo, esto no bloquea nada — pero
si algún día se vuelve a Resend como transporte, hay que verificar un
dominio ahí primero (ver "El transporte" arriba: sin eso, Resend cae al
sandbox `onboarding@resend.dev`, que solo entrega al dueño de la cuenta).

## Paso 1 — que cada comercio mande desde su dominio

Mismo flujo sin importar el transporte activo — la pantalla del panel
(`SendingDomainSection`) y los endpoints no cambian:

1. El comercio carga la dirección desde la que quiere enviar
   (`PUT /api/tenants/me/email-domain`). El dominio se da de alta en el
   proveedor activo y quedan guardados los registros DNS a publicar.
2. El comercio carga esos registros en su DNS.
3. Pide verificar (`POST /api/tenants/me/email-domain/verify`). Si el
   proveedor confirma, el estado pasa a `verified` y **desde el siguiente
   correo** el remitente es suyo.

Mientras tanto, todo sigue funcionando por la plataforma. No hay ventana en la
que el comercio se quede sin correos.

### Requiere una key con permisos

Dar de alta y consultar dominios necesita una API key de administración —
distinta según el proveedor activo:

```
# Bajo EMAIL_TRANSPORT=smtp (SendGrid)
SENDGRID_API_KEY=SG.xxxxxxxx   # opcional: si no está, se reusa EMAIL_PASS

# Bajo el transporte por default (Resend)
RESEND_MANAGEMENT_API_KEY=re_...
```

Con SendGrid, la MISMA key que autentica el SMTP normalmente alcanza —
`SENDGRID_API_KEY` solo hace falta si se quiere separar una key de solo-envío
de una con permiso de administrar dominios (SendGrid controla esto por scope
de la key, no por un tipo de key distinto como Resend). Con Resend, la key de
envío **no sirve** para esto — responde `restricted_api_key` — y hace falta
una separada.

Sin la key de administración correspondiente, el alta se registra igual en
estado `pending` con el motivo explicado en `email.lastError`, y alguien lo
completa a mano desde el panel del proveedor. El sistema nunca queda creyendo
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

Ver `services/emailService.js` para el detalle del transporte y
`services/email/tenantEmailDomainService.js` para el detalle de la
verificación de dominio por proveedor.

## Inventario de correos

Dieciséis, todos conectados. Cubiertos por `src/test/emailFlows.test.js`
(contenido y remitente de cada correo) y
`src/test/tenantEmailDomain.test.js` (alta y verificación de dominio contra
cada proveedor):

**Cuenta** — verificación (comprador), verificación (comercio), reenvío de
verificación, bienvenida, reseteo de contraseña, aviso de contraseña
modificada.

**Pedido** — confirmación al comprador, aviso de venta al comercio, enviado,
entregado, cancelado, reembolsado, reenvío manual de la confirmación.

**Marketing** — recuperación de carrito (WhatsApp o correo, según qué contacto
haya), aviso de promoción a quienes tienen el producto en su lista de deseos.

**Contacto** — consulta del formulario de la tienda, al comercio.
