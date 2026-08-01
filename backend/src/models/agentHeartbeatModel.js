// 📁 src/models/agentHeartbeatModel.js
import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

const agentHeartbeatSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      unique: true,
      index: true,
    },
    state: {
      type: String,
      trim: true,
      default: 'running',
    },
    version: {
      type: String,
      trim: true,
      default: '',
    },
    hostname: {
      type: String,
      trim: true,
      default: '',
    },
    lastHeartbeatAt: {
      type: Date,
      default: Date.now,
    },
    queue: {
      pending: { type: Number, default: 0, min: 0 },
      active: { type: Number, default: 0, min: 0 },
    },
    counters: {
      type: Schema.Types.Mixed,
      default: {},
    },
    lastError: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
  },
  { timestamps: true },
)

agentHeartbeatSchema.plugin(tenantPlugin)

export default mongoose.model('AgentHeartbeat', agentHeartbeatSchema)
