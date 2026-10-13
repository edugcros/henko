// 📁 src/services/ai/aiPeriod.js
//
// El período contable del consumo de IA: 'YYYY-MM' en UTC.
//
// Vivía en aiBudgetService, que es quien más lo usa. Se mudó acá cuando
// aiSpendReportService pasó a necesitarlo: el medidor ya importa los reportes
// para el desglose del aviso de presupuesto, así que importarlo de vuelta
// habría cerrado un ciclo. Un dato que dos módulos comparten no pertenece a
// ninguno de los dos.
//
// UTC y no la hora local a propósito: el corte del mes tiene que ser el mismo
// en el servidor, en la base y en la factura de Google. Con hora local, un
// consumo del 1 a las 00:30 en Buenos Aires cae en el mes anterior en UTC y
// las cuentas no cierran contra ningún lado.

export const getCurrentPeriod = () => {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 'YYYY-MM' válido, o null. Para no confiar en un período que llega por query. */
export const isValidPeriod = period => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || '').trim())

/**
 * El mes anterior a un período, o null si lo que entra no es un período.
 *
 * POR QUÉ NO SE RESTA UNO AL MES
 *
 * Porque en enero da cero, y '2026-00' no existe. Se construye una fecha en UTC
 * con el mes anterior —`mes - 2` porque el constructor cuenta los meses desde
 * cero— y se deja que la fecha haga el cambio de año: es la misma aritmética
 * que usa getCurrentPeriod y no hay dos reglas que puedan discrepar.
 */
export const getPreviousPeriod = period => {
  if (!isValidPeriod(period)) return null

  const [anio, mes] = String(period).trim().split('-').map(Number)
  const anterior = new Date(Date.UTC(anio, mes - 2, 1))

  return `${anterior.getUTCFullYear()}-${String(anterior.getUTCMonth() + 1).padStart(2, '0')}`
}

export default { getCurrentPeriod, isValidPeriod, getPreviousPeriod }
