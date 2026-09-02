// src/components/coupons/ProductSelector.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { getProducts } from '../../features/product/productSlice'
import './ProductSelector.css'

// ======================================================
// CONSTANTES
// ======================================================

const DEBOUNCE_MS = 300
const LIMIT_PRODUCTS = 100
const PLACEHOLDER_IMAGE = '/placeholder-product.png'

// ======================================================
// UTILIDADES
// ======================================================

const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

const normalizeId = id => id?.toString?.() || id

// ======================================================
// COMPONENTE
// ======================================================

const ProductSelector = ({
  selected = [],
  onChange,
  disabled = false,
  maxSelection = null, // límite opcional de selección
}) => {
  const dispatch = useDispatch()

  // Refs para control de montaje y prevención de memory leaks
  const isMounted = useRef(false)
  const previousOnChange = useRef(onChange)

  // Selectores optimizados
  const {
    items: products,
    isLoading,
    error: productsError,
  } = useSelector(state => ({
    items: state.product.products || [],
    isLoading: state.product.isLoading,
    error: state.product.error,
  }))

  // Estados locales
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [localSelected, setLocalSelected] = useState(() => selected.map(normalizeId))
  const [imageErrors, setImageErrors] = useState(new Set())

  // Debounce de búsqueda
  const debouncedSearch = useDebounce(search, DEBOUNCE_MS)

  // ======================================================
  // EFECTOS
  // ======================================================

  // Carga inicial de productos - SOLO UNA VEZ
  useEffect(() => {
    isMounted.current = true

    const loadProducts = async () => {
      const tenantId = localStorage.getItem('tenantId')

      try {
        await dispatch(
          getProducts({
            tenantId: tenantId || undefined,
            limit: LIMIT_PRODUCTS,
            isActive: true, // Solo productos activos
          }),
        ).unwrap()
      } catch (err) {
        console.error('Error cargando productos:', err)
      }
    }

    loadProducts()

    return () => {
      isMounted.current = false
    }
  }, [dispatch]) // Sin dependencias variables

  // Sincronizar props selected con estado local
  useEffect(() => {
    const normalizedSelected = selected.map(normalizeId)
    const currentString = JSON.stringify(localSelected.sort())
    const newString = JSON.stringify(normalizedSelected.sort())

    if (currentString !== newString) {
      setLocalSelected(normalizedSelected)
    }
  }, [selected])

  // Notificar cambios al padre (solo cuando cambia localSelected)
  useEffect(() => {
    // Evitar llamada inicial y comparar con valor anterior
    if (!isMounted.current) return

    const normalizedSelected = selected.map(normalizeId)
    const hasChanged =
      JSON.stringify(localSelected.sort()) !== JSON.stringify(normalizedSelected.sort())

    if (hasChanged && previousOnChange.current === onChange) {
      onChange?.([...localSelected]) // Crear nueva referencia
    }

    previousOnChange.current = onChange
  }, [localSelected, onChange]) // selected omitido intencionalmente

  // Búsqueda con debounce
  useEffect(() => {
    if (!isMounted.current) return

    const searchProducts = async () => {
      const tenantId = localStorage.getItem('tenantId')

      try {
        await dispatch(
          getProducts({
            tenantId: tenantId || undefined,
            search: debouncedSearch || undefined,
            categoria: category || undefined,
            limit: LIMIT_PRODUCTS,
            isActive: true,
          }),
        ).unwrap()
      } catch {
        // Error silencioso - se muestra en UI
      }
    }

    // Solo buscar si hay filtros o si ya se cargaron productos inicialmente
    if (debouncedSearch || category) {
      searchProducts()
    }
  }, [debouncedSearch, category, dispatch])

  // ======================================================
  // HANDLERS
  // ======================================================

  const toggleProduct = useCallback(
    productId => {
      if (disabled) return

      const normalizedProductId = normalizeId(productId)

      setLocalSelected(prev => {
        const isSelected = prev.includes(normalizedProductId)

        // Validar límite de selección
        if (!isSelected && maxSelection && prev.length >= maxSelection) {
          return prev // No permitir exceder límite
        }

        return isSelected
          ? prev.filter(id => id !== normalizedProductId)
          : [...prev, normalizedProductId]
      })
    },
    [disabled, maxSelection],
  )

  const handleImageError = useCallback(productId => {
    setImageErrors(prev => new Set(prev).add(productId))
  }, [])

  const clearSelection = useCallback(() => {
    if (disabled) return
    setLocalSelected([])
  }, [disabled])

  const selectAll = useCallback(() => {
    if (disabled) return

    const allIds = products.map(p => normalizeId(p._id))
    setLocalSelected(maxSelection ? allIds.slice(0, maxSelection) : allIds)
  }, [disabled, maxSelection, products])

  // ======================================================
  // MEMOIZACIONES
  // ======================================================

  // Extraer categorías únicas de productos
  const availableCategories = useMemo(() => {
    const categories = new Set()
    products.forEach(p => {
      if (p.category) categories.add(p.category)
    })
    return Array.from(categories).sort()
  }, [products])

  // Verificar si todos están seleccionados
  const isAllSelected = useMemo(() => {
    if (products.length === 0) return false
    return products.every(p => localSelected.includes(normalizeId(p._id)))
  }, [products, localSelected])

  // ======================================================
  // RENDER HELPERS
  // ======================================================

  const getImageUrl = product => {
    if (imageErrors.has(product._id)) return PLACEHOLDER_IMAGE

    const image = product.images?.[0]
    if (!image) return PLACEHOLDER_IMAGE

    // Manejar diferentes formatos de imagen
    if (typeof image === 'string') {
      return image.startsWith('http') ? image : `${process.env.REACT_APP_API_URL || ''}${image}`
    }

    return image.url || image.secure_url || PLACEHOLDER_IMAGE
  }

  // ======================================================
  // RENDER
  // ======================================================

  return (
    <div className={`product-selector ${disabled ? 'disabled' : ''}`}>
      {/* Header con filtros */}
      <div className="selector-header">
        <div className="search-box">
          <input
            type="text"
            placeholder="Buscar productos..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            disabled={disabled || isLoading}
            aria-label="Buscar productos"
          />
          {search && (
            <button
              className="clear-search"
              onClick={() => setSearch('')}
              aria-label="Limpiar búsqueda"
            >
              ×
            </button>
          )}
        </div>

        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          disabled={disabled || isLoading}
          aria-label="Filtrar por categoría"
        >
          <option value="">Todas las categorías</option>
          {availableCategories.map(cat => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        {/* Acciones masivas */}
        <div className="bulk-actions">
          <button
            onClick={selectAll}
            disabled={disabled || isAllSelected}
            className="btn-select-all"
          >
            Seleccionar todos
          </button>
          <button
            onClick={clearSelection}
            disabled={disabled || localSelected.length === 0}
            className="btn-clear"
          >
            Limpiar
          </button>
        </div>
      </div>

      {/* Estado de carga / error */}
      {isLoading && (
        <div className="state-message loading">
          <span className="spinner" />
          Cargando productos...
        </div>
      )}

      {productsError && <div className="state-message error">Error: {productsError}</div>}

      {/* Grid de productos */}
      {!isLoading && !productsError && (
        <div className="products-grid">
          {products.length === 0 ? (
            <div className="state-message empty">
              {debouncedSearch || category
                ? 'No se encontraron productos con estos filtros'
                : 'No hay productos disponibles'}
            </div>
          ) : (
            products.map(product => {
              const productId = normalizeId(product._id)
              const isSelected = localSelected.includes(productId)

              return (
                <div
                  key={productId}
                  className={`product-card ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
                  onClick={() => toggleProduct(productId)}
                  role="checkbox"
                  aria-checked={isSelected}
                  tabIndex={disabled ? -1 : 0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleProduct(productId)
                    }
                  }}
                >
                  <div className="product-image">
                    <img
                      src={getImageUrl(product)}
                      alt={product.title || 'Producto'}
                      loading="lazy"
                      onError={() => handleImageError(productId)}
                    />
                    {isSelected && (
                      <div className="selection-indicator">
                        <span>✓</span>
                      </div>
                    )}
                  </div>

                  <div className="product-info">
                    <h4 title={product.title}>{product.title}</h4>
                    <p className="price">${parseFloat(product.price || 0).toFixed(2)}</p>
                    {product.stock !== undefined && (
                      <p className={`stock ${product.stock < 10 ? 'low' : ''}`}>
                        Stock: {product.stock}
                      </p>
                    )}
                    {product.category && <span className="category-tag">{product.category}</span>}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Footer con contador */}
      <div className="selector-footer">
        <span className="selection-count">
          {localSelected.length} producto{localSelected.length !== 1 ? 's' : ''} seleccionado
          {maxSelection && ` / ${maxSelection} máximo`}
        </span>

        {maxSelection && localSelected.length >= maxSelection && (
          <span className="limit-warning">Límite alcanzado</span>
        )}
      </div>
    </div>
  )
}

// Memoización del componente para evitar re-renders innecesarios
export default React.memo(ProductSelector, (prevProps, nextProps) => {
  // Comparación profunda de selected
  const prevSelected = JSON.stringify(prevProps.selected?.sort())
  const nextSelected = JSON.stringify(nextProps.selected?.sort())

  return (
    prevSelected === nextSelected &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.maxSelection === nextProps.maxSelection
  )
})
