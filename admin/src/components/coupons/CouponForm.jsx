// src/components/coupons/CouponForm.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import PropTypes from 'prop-types'
import './CouponForm.css'
import ProductSelector from './ProductSelector'

// ======================================================
// CONSTANTES
// ======================================================

const DEFAULT_COUPON = {
  code: '',
  description: '',
  discountType: 'percentage',
  discountValue: 10,
  minPurchaseAmount: 0,
  maxDiscountAmount: '',
  usageLimit: '',
  usageLimitPerUser: 1,
  startDate: '',
  endDate: '',
  applicableProducts: [],
  excludedProducts: [],
  stackable: false,
  priority: 0,
  isActive: true
}

const TABS = [
  { id: 'basic', label: 'Básico', icon: '📝' },
  { id: 'conditions', label: 'Condiciones', icon: '⚙️' },
  { id: 'products', label: 'Productos', icon: '🛍️' },
  { id: 'advanced', label: 'Avanzado', icon: '🔧' }
]

// ======================================================
// UTILIDADES
// ======================================================

const formatDateForInput = (date) => {
  if (!date) return ''
  try {
    const d = new Date(date)
    if (isNaN(d.getTime())) return ''
    const timezoneOffsetMs = d.getTimezoneOffset() * 60 * 1000
    return new Date(d.getTime() - timezoneOffsetMs).toISOString().slice(0, 16)
  } catch {
    return ''
  }
}

const getDefaultDates = () => {
  const now = new Date()
  const oneWeekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  return {
    startDate: formatDateForInput(now),
    endDate: formatDateForInput(oneWeekLater)
  }
}

const normalizeProducts = (products) => {
  if (!Array.isArray(products)) return []
  return products.map(p => p?._id?.toString?.() || p?.id?.toString?.() || p?.toString?.()).filter(Boolean)
}

// ======================================================
// COMPONENTE
// ======================================================

const CouponForm = ({ 
  initialData, 
  onSubmit, 
  onCancel,
  isSubmitting = false,
  serverErrors = null
}) => {
  const isMounted = useRef(false)
  const formRef = useRef(null)
  
  // Estados
  const [formData, setFormData] = useState(() => {
    const defaults = getDefaultDates()
    return {
      ...DEFAULT_COUPON,
      ...defaults
    }
  })
  
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [activeTab, setActiveTab] = useState('basic')
  const [autoGenerate, setAutoGenerate] = useState(true)
  const [productCount, setProductCount] = useState(0)

  // ======================================================
  // EFECTOS
  // ======================================================

  // Cargar datos iniciales
  useEffect(() => {
    isMounted.current = true
    
    if (initialData) {
      const normalizedProducts = normalizeProducts(initialData.applicableProducts)
      
      setFormData(prev => ({
        ...prev,
        ...initialData,
        code: initialData.code || '',
        description: initialData.description || '',
        discountType: initialData.discountType || 'percentage',
        discountValue: initialData.discountValue ?? 10,
        minPurchaseAmount: initialData.minPurchaseAmount ?? 0,
        maxDiscountAmount: initialData.maxDiscountAmount || '',
        usageLimit: initialData.usageLimit || '',
        usageLimitPerUser: initialData.usageLimitPerUser ?? 1,
        startDate: formatDateForInput(initialData.startDate) || prev.startDate,
        endDate: formatDateForInput(initialData.endDate) || prev.endDate,
        applicableProducts: normalizedProducts,
        excludedProducts: normalizeProducts(initialData.excludedProducts),
        stackable: !!initialData.stackable,
        priority: initialData.priority ?? 0,
        isActive: initialData.isActive !== false
      }))
      
      setAutoGenerate(!initialData.code)
      setProductCount(normalizedProducts.length)
    }
    
    return () => {
      isMounted.current = false
    }
  }, [initialData])

  // Sincronizar errores del servidor
  useEffect(() => {
    if (serverErrors) {
      setErrors(prev => ({
        ...prev,
        ...serverErrors
      }))
      
      // Auto-focus al primer error
      const firstErrorField = Object.keys(serverErrors)[0]
      if (firstErrorField) {
        const element = document.querySelector(`[name="${firstErrorField}"]`)
        element?.focus()
      }
    }
  }, [serverErrors])

  // ======================================================
  // VALIDACIÓN
  // ======================================================

  const validateField = useCallback((name, value, allValues = formData) => {
    switch (name) {
      case 'code':
        if (!autoGenerate && (!value || value.trim().length < 3)) {
          return 'El código debe tener al menos 3 caracteres'
        }
        return null
        
      case 'description':
        if (!value?.trim()) return 'La descripción es requerida'
        if (value.trim().length < 5) return 'Mínimo 5 caracteres'
        return null
        
      case 'discountValue': {
        const num = parseFloat(value)
        if (isNaN(num) || num <= 0) return 'Debe ser mayor a 0'
        if (allValues.discountType === 'percentage' && num > 100) {
          return 'No puede exceder 100%'
        }
        return null
      }
        
      case 'minPurchaseAmount':
        if (value && parseFloat(value) < 0) return 'No puede ser negativo'
        return null
        
      case 'endDate': {
        const start = new Date(allValues.startDate)
        const end = new Date(value)
        if (end <= start) return 'Debe ser posterior a la fecha de inicio'
        return null
      }
        
      case 'usageLimitPerUser':
        if (parseInt(value) < 1) return 'Mínimo 1 uso por usuario'
        return null
        
      default:
        return null
    }
  }, [autoGenerate, formData])

  const validateForm = useCallback(() => {
    const newErrors = {}
    let isValid = true
    
    // Validar todos los campos requeridos
    const fieldsToValidate = ['description', 'discountValue', 'endDate']
    if (!autoGenerate) fieldsToValidate.push('code')
    
    fieldsToValidate.forEach(field => {
      const error = validateField(field, formData[field], formData)
      if (error) {
        newErrors[field] = error
        isValid = false
      }
    })
    
    setErrors(newErrors)
    return isValid
  }, [formData, autoGenerate, validateField])

  // ======================================================
  // HANDLERS
  // ======================================================

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target
    const newValue = type === 'checkbox' ? checked : value
    
    setFormData(prev => ({
      ...prev,
      [name]: newValue
    }))
    
    // Marcar como tocado
    setTouched(prev => ({ ...prev, [name]: true }))
    
    // Validación en tiempo real
    const error = validateField(name, newValue, {
      ...formData,
      [name]: newValue
    })
    
    setErrors(prev => ({
      ...prev,
      [name]: error
    }))
  }, [formData, validateField])

  const handleBlur = useCallback((e) => {
    const { name } = e.target
    setTouched(prev => ({ ...prev, [name]: true }))
  }, [])

  const handleProductsChange = useCallback((products) => {
    const normalized = normalizeProducts(products)
    setFormData(prev => ({
      ...prev,
      applicableProducts: normalized
    }))
    setProductCount(normalized.length)
    setTouched(prev => ({ ...prev, applicableProducts: true }))
  }, [])

  const handleAutoGenerateChange = useCallback((e) => {
    const checked = e.target.checked
    setAutoGenerate(checked)
    if (checked) {
      setFormData(prev => ({ ...prev, code: '' }))
      setErrors(prev => ({ ...prev, code: null }))
    }
  }, [])

  const handleTabChange = useCallback((tabId) => {
    // Validar tab actual antes de cambiar
    if (activeTab === 'basic') {
      const requiredFields = autoGenerate 
        ? ['description', 'discountValue'] 
        : ['code', 'description', 'discountValue']
      
      const hasErrors = requiredFields.some(field => {
        const error = validateField(field, formData[field])
        return !!error
      })
      
      if (hasErrors) {
        setTouched(prev => ({
          ...prev,
          ...requiredFields.reduce((acc, f) => ({ ...acc, [f]: true }), {})
        }))
        // No cambiar de tab si hay errores
        return
      }
    }
    
    setActiveTab(tabId)
  }, [activeTab, autoGenerate, formData, validateField])

  const handleSubmit = useCallback((e) => {
    e.preventDefault()
    
    // Marcar todos como tocados
    const allFields = Object.keys(formData)
    setTouched(allFields.reduce((acc, key) => ({ ...acc, [key]: true }), {}))
    
    if (!validateForm()) {
      // Scroll al primer error
      const firstErrorElement = formRef.current?.querySelector('.error')
      firstErrorElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    
      const dataToSubmit = {
        ...formData,
        ...(autoGenerate
          ? {}
          : { code: formData.code.trim().toUpperCase() }),
        description: formData.description.trim(),
        discountValue: parseFloat(formData.discountValue),
        minPurchaseAmount: parseFloat(formData.minPurchaseAmount) || 0,
        maxDiscountAmount: formData.maxDiscountAmount
          ? parseFloat(formData.maxDiscountAmount)
          : null,
        usageLimit: formData.usageLimit
          ? parseInt(formData.usageLimit)
          : null,
        usageLimitPerUser: parseInt(formData.usageLimitPerUser) || 1,
        priority: parseInt(formData.priority) || 0,
        applicableProducts: formData.applicableProducts
      }

          
    onSubmit?.(dataToSubmit)
  }, [formData, autoGenerate, validateForm, onSubmit])

  // ======================================================
  // RENDER HELPERS
  // ======================================================

  const getTabLabel = useCallback((tab) => {
    if (tab.id === 'products') {
      return `${tab.label} (${productCount})`
    }
    return tab.label
  }, [productCount])

  const inputProps = useCallback((name) => ({
    name,
    value: formData[name],
    onChange: handleChange,
    onBlur: handleBlur,
    'aria-invalid': !!errors[name],
    'aria-describedby': errors[name] ? `${name}-error` : undefined
  }), [formData, errors, handleChange, handleBlur])

  // ======================================================
  // RENDER
  // ======================================================

  return (
    <form 
      ref={formRef}
      onSubmit={handleSubmit} 
      className="coupon-form"
      noValidate
    >
      {/* Tabs */}
      <div className="form-tabs" role="tablist">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            className={`tab-button ${activeTab === tab.id ? 'active' : ''} ${
              tab.id === 'products' && productCount > 0 ? 'has-badge' : ''
            }`}
            onClick={() => handleTabChange(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span className="tab-label">{getTabLabel(tab)}</span>
            {tab.id === 'products' && productCount > 0 && (
              <span className="tab-badge">{productCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Contenido de tabs */}
      <div className="form-content">
        {/* Tab Básico */}
        {activeTab === 'basic' && (
          <div 
            id="panel-basic"
            role="tabpanel"
            className="tab-panel"
          >
            <div className={`form-group checkbox-group ${autoGenerate ? 'checked' : ''}`}>
              <label className="checkbox-label">
                <input 
                  type="checkbox" 
                  checked={autoGenerate}
                  onChange={handleAutoGenerateChange}
                  disabled={isSubmitting}
                />
                <span className="checkmark"></span>
                <span className="label-text">Generar código automáticamente</span>
              </label>
              <small className="help-text">
                El sistema creará un código único aleatorio
              </small>
            </div>

            {!autoGenerate && (
              <div className={`form-group ${errors.code && touched.code ? 'has-error' : ''}`}>
                <label htmlFor="code">
                  Código del Cupón <span className="required">*</span>
                </label>
                <div className="input-wrapper">
                  <input
                    id="code"
                    type="text"
                    placeholder="EJ: VERANO2024"
                    style={{ textTransform: 'uppercase' }}
                    disabled={isSubmitting}
                    {...inputProps('code')}
                  />
                  <span className="input-hint">Mínimo 3 caracteres</span>
                </div>
                {errors.code && touched.code && (
                  <span id="code-error" className="error-message" role="alert">
                    {errors.code}
                  </span>
                )}
              </div>
            )}

            <div className={`form-group ${errors.description && touched.description ? 'has-error' : ''}`}>
              <label htmlFor="description">
                Descripción <span className="required">*</span>
              </label>
              <textarea
                id="description"
                placeholder="Ej: 20% de descuento en toda la tienda"
                rows="3"
                disabled={isSubmitting}
                {...inputProps('description')}
              />
              {errors.description && touched.description && (
                <span id="description-error" className="error-message" role="alert">
                  {errors.description}
                </span>
              )}
            </div>

            <div className="form-row two-columns">
              <div className={`form-group ${errors.discountValue && touched.discountValue ? 'has-error' : ''}`}>
                <label htmlFor="discountType">Tipo de Descuento</label>
                <select 
                  id="discountType"
                  disabled={isSubmitting}
                  {...inputProps('discountType')}
                >
                  <option value="percentage">Porcentaje (%)</option>
                  <option value="fixed_amount">Monto Fijo ($)</option>
                </select>
              </div>

              <div className={`form-group ${errors.discountValue && touched.discountValue ? 'has-error' : ''}`}>
                <label htmlFor="discountValue">
                  Valor <span className="required">*</span>
                </label>
                <div className="input-with-prefix">
                  <span className="prefix">
                    {formData.discountType === 'percentage' ? '%' : '$'}
                  </span>
                  <input
                    id="discountValue"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0"
                    disabled={isSubmitting}
                    {...inputProps('discountValue')}
                  />
                </div>
                {errors.discountValue && touched.discountValue && (
                  <span id="discountValue-error" className="error-message" role="alert">
                    {errors.discountValue}
                  </span>
                )}
              </div>
            </div>

            {formData.discountType === 'percentage' && (
              <div className="form-group">
                <label htmlFor="maxDiscountAmount">Descuento Máximo (opcional)</label>
                <div className="input-with-prefix">
                  <span className="prefix">$</span>
                  <input
                    id="maxDiscountAmount"
                    type="number"
                    placeholder="Sin límite"
                    min="0"
                    step="0.01"
                    disabled={isSubmitting}
                    {...inputProps('maxDiscountAmount')}
                  />
                </div>
                <small className="help-text">
                  Límite máximo de descuento en pesos
                </small>
              </div>
            )}
          </div>
        )}

        {/* Tab Condiciones */}
        {activeTab === 'conditions' && (
          <div id="panel-conditions" role="tabpanel" className="tab-panel">
            <div className="form-row two-columns">
              <div className="form-group">
                <label htmlFor="minPurchaseAmount">Compra Mínima ($)</label>
                <div className="input-with-prefix">
                  <span className="prefix">$</span>
                  <input
                    id="minPurchaseAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    disabled={isSubmitting}
                    {...inputProps('minPurchaseAmount')}
                  />
                </div>
              </div>
            </div>

            <div className="form-row two-columns">
              <div className="form-group">
                <label htmlFor="usageLimit">Límite Total de Usos</label>
                <input
                  id="usageLimit"
                  type="number"
                  min="1"
                  placeholder="Ilimitado"
                  disabled={isSubmitting}
                  {...inputProps('usageLimit')}
                />
                <small className="help-text">Dejar vacío para usos ilimitados</small>
              </div>

              <div className={`form-group ${errors.usageLimitPerUser ? 'has-error' : ''}`}>
                <label htmlFor="usageLimitPerUser">Límite por Usuario</label>
                <input
                  id="usageLimitPerUser"
                  type="number"
                  min="1"
                  disabled={isSubmitting}
                  {...inputProps('usageLimitPerUser')}
                />
              </div>
            </div>

            <div className="form-row two-columns">
              <div className="form-group">
                <label htmlFor="startDate">
                  Fecha de Inicio <span className="required">*</span>
                </label>
                <input
                  id="startDate"
                  type="datetime-local"
                  required
                  disabled={isSubmitting}
                  {...inputProps('startDate')}
                />
              </div>

              <div className={`form-group ${errors.endDate && touched.endDate ? 'has-error' : ''}`}>
                <label htmlFor="endDate">
                  Fecha de Fin <span className="required">*</span>
                </label>
                <input
                  id="endDate"
                  type="datetime-local"
                  required
                  disabled={isSubmitting}
                  {...inputProps('endDate')}
                />
                {errors.endDate && touched.endDate && (
                  <span id="endDate-error" className="error-message" role="alert">
                    {errors.endDate}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab Productos */}
        {activeTab === 'products' && (
          <div id="panel-products" role="tabpanel" className="tab-panel">
            <ProductSelector
              selected={formData.applicableProducts}
              onChange={handleProductsChange}
              disabled={isSubmitting}
              maxSelection={100}
            />
            
            <div className={`info-box ${productCount === 0 ? 'info' : 'success'}`}>
              <span className="info-icon">
                {productCount === 0 ? '💡' : '✓'}
              </span>
              <div className="info-content">
                <strong>
                  {productCount === 0 
                    ? 'Cupón universal' 
                    : `${productCount} producto(s) seleccionado(s)`}
                </strong>
                <p>
                  {productCount === 0 
                    ? 'El cupón aplicará a TODOS los productos de la tienda.' 
                    : 'El cupón solo aplicará a los productos seleccionados.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab Avanzado */}
        {activeTab === 'advanced' && (
          <div id="panel-advanced" role="tabpanel" className="tab-panel">
            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="stackable"
                  checked={formData.stackable}
                  onChange={handleChange}
                  disabled={isSubmitting}
                />
                <span className="checkmark"></span>
                <span className="label-text">Permitir combinación con otros cupones</span>
              </label>
              <small className="help-text">
                Los clientes podrán usar este cupón junto con otros
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="priority">Prioridad</label>
              <input
                id="priority"
                type="number"
                min="0"
                placeholder="0"
                disabled={isSubmitting}
                {...inputProps('priority')}
              />
              <small className="help-text">
                Mayor número = se aplica primero cuando hay múltiples cupones
              </small>
            </div>

            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="isActive"
                  checked={formData.isActive}
                  onChange={handleChange}
                  disabled={isSubmitting}
                />
                <span className="checkmark"></span>
                <span className="label-text">Cupón activo</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Acciones */}
      <div className="form-actions">
        <button 
          type="button" 
          onClick={onCancel} 
          className="btn-secondary"
          disabled={isSubmitting}
        >
          Cancelar
        </button>
        <button 
          type="submit" 
          className="btn-primary"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <span className="spinner-small"></span>
              {initialData ? 'Actualizando...' : 'Creando...'}
            </>
          ) : (
            initialData ? 'Actualizar Cupón' : 'Crear Cupón'
          )}
        </button>
      </div>
    </form>
  )
}

// ======================================================
// PROP TYPES
// ======================================================

CouponForm.propTypes = {
  initialData: PropTypes.shape({
    _id: PropTypes.string,
    code: PropTypes.string,
    description: PropTypes.string,
    discountType: PropTypes.oneOf(['percentage', 'fixed_amount']),
    discountValue: PropTypes.number,
    minPurchaseAmount: PropTypes.number,
    maxDiscountAmount: PropTypes.number,
    usageLimit: PropTypes.number,
    usageLimitPerUser: PropTypes.number,
    startDate: PropTypes.string,
    endDate: PropTypes.string,
    applicableProducts: PropTypes.array,
    excludedProducts: PropTypes.array,
    stackable: PropTypes.bool,
    priority: PropTypes.number,
    isActive: PropTypes.bool
  }),
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  isSubmitting: PropTypes.bool,
  serverErrors: PropTypes.object
}

CouponForm.defaultProps = {
  initialData: null,
  isSubmitting: false,
  serverErrors: null
}

export default React.memo(CouponForm)
