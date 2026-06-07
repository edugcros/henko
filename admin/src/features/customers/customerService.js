// src/features/customers/customerService.js
import api from '@utils/axiosConfig'

const inflight = new Map()

const apiRequest = async (method, endpoint, data, params, signal) => {
  const response = await api({
      method,
      url: `/user${endpoint}`,
      withCredentials: true,
      ...(data && { data }),
      ...(params && { params }),
      ...(signal && { signal }),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
  })

  return response.data.data || response.data
}

const getAllUsers = async (params = {}, { signal } = {}) => {
  const key = JSON.stringify(params)
  if (inflight.has(key)) return inflight.get(key)

  const req = apiRequest('get', `/all-users`, null, params, signal)
    .finally(() => inflight.delete(key))

  inflight.set(key, req)
  return req
}



const deleteUser = async (id) => apiRequest('delete', `/${id}`)
const blockUser = async (id) => apiRequest('put', `/block-user/${id}`)
const unblockUser = async (id) => apiRequest('put', `/unblock-user/${id}`)

const customerService = {
  getAllUsers,
  deleteUser,
  blockUser,
  unblockUser,
}

export default customerService
