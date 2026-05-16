// 📁 src/features/upload/uploadService.js
import api from '@utils/axiosConfig'

const uploadImg = async (files) => {
  const formData = new FormData()
  files.forEach(file => formData.append('images', file))
  const { data } = await api.post('/upload', formData) // endpoint general de upload
  return data // [{ url, public_id }]
}

const deleteImg = async (public_id) => {
  const { data } = await api.delete(`/upload/${public_id}`)
  return data
}

const uploadService = {
  uploadImg,
  deleteImg,
}

export default uploadService
