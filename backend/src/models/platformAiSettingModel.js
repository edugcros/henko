// 📁 src/models/platformAiSettingModel.js
//
// Ajustes de plataforma que se pueden cambiar sin reiniciar el servicio.
//
// POR QUÉ EXISTE
//
// El techo de gasto vivía solo en AI_PLATFORM_MONTHLY_TOKEN_BUDGET, y esa
// variable requiere reiniciar Render para tomar efecto. Es aceptable para
// configurar algo con tiempo; no lo es para el único caso en que ese número
// importa de verdad: el disyuntor cortó, la IA está caída para todos los
// comercios de la key compartida, y hay que moverlo AHORA.
//
// POR QUÉ APPEND-ONLY, IGUAL QUE EL LEDGER
//
// La alternativa era un documento con el valor actual más un campo
// updatedBy. Eso deja el "quién y cuándo" en un solo renglón que la
// modificación siguiente pisa, y el historial de un límite de seguridad es
// justamente lo que se quiere mirar cuando algo salió mal.
//
// Acá la fila más reciente ES el valor vigente. No hay un "estado actual"
// separado del historial que pueda quedar desincronizado con él, y el audit
// trail no es un agregado: es la estructura.
//
// `value: null` es un valor legítimo y significa "volver a la variable de
// entorno". Sin eso, poner un override sería irreversible sin un deploy, que
// es exactamente lo que este archivo vino a evitar.

import mongoose from 'mongoose'

export const PLATFORM_AI_SETTINGS = Object.freeze({
  MONTHLY_TOKEN_BUDGET: 'monthlyTokenBudget',
  PER_TENANT_SHARE: 'perTenantShare',

  // Precio mensual de cada plan, EN PESOS.
  //
  // Viven acá y no en una colección propia porque esto ya es lo que el dueño de
  // la plataforma edita en caliente, con historial de quién cambió qué y por
  // qué. Un precio necesita exactamente eso: dentro de tres meses, "¿por qué el
  // starter pasó de 40.000 a 52.000?" se contesta con la fila, no con la
  // memoria de nadie.
  //
  // El nombre del modelo dice "AiSetting" y estos no son de IA: es deuda de
  // nombre que no justifica duplicar el mecanismo entero ni migrar la colección.
  //
  // Están los dos planes del catálogo y nada más: los dos se pagan, así que
  // los dos tienen precio que el dueño puede mover desde el panel.
  PLAN_PRICE_STARTER: 'planPriceStarterArs',
  PLAN_PRICE_PRO: 'planPriceProArs',
})

const platformAiSettingSchema = new mongoose.Schema(
  {
    setting: {
      type: String,
      enum: Object.values(PLATFORM_AI_SETTINGS),
      required: true,
    },

    // null = sin override, manda la variable de entorno.
    value: { type: Number, default: null, min: 0 },

    // El valor que estaba vigente antes de este cambio. Redundante con la fila
    // anterior a propósito: leer "de 200M a 400M" en una sola fila es lo que
    // hace útil el historial cuando se lo mira apurado.
    previousValue: { type: Number, default: null, min: 0 },

    changedByEmail: { type: String, required: true, trim: true },
    changedByUserId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // Por qué se cambió. Se pide en la pantalla: dentro de tres meses el número
    // solo no explica nada, y quien lo mire va a ser otra persona o vos sin el
    // contexto de hoy.
    reason: { type: String, trim: true, default: '' },
  },
  {
    // Una fila de auditoría no se edita. Si el valor tiene que cambiar, se
    // agrega otra.
    timestamps: { createdAt: true, updatedAt: false },
  },
)

// El acceso principal: el valor vigente de un ajuste es su fila más reciente.
platformAiSettingSchema.index({ setting: 1, createdAt: -1 })

// Deliberadamente SIN tenantPlugin: es configuración de la plataforma, no de un
// comercio — mismo criterio que aiPlatformUsageModel.

const PlatformAiSetting =
  mongoose.models.PlatformAiSetting ||
  mongoose.model('PlatformAiSetting', platformAiSettingSchema)

export default PlatformAiSetting
