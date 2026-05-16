/**
 * Obtiene un valor de localStorage de forma segura.
 * @param {string} key - La clave del elemento en localStorage.
 * @returns {any} - El valor parseado del localStorage o null si no existe o si ocurre un error.
 */
export const getFromLocalStorage = key => {
  try {
    const item = localStorage.getItem(key)
    return item ? JSON.parse(item) : null
  } catch (error) {
    console.error(`Error al obtener ${key} de localStorage:`, error)
    return null
  }
}
