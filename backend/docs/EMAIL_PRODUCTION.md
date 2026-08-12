# Correo en producción y multi-tenant

Agosto 2026. Qué hace falta para que los correos lleguen de verdad, y cómo
cada comercio manda desde su propia marca.

## Lo que decide el remitente

Una sola función: `resolveSenderAddress` en `services/emailService.js`. El
orden es:

1. **Dominio propio del comercio**, si su estado es `verified`.
2. **Dominio de la plataforma** (`RESEND_FROM_EMAIL`).
3. **Sandbox del proveedor** (`onboarding@resend.dev`), que solo entrega a la
   casilla dueña de la cuenta de Resend.

El estado `verified` no es burocracia. Un dominio que todavía no publica
SPF/DKIM no autoriza a nadie a enviar en su nombre: usarlo como remitente no
es "casi funcionar", es garantizar el rebote o la carpeta de spam. Por eso
`pending` y `failed` siguen saliendo por la plataforma.

El panel resuelve la dirección efectiva **con esta misma función**, no con una
copia de la regla. Si pudieran discrepar, un comercio vería "verificado"
mientras sus correos siguen saliendo por la plataforma.

## Paso 0 — que la plataforma pueda enviar

Sin esto no llega ningún correo, de ningún comercio.

1. En Resend, agregar el dominio `henko.com` y cargar los registros DNS.
2. Cuando figure verificado, definir en Render:
   ```
   RESEND_FROM_EMAIL=no-reply@henko.com
   ```
3. Confirmar que el aviso `[EMAIL] RESEND_FROM_EMAIL no está configurada`
   dejó de aparecer en los logs.

Hoy esa variable está **vacía** en `.env.development` y en `.env.production`.
En Render tiene que haber algún valor porque `config/env.js` aborta el
arranque si falta, pero conviene confirmar cuál es: si apunta a un dominio no
verificado, Resend rechaza todos los envíos.

## Paso 1 — que cada comercio mande desde su dominio

Flujo desde el panel del comercio:

1. El comercio carga la dirección desde la que quiere enviar
   (`PUT /api/tenants/me/email-domain`). El dominio se da de alta en el
   proveedor y quedan guardados los registros DNS a publicar.
2. El comercio carga esos registros en su DNS.
3. Pide verificar (`POST /api/tenants/me/email-domain/verify`). Si el
   proveedor confirma, el estado pasa a `verified` y **desde el siguiente
   correo** el remitente es suyo.

Mientras tanto, todo sigue funcionando por la plataforma. No hay ventana en la
que el comercio se quede sin correos.

### Requiere una key con permisos

Dar de alta y consultar dominios necesita una API key de administración:

```
RESEND_MANAGEMENT_API_KEY=re_...
```

La key de envío que usa `emailService` **no sirve** — Resend responde
`restricted_api_key`. Sin la key de administración el alta se registra igual
en estado `pending` con el motivo explicado en `email.lastError`, y alguien lo
completa a mano desde el panel de Resend. El sistema nunca queda creyendo que
manda desde un dominio que no controla.

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

## El transporte

Dos opciones, y la elección no es de gusto:

- **resend** (default): HTTPS por el 443. Es el único que funciona en Render,
  que bloquea los puertos SMTP salientes.
- **smtp**: `EMAIL_TRANSPORT=smtp`, nodemailer. Sirve para desarrollar sin
  depender de DNS. **Muere en Render** por ese bloqueo de egreso.

Ver `services/emailService.js` para el detalle.

## Inventario de correos

Dieciséis, todos conectados y cubiertos por `src/test/emailFlows.test.js`:

**Cuenta** — verificación (comprador), verificación (comercio), reenvío de
verificación, bienvenida, reseteo de contraseña, aviso de contraseña
modificada.

**Pedido** — confirmación al comprador, aviso de venta al comercio, enviado,
entregado, cancelado, reembolsado, reenvío manual de la confirmación.

**Marketing** — recuperación de carrito (WhatsApp o correo, según qué contacto
haya), aviso de promoción a quienes tienen el producto en su lista de deseos.

**Contacto** — consulta del formulario de la tienda, al comercio.
