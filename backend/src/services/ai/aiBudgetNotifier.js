// 📁 src/services/ai/aiBudgetNotifier.js
//
// Saca el aviso de presupuesto del log.
//
// El aviso anticipado que existe hoy termina en una línea de log de Render. Eso
// vale exactamente lo que valga el hábito de alguien de abrir esa pantalla — y
// el disyuntor, cuando corta, corta la IA para TODOS los comercios que comparten
// la key. Un aviso que puede no llegarle a nadie no es un aviso.
//
// A QUIÉN LE LLEGA
//
// A PLATFORM_OWNER_EMAILS, que ya es la definición de "dueño de la plataforma"
// en este sistema (ver middlewares/platformOwnerMiddleware.js). No se inventa
// una lista nueva: si esa variable decide quién puede VER el reporte financiero
// cruzado, es la misma gente que tiene que enterarse de que se está por acabar
// el presupuesto.
//
// POR QUÉ NO SE MANDA MAIL EN TODOS LOS ESCALONES
//
// El 50% a mitad de mes es normal. Un mail mensual que dice algo normal enseña
// a ignorar los mails de este remitente, y el que importa llega el día que ya
// no se lee. El log tiene los dos escalones porque una línea de log es gratis;
// el mail sale desde el 80%, y cuando el disyuntor efectivamente corta.

import logger from '../../../config/logger.js'
import { sendEmail } from '../emailService.js'

/** Desde qué escalón el aviso deja de ser informativo y pasa a ser un mail. */
export const EMAIL_THRESHOLD = 80

const clean = value => String(value || '').trim()

const getRecipients = () =>
  clean(process.env.PLATFORM_OWNER_EMAILS)
    .split(',')
    .map(email => email.trim())
    .filter(Boolean)

const money = value => `USD ${Number(value || 0).toFixed(2)}`

const formatNumber = value => Number(value || 0).toLocaleString('es-AR')

const renderSpendRows = topSpend => {
  if (!topSpend?.length) return '<p>Sin desglose disponible.</p>'

  const rows = topSpend
    .map(
      row => `<tr>
        <td style="padding:6px 12px 6px 0">${row.metric}</td>
        <td style="padding:6px 12px 6px 0;text-align:right">${money(row.costUsd)}</td>
        <td style="padding:6px 0;text-align:right">${formatNumber(row.tokens)} tokens</td>
      </tr>`,
    )
    .join('')

  return `<table style="border-collapse:collapse;font-size:14px">${rows}</table>`
}

/**
 * Avisa al dueño de la plataforma. Nunca lanza.
 *
 * Se espera su resultado en vez de dispararlo y seguir: pasa como mucho dos
 * veces por mes, y si el proceso se apaga —el plan free de Render apaga el
 * servicio por inactividad— un envío no esperado se pierde justo cuando más
 * importaba.
 */
export const notifyBudgetPressure = async ({
  period,
  percent,
  tokens,
  budget,
  estimatedCostUsd,
  topSpend = [],
  tripped = false,
}) => {
  try {
    const recipients = getRecipients()

    if (!recipients.length) {
      // No es un error de este módulo: es una configuración que falta, y en
      // silencio se parecería demasiado a "ya te avisé".
      logger.warn('[AI BUDGET] Hay un aviso para enviar y PLATFORM_OWNER_EMAILS está vacío', {
        period,
        percent,
      })
      return { sent: false, reason: 'no_recipients' }
    }

    const subject = tripped
      ? `[HENKO] Se cortó la IA: presupuesto agotado (${period})`
      : `[HENKO] Presupuesto de IA al ${percent}% (${period})`

    const headline = tripped
      ? 'El disyuntor cortó. La IA está detenida para todos los comercios que usan la key de la plataforma.'
      : `El consumo del mes va por el ${percent}% del techo.`

    const html = `
      <div style="font-family:system-ui,sans-serif;color:#111;max-width:560px">
        <p style="font-size:16px"><strong>${headline}</strong></p>
        <p style="font-size:14px">
          ${formatNumber(tokens)} de ${formatNumber(budget)} tokens &middot;
          ${money(estimatedCostUsd)} gastados en ${period}.
        </p>
        <p style="font-size:14px;margin-bottom:4px"><strong>Qué lo está consumiendo</strong></p>
        ${renderSpendRows(topSpend)}
        <p style="font-size:13px;color:#555;margin-top:20px">
          El techo se mueve con AI_PLATFORM_MONTHLY_TOKEN_BUDGET en Render, y el
          servicio necesita reiniciarse para tomarlo. El detalle completo está en
          el panel, en Plataforma &rarr; Gasto de IA.
        </p>
      </div>`

    const text = [
      headline,
      `${formatNumber(tokens)} de ${formatNumber(budget)} tokens. ${money(estimatedCostUsd)} en ${period}.`,
      ...topSpend.map(row => `- ${row.metric}: ${money(row.costUsd)}`),
    ].join('\n')

    // Un envío por destinatario: sendEmail valida UN destinatario y descarta el
    // valor entero si no es válido, así que una dirección mal escrita en la
    // lista no puede dejar sin aviso a los demás.
    const results = await Promise.all(
      recipients.map(to =>
        sendEmail({ to, subject, html, text }).catch(error => ({
          success: false,
          error: error.message,
        })),
      ),
    )

    const delivered = results.filter(result => result?.success).length

    if (!delivered) {
      logger.error('[AI BUDGET] No se pudo avisar a nadie del presupuesto', {
        period,
        percent,
        intentos: recipients.length,
      })
    }

    return { sent: delivered > 0, delivered, attempted: recipients.length }
  } catch (error) {
    // El aviso es sobre un consumo que ya se registró: su fallo no puede
    // voltear la operación que lo disparó.
    logger.error('[AI BUDGET] Falló el envío del aviso de presupuesto', {
      period,
      error: error.message,
    })
    return { sent: false, reason: 'error' }
  }
}

export default { notifyBudgetPressure, EMAIL_THRESHOLD }
