// src/services/couponApi.public.js
import api from '@utils/axiosConfig'

const getHeaders = () => {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }

  const token = localStorage.getItem('token') || sessionStorage.getItem('token')
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

export const getProductCoupons = async (productId, userId) => {
  const params = userId ? `?userId=${userId}` : ''
  const response = await api.get(`/coupons/by-product/${productId}${params}`)
  return response.data
}

export const couponPublicApi = {
  getProductCoupons,
  validate: async (code, { items, subtotal, userId }) => {
    const response = await api.post(
      '/coupons/validate',
      {
        code: code.toUpperCase().trim(),
        items: items.map(item => ({
          productId: item.productId || item.id,
          quantity: item.quantity,
          price: item.price,
          category: item.category,
        })),
        subtotal,
        userId,
      },
      {
        headers: getHeaders(),
      },
    )

    return response.data
  },

  apply: async (code, orderId) => {
    const response = await api.post(
      '/coupons/apply',
      {
        code: code.toUpperCase().trim(),
        orderId,
      },
      {
        headers: getHeaders(),
      },
    )

    return response.data
  },

  getMyCoupons: async () => {
    const response = await api.get('/coupons/my-coupons', {
      headers: getHeaders(),
    })
    return response.data
  },
}

export default couponPublicApi
