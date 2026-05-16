// src/hooks/useProducts.js
import { useEffect, useCallback, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { getProducts } from '../features/product/productSlice';

export const useProducts = (filters = {}) => {
  const dispatch = useDispatch();
  const { products, isLoading, isError, message } = useSelector((state) => state.product);
  
  const [localFilters, setLocalFilters] = useState(filters);

  const fetchProducts = useCallback(() => {
    // Construir params para tu API existente
    const params = {
      search: localFilters.search,
      categoria: localFilters.category,
      subcategoria: localFilters.subcategory,
      condicion: localFilters.condition,
      minPrice: localFilters.minPrice,
      maxPrice: localFilters.maxPrice,
      page: localFilters.page || 1,
      limit: localFilters.limit || 50,
      ...localFilters // otros filtros personalizados
    };

    // Remover undefined/null
    const cleanParams = Object.fromEntries(
      Object.entries(params).filter(([_, v]) => v != null)
    );

    dispatch(getProducts(cleanParams));
  }, [dispatch, localFilters]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Normalizar productos para el selector (mapeo de campos)
  const normalizedProducts = products.map(p => ({
    id: p._id,
    _id: p._id,
    name: p.title,           // ← Mapeo clave
    title: p.title,
    sku: p.slug || p._id,
    price: p.price,
    currency: p.currency || 'ARS',
    category: p.categoria,    // ← Mapeo clave
    categoria: p.categoria,
    subcategoria: p.subcategoria,
    marca: p.marca,
    stock: p.stock,
    condicion: p.condicion,
    images: p.images || [],
    rating: p.totalrating,
    validado: p.validado
  }));

  // Extraer categorías únicas de los productos cargados
  const categories = [...new Set(products.map(p => p.categoria).filter(Boolean))];

  return {
    products: normalizedProducts,
    rawProducts: products, // Productos originales si los necesitas
    categories,
    loading: isLoading,
    error: isError ? message : null,
    filters: localFilters,
    setFilters: setLocalFilters,
    refetch: fetchProducts
  };
};