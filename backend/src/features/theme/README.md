# Theme customization domain (backend)

Organización del dominio de customización:

- `features/theme/themeConfigRoute.js`: rutas públicas y admin (`/theme`, `/theme/admin`, assets, preview, etc.).
- `features/theme/themeConfigController.js`: controladores HTTP, transaccionalidad y reglas de dominio.
- `features/theme/themeConfigModel.js`: esquema de persistencia, serialización y helpers de CSS/validación.

Compatibilidad hacia referencias legacy:

- `routes/themeConfigRoute.js`
- `controller/themeConfigCtrl.js`
- `models/themeConfigModel.js`

siguen existiendo como shims de re-export.
