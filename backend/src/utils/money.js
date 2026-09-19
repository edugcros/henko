// 📁 src/utils/money.js
export const Money = {
  fromDecimal: amount => {
    const num = Number(amount)
    if (isNaN(num) || num < 0) throw new Error(`Monto inválido: ${amount}`)
    return Math.round(num * 100)
  },
  
  toDecimal: cents => {
    const num = Number(cents)
    if (isNaN(num)) return 0
    return Number((num / 100).toFixed(2))
  },
  
  multiply: (cents, quantity) => Math.round(cents * Number(quantity)),
}

// SE BORRARON `add` Y `format`, Y NINGUNO TENÍA UN SOLO LLAMADOR
//
// `add` era `amounts.reduce((a, b) => a + (Number(b) || 0), 0)`. Una auditoría
// externa lo marcó como crítico: "permite volver a introducir floats en el
// modelo de centavos". El diagnóstico es correcto en abstracto y no aplicaba
// acá por dos motivos.
//
// Primero, no lo llamaba nadie — verificado también por el nombre INYECTADO,
// que es como se usa este objeto en calculateCartLines: `money.multiply(...)`.
// Buscar solo `Money.add` habría dado el mismo cero por el motivo equivocado, y
// con ese criterio `multiply` parecía muerto y está vivo.
//
// Segundo, el núcleo contable de IA —donde sí hay plata en `Number`— no usa
// este módulo. Así que `add` no podía contaminar ningún modelo de centavos:
// no se ejecutaba, y el otro camino no pasa por acá.
//
// Sobre enteros de centavos la suma es exacta hasta 2^53, así que la función
// tampoco era peligrosa por sí misma. Lo que la hacía un riesgo era existir
// sin contrato: nada impedía pasarle decimales el día que alguien la usara.
// Eso se resuelve borrándola, no construyéndole un kernel alrededor.
//
// `format` cayó por lo mismo: cero llamadores, y el formateo de moneda del
// panel vive en el frontend.