// src/hooks/useCoupons.js
import { useState, useEffect, useCallback } from 'react'
import { couponService } from '../features/coupons/couponService'

export const useCoupons = (initialFilters = {}) => {
  const [coupons, setCoupons] = useState([])
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    pages: 1,
    limit: 20
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState(initialFilters)

  const fetchCoupons = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      // DEBUG: Ver qué estamos enviando
      console.log('Fetching coupons with filters:', filters)
      
      // Si no hay filtros específicos, no enviar status para traer TODO
      const cleanFilters = {
        page: filters.page || 1,
        limit: filters.limit || 20,
        // Solo enviar status si el usuario lo pidió explícitamente
        ...(filters.status && filters.status !== 'all' ? { status: filters.status } : {}),
        ...(filters.search ? { search: filters.search } : {})
      }
      
      console.log('Clean filters sent to API:', cleanFilters)
      
      const result = await couponService.getCoupons(cleanFilters)
      
      console.log('Coupons received:', result)
      
      setCoupons(result.items)
      setPagination(result.pagination)
    } catch (err) {
      console.error('Error fetching coupons:', err)
      setError(err.message || 'Error al cargar cupones')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    fetchCoupons()
  }, [fetchCoupons])

  return {
    coupons,
    pagination,
    loading,
    error,
    filters,
    setFilters,
    refetch: fetchCoupons
  }
}

export default useCoupons