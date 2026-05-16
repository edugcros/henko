// src/pages/CategoryPage.jsx
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import Meta from '@components/Meta'
import BreadCrumb from '@components/BreadCrumb'
import Container from '@components/Container'
import ProductCard from '@components/ProductCard'
import productService from '@features/products/productService'

// Componente de paginación reutilizable
const Pagination = ({ page, totalPages, onPageChange, loading }) => (
  <div className="mt-4 d-flex justify-content-center align-items-center gap-3">
    <button
      className="btn btn-outline-primary"
      disabled={page <= 1 || loading}
      onClick={() => onPageChange(page - 1)}
    >
      ← Anterior
    </button>

    <div className="d-flex align-items-center gap-2">
      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
        // Lógica para mostrar páginas alrededor de la actual
        let pageNum = i + 1
        if (totalPages > 5 && page > 3) {
          pageNum = page - 2 + i
          if (pageNum > totalPages) pageNum = totalPages - (4 - i)
        }

        return (
          <button
            key={pageNum}
            className={`btn btn-sm ${pageNum === page ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => onPageChange(pageNum)}
            disabled={loading}
          >
            {pageNum}
          </button>
        )
      })}
    </div>

    <button
      className="btn btn-outline-primary"
      disabled={page >= totalPages || loading}
      onClick={() => onPageChange(page + 1)}
    >
      Siguiente →
    </button>
  </div>
)

const CategoryPage = () => {
  const { categoryName } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()

  // Estado con estructura clara
  const [state, setState] = useState({
    products: [],
    page: parseInt(searchParams.get('page')) || 1,
    totalPages: 1,
    total: 0,
    loading: false,
    error: null,
    hasMore: false,
  })

  // Refs para control
  const abortControllerRef = useRef(null)
  const isMountedRef = useRef(true)
  const lastCategoryRef = useRef(categoryName)

  // Scroll suave al top
  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  // Fetch con manejo de abort y acumulación
  const fetchProducts = useCallback(
    async (pageNum, append = false) => {
      // Cancelar request anterior
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      abortControllerRef.current = new AbortController()

      setState(prev => ({
        ...prev,
        loading: true,
        error: null,
        // Si no es append, limpiar productos para evitar flash de datos viejos
        products: append ? prev.products : [],
      }))

      try {
        const res = await productService.getAllProducts({
          categoria: categoryName,
          page: pageNum,
          limit: 12,
          // Pasar signal para cancelación
          signal: abortControllerRef.current.signal,
        })

        // Verificar si el componente sigue montado
        if (!isMountedRef.current) return

        const newProducts = res?.data || []
        const total = res?.total || 0
        const totalPages = res?.totalPages || 1

        setState(prev => ({
          ...prev,
          products: append ? [...prev.products, ...newProducts] : newProducts,
          page: pageNum,
          totalPages,
          total,
          hasMore: pageNum < totalPages,
          loading: false,
        }))

        // Actualizar URL sin recargar
        setSearchParams({ page: pageNum.toString() }, { replace: true })
      } catch (err) {
        // Ignorar errores de abort
        if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
          return
        }

        if (!isMountedRef.current) return

        const message =
          err?.response?.data?.message ||
          err?.message ||
          'Error al obtener los productos. Intenta nuevamente.'

        console.error('[CategoryPage] Error:', {
          message,
          category: categoryName,
          page: pageNum,
          status: err?.response?.status,
        })

        setState(prev => ({
          ...prev,
          error: message,
          loading: false,
          products: append ? prev.products : [], // Mantener productos si es append
        }))
      }
    },
    [categoryName, setSearchParams],
  )

  // Cambio de página con scroll
  const handlePageChange = useCallback(
    newPage => {
      scrollToTop()
      fetchProducts(newPage)
    },
    [fetchProducts, scrollToTop],
  )

  // Efecto principal: carga inicial y cambio de categoría
  useEffect(() => {
    isMountedRef.current = true

    // Reset al cambiar de categoría
    if (lastCategoryRef.current !== categoryName) {
      lastCategoryRef.current = categoryName
      setState(prev => ({ ...prev, page: 1, products: [] }))
      fetchProducts(1)
    } else {
      fetchProducts(state.page)
    }

    return () => {
      isMountedRef.current = false
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [categoryName, fetchProducts]) // Intencionalmente omitimos state.page

  // Intersection Observer para infinite scroll (opcional)
  const loadMoreRef = useCallback(
    node => {
      if (!node || state.loading || !state.hasMore) return

      const observer = new IntersectionObserver(
        entries => {
          if (entries[0].isIntersecting && state.hasMore && !state.loading) {
            fetchProducts(state.page + 1, true) // Append mode
          }
        },
        { rootMargin: '100px' },
      )

      observer.observe(node)
      return () => observer.disconnect()
    },
    [state.loading, state.hasMore, state.page, fetchProducts],
  )

  // Render helpers
  const renderContent = () => {
    if (state.loading && state.products.length === 0) {
      return (
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Cargando...</span>
          </div>
          <p className="mt-3 text-muted">Cargando productos...</p>
        </div>
      )
    }

    if (state.error) {
      return (
        <div className="alert alert-danger d-flex align-items-center" role="alert">
          <i className="bi bi-exclamation-triangle-fill me-2"></i>
          <div>
            <strong>Error:</strong> {state.error}
            <button
              className="btn btn-sm btn-outline-danger ms-3"
              onClick={() => fetchProducts(state.page)}
            >
              Reintentar
            </button>
          </div>
        </div>
      )
    }

    if (state.products.length === 0) {
      return (
        <div className="text-center py-5">
          <i className="bi bi-inbox fs-1 text-muted"></i>
          <p className="mt-3 text-muted">
            No hay productos disponibles en <strong>{categoryName}</strong>.
          </p>
          <a href="/product" className="btn btn-primary">
            Ver todos los productos
          </a>
        </div>
      )
    }

    return (
      <>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <p className="text-muted mb-0">
            Mostrando {state.products.length} de {state.total} productos
          </p>
          {state.loading && (
            <span className="badge bg-secondary">
              <span className="spinner-border spinner-border-sm me-1"></span>
              Actualizando...
            </span>
          )}
        </div>

        <div className="row g-4">
          <ProductCard data={state.products} grid={4} />
        </div>

        {/* Infinite scroll trigger (opcional) */}
        <div ref={loadMoreRef} style={{ height: '20px' }} />

        {/* Paginación clásica */}
        {state.totalPages > 1 && (
          <Pagination
            page={state.page}
            totalPages={state.totalPages}
            onPageChange={handlePageChange}
            loading={state.loading}
          />
        )}
      </>
    )
  }

  return (
    <>
      <Meta
        title={`${categoryName} | Categoría`}
        description={`Explora los mejores productos en ${categoryName}. Encuentra ofertas y novedades.`}
      />

      <BreadCrumb
        title={categoryName}
        items={[
          { label: 'Inicio', path: '/' },
          { label: 'Categorías', path: '/categories' },
          { label: categoryName },
        ]}
      />

      <Container class1="store-wrapper py-5">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h2 className="text-capitalize m-0">{categoryName}</h2>

          {/* Filtros rápidos (placeholder para extensión) */}
          <div className="btn-group">
            <button className="btn btn-outline-secondary btn-sm dropdown-toggle">
              Ordenar por
            </button>
            <button className="btn btn-outline-secondary btn-sm dropdown-toggle">Filtrar</button>
          </div>
        </div>

        {renderContent()}
      </Container>
    </>
  )
}

export default CategoryPage
