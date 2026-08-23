// 📁 admin/src/features/marketing/socialPromotionService.js
import api, { fetchCsrfToken } from '@utils/axiosConfig'
import Cookies from 'js-cookie'

const getAuthToken = () => {
  const token = Cookies.get('token') || localStorage.getItem('token') || null
  return !token || token === 'null' || token === 'undefined' ? null : token
}

const extractErrorMessage = (
  error,
  fallback = 'No se pudo generar el contenido',
) => {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.response?.data?.code ||
    error?.message ||
    fallback
  )
}

const generateSocialContent = async productId => {
  try {
    const csrfToken = await fetchCsrfToken()
    const token = getAuthToken()

    const response = await api({
      method: 'post',
      url: `/product/${productId}/social-caption`,
      withCredentials: true,
      headers: {
        Accept: 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })

    return response.data.data || response.data
  } catch (error) {
    throw new Error(extractErrorMessage(error))
  }
}

const socialPromotionService = { generateSocialContent }

export default socialPromotionService
