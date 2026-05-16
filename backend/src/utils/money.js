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
  
  format: (cents, currency = 'ARS', locale = 'es-AR') => {
    try {
      return new Intl.NumberFormat(locale, { 
        style: 'currency', 
        currency,
        minimumFractionDigits: 2,
      }).format(Money.toDecimal(cents))
    } catch {
      return `${currency} ${Money.toDecimal(cents).toFixed(2)}`
    }
  },
  
  add: (...amounts) => amounts.reduce((a, b) => a + (Number(b) || 0), 0),
  
  multiply: (cents, quantity) => Math.round(cents * Number(quantity)),
}