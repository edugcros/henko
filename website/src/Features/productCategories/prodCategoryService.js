// 📁 src/Features/productCategories/prodCategoryService.js
import api from '@utils/axiosConfig'

const getCategories = async () => {
  const response = await api.get('/category/')
  return response.data
}

const getCategory = async id => {
  const response = await api.get(`/category/${id}`)
  return response.data
}

const createCategory = async categoryData => {
  const response = await api.post('/category/', categoryData)
  return response.data
}

const updateCategory = async ({ id, categoryData }) => {
  const response = await api.put(`/category/${id}`, categoryData)
  return response.data
}

const deleteCategory = async id => {
  const response = await api.delete(`/category/${id}`)
  return response.data
}

const prodCategoryService = {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
}

export default prodCategoryService
