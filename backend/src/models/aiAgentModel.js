// 📁 src/models/aiAgentModel.js
// VERSIÓN GO PRODUCCIÓN - Agente IA Comercial Multitenant
import mongoose from 'mongoose'
import { encryptSecret, decryptSecret } from '../services/aiAgent/aiCryptoService.js'

const { Schema } = mongoose

const aiAgentSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      unique: true,
      index: true,
      immutable: true,
    },

    name: {
      type: String,
      default: 'Asistente Henko',
      trim: true,
      maxlength: 100,
    },

    enabled: {
      type: Boolean,
      default: false,
      index: true,
    },

    channels: {
      whatsapp: {
        enabled: { type: Boolean, default: false },
        phoneNumberId: { type: String, default: '', trim: true },
        businessAccountId: { type: String, default: '', trim: true },
        accessToken: {
          type: String,
          default: '',
          select: false,
          set: value => (value ? encryptSecret(value) : ''),
          get: value => (value ? decryptSecret(value) : ''),
        },
        webchatUrl: { type: String, default: '', trim: true },
        appSecret: {
          type: String,
          default: '',
          select: false,
          set: value => (value ? encryptSecret(value) : ''),
          get: value => (value ? decryptSecret(value) : ''),
        },
        verifyToken: {
          type: String,
          default: '',
          select: false,
          set: value => (value ? encryptSecret(value) : ''),
          get: value => (value ? decryptSecret(value) : ''),
        },
      },
      webchat: {
        enabled: { type: Boolean, default: true },
      },
    },

    personality: {
      tone: {
        type: String,
        enum: ['formal', 'friendly', 'premium', 'technical', 'sales'],
        default: 'friendly',
      },
      language: { type: String, default: 'es-AR', trim: true },
      signature: { type: String, default: '', trim: true, maxlength: 250 },
    },

    behavior: {
      canRecommendProducts: { type: Boolean, default: true },
      canCreateCartLinks: { type: Boolean, default: true },
      canOfferDiscounts: { type: Boolean, default: false },
      requireHumanForPayments: { type: Boolean, default: true },
      requireHumanForClaims: { type: Boolean, default: true },
      maxMessagesBeforeHuman: { type: Number, default: 14, min: 1, max: 80 },
      minConfidenceToAnswer: { type: Number, default: 0.55, min: 0, max: 1 },
    },

    businessContext: {
      description: { type: String, default: '', maxlength: 5000 },
      policies: {
        shipping: { type: String, default: '', maxlength: 4000 },
        returns: { type: String, default: '', maxlength: 4000 },
        payments: { type: String, default: '', maxlength: 4000 },
        privacy: { type: String, default: '', maxlength: 4000 },
      },
      faq: [
        {
          question: { type: String, required: true, trim: true, maxlength: 500 },
          answer: { type: String, required: true, trim: true, maxlength: 2500 },
          enabled: { type: Boolean, default: true },
        },
      ],
    },

    guardrails: {
      blockedTopics: { type: [String], default: [] },
      humanHandoffKeywords: {
        type: [String],
        default: ['reclamo', 'denuncia', 'abogado', 'estafa', 'no me llegó', 'fraude'],
      },
      optOutKeywords: {
        type: [String],
        default: ['stop', 'baja', 'cancelar', 'no me escribas', 'no quiero recibir'],
      },
    },

    learning: {
      enabled: { type: Boolean, default: true },
      requireApproval: { type: Boolean, default: true },
      lastTrainingAt: { type: Date, default: null },
    },

    quotas: {
      monthlyMessageLimit: { type: Number, default: 3000, min: 0 },
      monthlyAiTokenLimit: { type: Number, default: 1000000, min: 0 },
      monthlyMessagesUsed: { type: Number, default: 0, min: 0 },
      monthlyAiTokensUsed: { type: Number, default: 0, min: 0 },
      quotaPeriod: { type: String, default: '', trim: true },
    },

    stats: {
      conversations: { type: Number, default: 0 },
      leads: { type: Number, default: 0 },
      handoffs: { type: Number, default: 0 },
      cartRecoveriesSent: { type: Number, default: 0 },
      cartRecoveriesConverted: { type: Number, default: 0 },
      lastInteractionAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
    toJSON: { getters: false },
    toObject: { getters: false },
  },
)

aiAgentSchema.index({ tenantId: 1, enabled: 1 })
aiAgentSchema.index({ 'channels.whatsapp.phoneNumberId': 1 }, { sparse: true })
aiAgentSchema.index({ tenantId: 1 }, { unique: true })

const AiAgent = mongoose.models.AiAgent || mongoose.model('AiAgent', aiAgentSchema)

export default AiAgent
