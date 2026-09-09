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
export const isValidPeriod = period =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || '').trim())

export default { getCurrentPeriod, isValidPeriod }
