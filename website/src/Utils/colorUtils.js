// utils/colorUtils.js
export const parseColorToCss = colorValue => {
  if (!colorValue) return '#ccc'

  const cleanValue = String(colorValue).trim()

  // 🎨 Formatos válidos: HEX, RGB(A), HSL(A), nombres de color
  if (
    /^#([0-9A-Fa-f]{3}){1,2}$/.test(cleanValue) || // #fff o #ffffff
    /^rgb(a)?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(,\s*\d*\.?\d+)?\s*\)$/.test(
      cleanValue,
    ) || // rgb() o rgba()
    /^hsl(a)?\(\s*\d+\s*,\s*\d+%?,\s*\d+%?(,\s*\d*\.?\d+)?\s*\)$/.test(
      cleanValue,
    ) || // hsl() o hsla()
    /^[a-zA-Z]+$/.test(cleanValue) // "red", "blue", etc.
  ) {
    return cleanValue
  }

  // 🎯 Si viene como "255,0,0" → convertir a rgb()
  if (/^\d{1,3},\d{1,3},\d{1,3}$/.test(cleanValue)) {
    return `rgb(${cleanValue})`
  }

  // 🧹 Si tiene formato tipo [ "rgb(255,0,0)" ] o JSON.stringify
  if (cleanValue.startsWith('[') || cleanValue.startsWith('{')) {
    try {
      const parsed = JSON.parse(cleanValue)
      if (Array.isArray(parsed) && parsed.length === 3) {
        return `rgb(${parsed.join(',')})`
      }
    } catch {
      // Ignorar
    }
  }

  return '#ccc' // fallback neutral
}
