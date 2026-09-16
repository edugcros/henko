// 📁 src/models/aiTenantPolicyModel.js
//
// Lo que el DUEÑO DE LA PLATAFORMA decidió sobre un comercio puntual.
//
// POR QUÉ HACÍA FALTA UN LUGAR NUEVO
//
// Antes había dos clases de límite y ninguna servía para esto:
//
//   DEFAULT_PLAN_LIMITS   por PLAN, igual para todos los del mismo plan, en
//                         código y con deploy.
//   AiAgent.quotas        el autolímite que se pone EL COMERCIO. Cubre 2 de
//                         las 6 métricas y puede volver a subirlo cuando
//                         quiera.
//   perTenantShare        una fracción GLOBAL del techo, igual para todos.
//
// O sea que si un comercio se estaba comiendo el presupuesto, la única palanca
// era bajarle la fracción A TODOS. Castigar a los diez porque uno se desbocó
// no es control, es la ausencia de control.
//
// QUÉ GUARDA
//
//   share       la fracción del techo que puede llevarse ESTE comercio, en vez
//               de la global. Bajarla lo acota sin tocar a nadie más.
//   suspended   el interruptor. Apaga la IA de este comercio y solo de este.
//
// POR QUÉ NO ENTRA EN PlatformAiSetting
//
// Ese modelo guarda ajustes de PLATAFORMA con un enum cerrado de nombres, y su
// historial es una fila por cambio. Meterle un tenantId lo convertiría en dos
// cosas a la vez: los ajustes globales dejarían de ser únicos y cada lectura
// tendría que preguntar "¿de quién?". Son conceptos distintos y conviene que
// se vean distintos.
//
// EL MISMO RIGOR DE AUDITORÍA
//
// Quién lo cambió y por qué, igual que los techos. Apagarle la IA a un
// comercio es una decisión que alguien va a tener que explicar, y dentro de
// tres meses el estado solo no explica nada.

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

const aiTenantPolicySchema = new mongoose.Schema(
  {
    /**
     * Fracción del techo global que puede llevarse este comercio.
     *
     * null = usa la global (getPerTenantShare). Es lo normal: solo se carga un
     * valor acá cuando hay un motivo para tratarlo distinto.
     *
     * Se acota entre 1% y 100% igual que la global, por el mismo motivo: en
     * cero lo dejaría sin nada y arriba de uno le permitiría llevarse más que
     * el techo entero.
     */
    share: { type: Number, default: null, min: 0.01, max: 1 },

    /**
     * El interruptor. Con esto en true, este comercio no consume más IA.
     *
     * Es distinto de bajarle el share a cero —que no se puede— y distinto de
     * que se le acabe el cupo: el cupo se repone el mes que viene y esto no se
     * levanta hasta que alguien lo levante.
     *
     * Se usa para lo que un cupo no cubre: un comercio que dejó de pagar, uno
     * con un bug que no para, o uno que hay que frenar YA mientras se entiende
     * qué está pasando.
     */
    suspended: { type: Boolean, default: false },

    /**
     * Por qué está suspendido, en texto libre.
     *
     * Va al mensaje que ve el comercio. Un servicio que se apaga sin decir por
     * qué genera un ticket de soporte por cada comercio afectado.
     */
    suspendedReason: { type: String, trim: true, default: null },

    // Quién tocó esto por última vez y por qué. Mismo criterio que los techos:
    // dentro de tres meses el estado solo no explica la decisión.
    changedByEmail: { type: String, trim: true, default: null },
    reason: { type: String, trim: true, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  },
)

// Una política por comercio. El unique es lo que permite hacer upsert sin
// carreras: dos cambios simultáneos no pueden crear dos documentos.
//
// LLEVA NOMBRE PROPIO A PROPÓSITO. tenantPlugin ya declara un { tenantId: 1 }
// para el aislamiento, y Mongo deriva el nombre de las claves: los dos salían
// 'tenantId_1' y el segundo rebotaba con "An existing index has the same name".
// El síntoma no era un índice de menos —era que el modelo entero dejaba de
// poder usarse, porque el error sale en cada operación.
aiTenantPolicySchema.index(
  { tenantId: 1 },
  { unique: true, name: 'aiTenantPolicy_tenant_unique' },
)

aiTenantPolicySchema.plugin(tenantPlugin)

const AiTenantPolicy =
  mongoose.models.AiTenantPolicy ||
  mongoose.model('AiTenantPolicy', aiTenantPolicySchema)

export default AiTenantPolicy
