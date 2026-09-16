// 📁 src/test/aiForecast.test.js
//
// El pronóstico de gasto: "a este ritmo llegás al techo el día 18".
//
// POR QUÉ ESTE NÚMERO EXISTE
//
// Todo el resto del panel contesta "cuánto llevo". El disyuntor corta cuando ya
// se gastó y el aviso del 80% avisa cuando faltan dos días a ritmo normal —y
// unas horas a ritmo desbocado—. Este es el único número que mira adelante, y
// por eso es el único que da tiempo a hacer algo.
//
// POR QUÉ SE PRUEBA SIN BASE
//
// buildForecast es aritmética pura sobre una serie que se le pasa. Separar el
// cálculo de la consulta es lo que permite probar los bordes que en producción
// aparecen una vez por mes: el día 1, el mes de 28 días, el día de hoy a medio
// andar. Con una base de por medio habría que fabricar un mes entero de filas
// para verificar una división.

import { jest } from '@jest/globals'

const { buildForecast } = await import('../services/ai/aiSpendReportService.js')

// Una serie de días con el mismo gasto, para que la cuenta se pueda seguir a
// mano: si un test falla, el número esperado se verifica sin ejecutar nada.
const serie = (desde, hasta, costUsd) =>
  Array.from({ length: hasta - desde + 1 }, (_, i) => ({
    day: desde + i,
    costUsd,
    tokens: 0,
    operations: 1,
  }))

// El período en curso, porque el pronóstico solo proyecta sobre el mes vigente.
const periodoActual = () => {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

// Una fecha del mes en curso, para no tener que congelar el reloj: el período
// tiene que coincidir con el actual o buildForecast no proyecta.
const diaDelMesActual = dia => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dia, 12, 0, 0))
}

// Cuántos días tiene el mes en curso. Las cuentas esperadas dependen de esto y
// escribirlo a mano ataría el test a un mes.
const diasDelMesActual = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
}

describe('el pronóstico de gasto', () => {
  test('proyecta el mes al ritmo de los días cerrados', () => {
    const dias = diasDelMesActual()

    // Nueve días cerrados a USD 2 = USD 18 gastados, y hoy es el 10.
    const r = buildForecast({
      period: periodoActual(),
      daily: serie(1, 9, 2),
      spentUsd: 18,
      usdBudget: 1000,
      now: diaDelMesActual(10),
    })

    expect(r.daysElapsed).toBe(9)
    expect(r.dailyAvgUsd).toBe(2)
    // 18 ya gastados + 2 por cada uno de los días que faltan.
    expect(r.projectedUsd).toBe(18 + 2 * (dias - 9))
  })

  test('HOY no cuenta como día cerrado', () => {
    // ESTE ES EL ERROR QUE MÁS CARO SALE. El día en curso está a medio andar:
    // contarlo entero baja el promedio diario y corre el pronóstico hacia
    // adelante, que es exactamente la dirección en la que este número no se
    // puede equivocar.
    const r = buildForecast({
      period: periodoActual(),
      daily: [...serie(1, 9, 2), { day: 10, costUsd: 0.3, tokens: 0, operations: 1 }],
      spentUsd: 18.3,
      usdBudget: 1000,
      now: diaDelMesActual(10),
    })

    // Los 0,30 de hoy no arrastran el promedio para abajo.
    expect(r.daysElapsed).toBe(9)
    expect(r.dailyAvgUsd).toBe(2)
  })

  test('dice qué día se llega al techo', () => {
    // Nueve días a USD 10 = USD 90. Faltan USD 10 para el techo de 100, y a
    // USD 10 por día eso es un día más: el día 10.
    const r = buildForecast({
      period: periodoActual(),
      daily: serie(1, 9, 10),
      spentUsd: 90,
      usdBudget: 100,
      now: diaDelMesActual(10),
    })

    expect(r.exhaustionDay).toBe(10)
    expect(r.willExhaust).toBe(true)
  })

  test('a ritmo tranquilo no anuncia ningún corte', () => {
    // Un pronóstico que grita siempre no lo lee nadie.
    const r = buildForecast({
      period: periodoActual(),
      daily: serie(1, 9, 1),
      spentUsd: 9,
      usdBudget: 10000,
      now: diaDelMesActual(10),
    })

    expect(r.exhaustionDay).toBe(null)
    expect(r.willExhaust).toBe(false)
  })

  test('proyecta con el ritmo RECIENTE cuando es peor que el del mes', () => {
    // ESTA ES LA PROPIEDAD. Veinte días a USD 1 y los últimos cuatro a USD 20:
    // el promedio del mes da 4,17 y esconde que esta semana el gasto se
    // multiplicó por veinte. Proyectar con el promedio del mes diría que no
    // pasa nada justo cuando empezó a pasar.
    const r = buildForecast({
      period: periodoActual(),
      daily: [...serie(1, 20, 1), ...serie(21, 24, 20)],
      spentUsd: 100,
      usdBudget: 1000,
      now: diaDelMesActual(25),
    })

    expect(r.basis).toBe('recent')
    // Los últimos siete cerrados son 18,19,20 a USD 1 y 21..24 a USD 20:
    // (3 + 80) / 7 = 11,857.
    expect(r.recentAvgUsd).toBeCloseTo(11.857, 2)
    expect(r.recentAvgUsd).toBeGreaterThan(r.dailyAvgUsd)
  })

  test('proyecta con el ritmo del MES cuando la semana viene más tranquila', () => {
    // El pronóstico toma el PEOR de los dos: no puede subestimar. Un mes que
    // arrancó fuerte y aflojó igual tiene ese gasto hecho.
    const r = buildForecast({
      period: periodoActual(),
      daily: [...serie(1, 15, 20), ...serie(16, 24, 1)],
      spentUsd: 309,
      usdBudget: 1000,
      now: diaDelMesActual(25),
    })

    expect(r.basis).toBe('month')
    expect(r.dailyAvgUsd).toBeGreaterThan(r.recentAvgUsd)
  })

  test('el día 1 no inventa una proyección', () => {
    // Sin ningún día cerrado no hay ritmo, y un pronóstico salido de cero días
    // de datos es un número inventado con apariencia de medición.
    const r = buildForecast({
      period: periodoActual(),
      daily: [],
      spentUsd: 0,
      usdBudget: 1000,
      now: diaDelMesActual(1),
    })

    expect(r.projectedUsd).toBe(null)
    expect(r.exhaustionDay).toBe(null)
    expect(r.basis).toBe(null)
  })

  test('sin techo en plata no hay contra qué proyectar', () => {
    // UNLIMITED es 0 en este paquete. Proyectar contra un techo que no existe
    // daría "se agota hoy" para cualquier gasto mayor a cero.
    const r = buildForecast({
      period: periodoActual(),
      daily: serie(1, 9, 5),
      spentUsd: 45,
      usdBudget: 0,
      now: diaDelMesActual(10),
    })

    expect(r.projectedUsd).toBe(null)
    expect(r.willExhaust).toBe(null)
    // La serie viaja igual: sirve para mirar el mes aunque no se proyecte.
    expect(r.daily).toHaveLength(9)
  })

  test('un período pasado no se proyecta', () => {
    // "Va a llegar al techo el día 18" sobre un mes cerrado es una afirmación
    // sin sentido. La serie sí se devuelve, que es lo que sirve de un mes viejo.
    const r = buildForecast({
      period: '2024-03',
      daily: serie(1, 31, 5),
      spentUsd: 155,
      usdBudget: 100,
      now: diaDelMesActual(10),
    })

    expect(r.projectedUsd).toBe(null)
    expect(r.exhaustionDay).toBe(null)
    expect(r.daily).toHaveLength(31)
  })

  test('con el techo ya pasado no anuncia un corte futuro', () => {
    // Si ya se lo comió, el corte no es una proyección: ya ocurrió. Anunciar un
    // día futuro sería decir que todavía hay margen.
    const r = buildForecast({
      period: periodoActual(),
      daily: serie(1, 9, 20),
      spentUsd: 180,
      usdBudget: 100,
      now: diaDelMesActual(10),
    })

    expect(r.exhaustionDay).toBe(null)
    expect(r.willExhaust).toBe(true)
  })

  test('el pronóstico parte de lo gastado MÁS lo comprometido', () => {
    // El disyuntor corta contra la suma de los dos. Si el pronóstico partiera
    // solo de lo liquidado, diría que hay margen mientras el medidor ya está
    // cortando — y sobre el camino de la plata esa es la peor forma de
    // equivocarse.
    //
    // Acá se verifica el contrato: spentUsd es lo que entra a la cuenta, y el
    // llamador (getPlatformSpendSnapshot) le pasa estimated + reserved.
    const r = buildForecast({
      period: periodoActual(),
      daily: serie(1, 9, 1),
      spentUsd: 95,
      usdBudget: 100,
      now: diaDelMesActual(10),
    })

    // Con 95 de 100 gastados y USD 1 por día, el techo se cruza en 5 días.
    expect(r.exhaustionDay).toBe(14)
  })
})

describe('los bordes del calendario', () => {
  test('la cantidad de días sale del mes real, no de un 30 fijo', () => {
    const dias = diasDelMesActual()

    const r = buildForecast({
      period: periodoActual(),
      daily: serie(1, 9, 1),
      spentUsd: 9,
      usdBudget: 1000,
      now: diaDelMesActual(10),
    })

    expect(r.daysInPeriod).toBe(dias)
    expect([28, 29, 30, 31]).toContain(r.daysInPeriod)
  })

  test('febrero de un año bisiesto tiene 29', () => {
    // Un 30 hardcodeado da 30 acá, y proyectar dos días de más sobre un mes de
    // 29 corre el pronóstico justo en la dirección equivocada.
    const r = buildForecast({
      period: '2024-02',
      daily: serie(1, 10, 1),
      spentUsd: 10,
      usdBudget: 1000,
      now: new Date(Date.UTC(2024, 1, 11, 12)),
    })

    expect(r.daysInPeriod).toBe(29)
  })

  test('la ventana reciente no se pasa de los días que hay', () => {
    // El día 4, los "últimos siete días" son tres. Dividir por siete igual
    // daría un ritmo menor al real — otra vez, el error hacia el lado que no
    // se puede.
    const r = buildForecast({
      period: periodoActual(),
      daily: serie(1, 3, 10),
      spentUsd: 30,
      usdBudget: 1000,
      now: diaDelMesActual(4),
    })

    expect(r.recentAvgUsd).toBe(10)
  })
})

afterAll(() => {
  jest.restoreAllMocks()
})
