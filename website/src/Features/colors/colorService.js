// 📁 src/Features/colors/colorService.js
import api from '@utils/axiosConfig'

const getColors = async () => {
  const response = await api.get('/color/')
  return response.data
}

const getColor = async id => {
  const response = await api.get(`/color/${id}`)
  return response.data
}

const createColor = async colorData => {
  const response = await api.post('/color/', colorData)
  return response.data
}

const updateColor = async ({ id, colorData }) => {
  const response = await api.put(`/color/${id}`, colorData)
  return response.data
}

const deleteColor = async id => {
  const response = await api.delete(`/color/${id}`)
  return response.data
}

const colorService = {
  getColors,
  getColor,
  createColor,
  updateColor,
  deleteColor,
}

export default colorService
