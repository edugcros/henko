import { getFromLocalStorage } from './getLocalStorage'

// Esta función obtiene el token actualizado, ya sea desde Redux o localStorage
export const getUpdatedConfig = () => {
  const token = getFromLocalStorage('user')?.token || ''
  if (!token) {
    throw new Error('Token is missing')
  }

  return {
    headers: {
      Authorization: `Bearer ${token}`, // Asegura que el token sea el más actualizado
      Accept: 'application/json',
    },
  }
}
