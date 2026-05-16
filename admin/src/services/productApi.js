// src/services/productApi.js
import api from '@utils/axiosConfig';

const getTenantHeaders = () => {
  const tenantId = localStorage.getItem('tenantId');
  return {
    'X-Tenant-ID': tenantId,
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  };
};

export const productApi = {
  // Obtener productos con filtros
  getProducts: async (params = {}) => {
    const queryString = new URLSearchParams(
      Object.entries(params).filter(([_, v]) => v != null)
    ).toString();
    
    const response = await api.get(`/products?${queryString}`, {
      headers: getTenantHeaders()
    });
    return response.data;
  },

  // Obtener categorías únicas
  getCategories: async () => {
    const response = await api.get('/products/categories', {
      headers: getTenantHeaders()
    });
    return response.data;
  },

  // Buscar productos por IDs (para mostrar seleccionados)
  getByIds: async (ids = []) => {
    if (!ids.length) return [];
    const response = await api.post('/products/by-ids', { ids }, {
      headers: getTenantHeaders()
    });
    return response.data;
  }
};