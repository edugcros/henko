// 📁 src/utils/escapeRegex.js
export const escapeRegex = value => {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
