export const normalizeArgentinePhone = phone => {
  if (!phone) return phone

  // 1. Eliminar todo lo que no sea número
  let cleaned = phone.toString().replace(/\D/g, '')

  // 2. Si empieza con 0, quitarlo (ej: 0358... -> 358...)
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1)
  }

  // 3. Quitar el '15' si está después del código de área (opcional pero recomendado)
  // Esta regex intenta detectar el 15 tras 2, 3 o 4 dígitos de área
  cleaned = cleaned.replace(/^(\d{2,4})(15)(\d{6,8})$/, '$1$3')

  // 4. Asegurar el prefijo +549 (formato móvil internacional AR)
  if (!cleaned.startsWith('54')) {
    cleaned = '549' + cleaned
  } else if (cleaned.startsWith('54') && !cleaned.startsWith('549')) {
    // Si tiene 54 pero le falta el 9, lo insertamos
    cleaned = '549' + cleaned.substring(2)
  }

  return `+${cleaned}`
}