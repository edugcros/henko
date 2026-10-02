// prettier.config.cjs
module.exports = {
  semi: false, // ❌ No usar punto y coma
  singleQuote: true, // ✅ Comillas simples
  trailingComma: 'all', // ✅ Comas finales para objetos y arrays multilínea
  tabWidth: 2, // ✅ Sangría de 2 espacios
  endOfLine: 'auto', // ✅ Maneja correctamente CRLF vs LF
  printWidth: 100, // ✅ Máximo 100 caracteres por línea
  arrowParens: 'avoid', // ✅ Evita paréntesis en funciones de un solo parámetro
}
