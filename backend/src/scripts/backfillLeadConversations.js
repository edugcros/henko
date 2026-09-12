// 📁 src/scripts/backfillLeadConversations.js
//
// Reconecta las conversaciones del asistente con sus leads, y crea el índice
// único que nunca se pudo crear.
//
// QUÉ PASÓ
//
// Hasta 471ac56, un lead ya CERRADO (won/lost/discarded) seguía siendo el
// destino de cada charla nueva de esa persona: se le pisaba el nombre, el
// último mensaje y la conversación asociada, en vez de abrirse una oportunidad
// nueva. Y el lead solo recordaba dos charlas —la que lo originó y la última—,
// así que las del medio quedaban en la base sin ningún lead que las nombre.
//
// En producción eso dejó siete conversaciones y un solo lead, en 'lost',
// apuntando a la más reciente. Las otras seis eran invisibles desde el panel.
//
// El código nuevo ya no vuelve a hacerlo. Este script arregla lo que quedó
// escrito antes.
//
// CÓMO DECIDE
//
// Una conversación por vez, de la más vieja a la más nueva, con la MISMA regla
// que usa el runtime (upsertLeadFromConversation):
//
//   - Si algún lead ya la nombra, se la agrega a su lista y listo.
//   - Si no, se busca un lead ABIERTO de esa persona (mismo email o teléfono):
//     la conversación se suma ahí.
//   - Si tampoco, se crea el lead que le corresponde.
//
// Se reusa el servicio real en vez de escribir documentos a mano: así el
// intent, el puntaje y el estado salen calculados igual que en producción y no
// aparecen leads con una forma que el sistema nunca produciría. Lo único que se
// corrige después es la fecha de última interacción, que el servicio pone en
// "ahora" y acá tiene que ser la de la charla.
//
// EL ÍNDICE
//
// (tenantId, conversationId) único nunca existió: su filtro parcial usaba
// `$exists: false`, que MongoDB no admite en índices parciales, así que
// rechazaba la especificación entera. Con autoIndex apagado en producción,
// crearlo es parte de aplicar el arreglo. Va al final, después del backfill,
// porque si quedara alguna conversación con dos dueños el índice lo va a
// rechazar y hay que verlo antes de tocar nada más.
//
// Es idempotente: correrlo dos veces no cambia nada la segunda.
//
// Uso (por defecto NO escribe nada, solo informa):
//   npm run migrate:lead-conversations
//   npm run migrate:lead-conversations:apply
//   npm run migrate:lead-conversations:prod

import mongoose from 'mongoose'

import connectDB from '../../config/connectDB.js'
import logger from '../../config/logger.js'
import AiConversation from '../models/aiConversationModel.js'
import AiLead from '../models/aiLeadModel.js'
import { upsertLeadFromConversation } from '../services/aiAgent/aiLeadCommercialService.js'

const clean = value => String(value || '').trim()

const lastMessageOf = (conversation, role) => {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : []

  return clean(
    [...messages].reverse().find(message => message?.role === role)?.content,
  )
}

const customerOf = conversation => ({
  name: clean(conversation?.customer?.name || conversation?.customerName),
  email: clean(conversation?.customer?.email || conversation?.customerEmail).toLowerCase(),
  phone: clean(conversation?.customer?.phone || conversation?.customerPhone),
})

/**
 * Los leads que ya nombran a esta conversación, por cualquiera de las tres
 * vías. Se consulta con el driver crudo porque el script cruza comercios.
 */
const findOwners = async conversationId =>
  AiLead.collection
    .find({
      $or: [
        { conversationId },
        { lastConversationId: conversationId },
        { conversationIds: conversationId },
      ],
    })
    .toArray()

const run = async () => {
  const applyChanges = process.argv.includes('--apply')

  await connectDB()

  // Cruza comercios a propósito: es una corrección de plataforma.
  const conversations = await AiConversation.collection
    .find({ deletedAt: { $exists: false } })
    .sort({ createdAt: 1 })
    .toArray()

  logger.info('[MIGRACIÓN leads] Conversaciones a revisar', {
    total: conversations.length,
    modo: applyChanges ? 'APLICANDO' : 'simulación (usar --apply para escribir)',
  })

  const resumen = { yaVinculadas: 0, listaCompletada: 0, leadsCreadosOActualizados: 0, sinTenant: 0 }

  for (const conversation of conversations) {
    const tenantId = conversation.tenantId

    if (!tenantId) {
      resumen.sinTenant += 1
      continue
    }

    const owners = await findOwners(conversation._id)
    const yaEnLista = owners.some(lead =>
      (lead.conversationIds || []).some(id => String(id) === String(conversation._id)),
    )

    if (owners.length && yaEnLista) {
      resumen.yaVinculadas += 1
      continue
    }

    // Alguien ya la nombra por conversationId o lastConversationId: solo falta
    // que aparezca en la lista.
    if (owners.length) {
      resumen.listaCompletada += 1

      logger.info('[MIGRACIÓN leads] Se agrega a la lista de su lead', {
        conversation: String(conversation._id),
        lead: String(owners[0]._id),
      })

      if (applyChanges) {
        await AiLead.collection.updateOne(
          { _id: owners[0]._id },
          { $addToSet: { conversationIds: conversation._id } },
        )
      }

      continue
    }

    // Huérfana: se la pasa por la regla real de identidad.
    const customer = customerOf(conversation)
    resumen.leadsCreadosOActualizados += 1

    logger.info('[MIGRACIÓN leads] Huérfana: se resuelve su lead', {
      conversation: String(conversation._id),
      creada: conversation.createdAt,
      contacto: customer.email || customer.phone || '(anónima)',
    })

    if (!applyChanges) continue

    const lead = await upsertLeadFromConversation({
      tenantId,
      conversation,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      message: lastMessageOf(conversation, 'user'),
      assistantText: lastMessageOf(conversation, 'assistant'),
      channel: conversation.channel || 'webchat',
      metadata: { source: 'backfill_lead_conversations' },
    })

    // El servicio deja lastInteractionAt en "ahora": correcto cuando el cliente
    // acaba de escribir, mentira cuando se está reconstruyendo una charla de
    // hace dos días. Se corrige con la fecha real, y sin pisar una más nueva.
    const realDate = conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt

    if (lead?._id && realDate) {
      await AiLead.collection.updateOne(
        { _id: lead._id, lastInteractionAt: { $gt: realDate } },
        { $set: { lastInteractionAt: realDate } },
      )
    }
  }

  logger.info('[MIGRACIÓN leads] Resultado del recorrido', resumen)

  if (!applyChanges) {
    logger.info('[MIGRACIÓN leads] Simulación terminada. No se escribió nada.')
    await mongoose.disconnect()
    return
  }

  // El índice, al final y a prueba de duplicados.
  try {
    const name = await AiLead.collection.createIndex(
      { tenantId: 1, conversationId: 1 },
      {
        unique: true,
        partialFilterExpression: { conversationId: { $type: 'objectId' } },
      },
    )

    logger.info('[MIGRACIÓN leads] Índice único listo', { indice: name })
  } catch (error) {
    logger.error('[MIGRACIÓN leads] No se pudo crear el índice único', {
      error: error.message,
      pista:
        'Si es E11000, hay más de un lead con el mismo conversationId: revisalos antes de reintentar.',
    })
  }

  await mongoose.disconnect()
}

run().catch(async error => {
  logger.error('[MIGRACIÓN leads] Falló', { error: error.message })
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
