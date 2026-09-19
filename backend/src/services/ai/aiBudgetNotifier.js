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

/**
 * Para el aviso de descuadre, donde dos decimales mienten.
 *
 * La diferencia que motiva ese correo puede ser de medio centavo —medido en
 * producción: 0.004943— y con `money` se imprime "USD 0.00": un correo que
 * afirma que no cuadra y muestra cero. Con cuatro decimales se lee la
 * magnitud real, que es justo lo que hay que decidir: si es plata o es ruido.
 */
const moneyPreciso = value => `USD ${Number(value || 0).toFixed(4)}`

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

/**
 * Avisa que la contabilidad no cuadra. Nunca lanza.
 *
 * Va por el mismo canal que el aviso de presupuesto y a la misma gente: si
 * PLATFORM_OWNER_EMAILS es quien decide el techo de gasto, es quien tiene que
 * enterarse de que los números no cierran.
 *
 * SIEMPRE manda mail, sin escalones. El aviso de presupuesto tiene umbral
 * porque un 50% a mitad de mes es normal y un mail que dice algo normal enseña
 * a ignorar al remitente. Acá no hay nada normal: una diferencia significa que
 * alguien pagó algo que no se le cobró, o al revés.
 */
export const notifyAccountingDrift = async audit => {
  try {
    const recipients = getRecipients()

    if (!recipients.length) {
      logger.warn('[AI ACCOUNTING] Hay una diferencia para avisar y PLATFORM_OWNER_EMAILS está vacío', {
        period: audit?.period,
      })
      return { sent: false, reason: 'no_recipients' }
    }

    const { period, cost = {}, findings = [] } = audit || {}

    // La fila del libro sin BYOK y la del BYOK solo aparecen cuando hay algo
    // que mostrar. Sin esto el correo ponía un total del libro al lado del
    // contador de plataforma como si fueran comparables, y no lo son: el
    // contador no incluye lo que un comercio le paga a su propio proveedor.
    const filas = [
      ['Libro (ledger)', cost.ledger],
      ...(cost.byok
        ? [
          ['  del cual, key propia del comercio', cost.byok],
          ['  libro sin key propia (base del contador)', cost.ledgerSinByok],
        ]
        : []),
      ['Suma de los comercios', cost.tenantUsage],
      ['Contador de plataforma', cost.platformUsage],
    ]
      .map(
        ([etiqueta, valor]) => `<tr>
          <td style="padding:6px 12px 6px 0">${etiqueta}</td>
          <td style="padding:6px 0;text-align:right"><strong>${moneyPreciso(valor)}</strong></td>
        </tr>`,
      )
      .join('')

    const diferencias = findings
      .map(f => `<li>${f.between[0]} vs ${f.between[1]}: <strong>${moneyPreciso(f.difference)}</strong></li>`)
      .join('')

    const subject = `[HENKO] La contabilidad de IA no cuadra (${period})`

    const html = `
      <div style="font-family:system-ui,sans-serif;color:#111;max-width:560px">
        <p style="font-size:16px"><strong>Las tres representaciones del gasto de IA no coinciden en ${period}.</strong></p>
        <table style="border-collapse:collapse;font-size:14px;margin:12px 0">${filas}</table>
        <p style="font-size:14px;margin-bottom:4px"><strong>Diferencias</strong></p>
        <ul style="font-size:14px;margin-top:4px">${diferencias}</ul>
        <p style="font-size:13px;color:#555;margin-top:20px">
          El libro es la fuente de verdad. NO se corrigió nada de forma
          automática: la corrección se pide a mano y solo cuando el libro está
          completo. El detalle está en el panel, en Plataforma &rarr; Gasto de IA.
        </p>
      </div>`

    const text = [
      `La contabilidad de IA no cuadra en ${period}.`,
      `Libro: ${moneyPreciso(cost.ledger)}`,
      `Comercios: ${moneyPreciso(cost.tenantUsage)}`,
      `Plataforma: ${moneyPreciso(cost.platformUsage)}`,
      ...findings.map(f => `${f.between[0]} vs ${f.between[1]}: ${moneyPreciso(f.difference)}`),
      'No se corrigió nada automáticamente.',
    ].join('\n')

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
      logger.error('[AI ACCOUNTING] No se pudo avisar a nadie de la diferencia', {
        period,
        intentos: recipients.length,
      })
    }

    return { sent: delivered > 0, delivered, attempted: recipients.length }
  } catch (error) {
    // El aviso es sobre una diferencia que ya existe: su fallo no puede
    // voltear la auditoría que lo disparó.
    logger.error('[AI ACCOUNTING] Falló el envío del aviso de diferencia', {
      period: audit?.period,
      error: error.message,
    })
    return { sent: false, reason: 'error' }
  }
}

export default { notifyBudgetPressure, notifyAccountingDrift, EMAIL_THRESHOLD }

/**
 * Avisa que el estado de una suscripción no coincide con Mercado Pago.
 *
 * VIVE EN ESTE ARCHIVO AUNQUE EL NOMBRE DIGA "aiBudget"
 *
 * Lo que este módulo hace es avisarle al dueño de la plataforma, y esa lista
 * —PLATFORM_OWNER_EMAILS— es la misma. Un archivo nuevo para dos funciones que
 * comparten destinatarios, formato y criterio sería duplicar el canal. El
 * nombre le quedó chico; el contenido es coherente.
 *
 * SIEMPRE manda mail. Una diferencia acá significa que un comercio está usando
 * la plataforma sin pagar, o pagando sin poder usarla. Nada de eso es normal.
 */
export const notifySubscriptionDrift = async audit => {
  try {
    const recipients = getRecipients()

    if (!recipients.length) {
      logger.warn('[SUSCRIPCIONES] Hay una diferencia para avisar y PLATFORM_OWNER_EMAILS está vacío')
      return { sent: false, reason: 'no_recipients' }
    }

    const { findings = [], checked = 0 } = audit || {}

    const filas = findings
      .map(
        f => `<tr>
          <td style="padding:6px 12px 6px 0"><strong>${f.slug}</strong></td>
          <td style="padding:6px 12px 6px 0">HENKO: ${f.stored?.subscriptionStatus} (${f.stored?.plan})</td>
          <td style="padding:6px 0">Mercado Pago: ${f.provider?.mapped}</td>
        </tr>`,
      )
      .join('')

    const subject = `[HENKO] ${findings.length} suscripción(es) no coinciden con Mercado Pago`

    const html = `
      <div style="font-family:system-ui,sans-serif;color:#111;max-width:620px">
        <p style="font-size:16px"><strong>El estado guardado de ${findings.length} suscripción(es) no coincide con el proveedor.</strong></p>
        <table style="border-collapse:collapse;font-size:14px;margin:12px 0">${filas}</table>
        <p style="font-size:13px;color:#555;margin-top:20px">
          Se consultaron ${checked} suscripción(es). NO se corrigió nada de forma
          automática: un estado equivocado puede dejar sin plataforma a un
          comercio que paga, así que la correcci&oacute;n se decide a mano.
          El detalle est&aacute; en el panel, en Plataforma &rarr; Suscripciones.
        </p>
      </div>`

    const text = [
      `${findings.length} suscripcion(es) no coinciden con Mercado Pago.`,
      ...findings.map(
        f => `${f.slug}: HENKO dice ${f.stored?.subscriptionStatus}, Mercado Pago dice ${f.provider?.mapped}`,
      ),
      'No se corrigio nada automaticamente.',
    ].join('\n')

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
      logger.error('[SUSCRIPCIONES] No se pudo avisar a nadie de la diferencia', {
        intentos: recipients.length,
      })
    }

    return { sent: delivered > 0, delivered, attempted: recipients.length }
  } catch (error) {
    logger.error('[SUSCRIPCIONES] Falló el envío del aviso de diferencia', {
      error: error.message,
    })
    return { sent: false, reason: 'error' }
  }
}
