import React, { useState } from 'react'
import { useDispatch } from 'react-redux'
import { generateBulkCoupons } from '@features/coupons/couponSlice'
import './BulkGenerator.css'

const formatDateTimeLocal = date => {
  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16)
}

const BulkGenerator = ({ onSuccess, onCancel }) => {
  const dispatch = useDispatch()
  const now = new Date()
  const defaultEndDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const [config, setConfig] = useState({
    count: 10,
    prefix: '',
    discountType: 'percentage',
    discountValue: 10,
    minPurchaseAmount: 0,
    usageLimitPerUser: 1,
    startDate: formatDateTimeLocal(now),
    endDate: formatDateTimeLocal(defaultEndDate),
    applicableProducts: [],
  })

  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})

  const handleChange = e => {
    const { name, value, type } = e.target
    setConfig(prev => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) || 0 : value,
    }))
  }

  const validate = () => {
    const newErrors = {}
    if (config.count < 1 || config.count > 100) {
      newErrors.count = 'Debe generar entre 1 y 100 cupones'
    }
    if (config.discountValue <= 0) {
      newErrors.discountValue = 'El descuento debe ser mayor a 0'
    }
    if (config.discountType === 'percentage' && config.discountValue > 100) {
      newErrors.discountValue = 'No puede exceder 100%'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async e => {
    e.preventDefault()
    if (!validate()) return

    setLoading(true)
    try {
      const result = await dispatch(generateBulkCoupons(config)).unwrap()
      onSuccess?.(result)
    } catch (error) {
      setErrors(prev => ({
        ...prev,
        submit: error?.message || 'No se pudieron generar los cupones',
      }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bulk-generator">
      <div className="generator-header">
        <h3>Generación Masiva de Cupones</h3>
        <p>Se generarán {config.count} códigos únicos automáticamente</p>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Cantidad *</label>
          <input
            type="number"
            name="count"
            value={config.count}
            onChange={handleChange}
            min="1"
            max="100"
            className={errors.count ? 'error' : ''}
          />
          {errors.count && <span className="error-text">{errors.count}</span>}
        </div>

        <div className="form-group">
          <label>Prefijo (opcional)</label>
          <input
            type="text"
            name="prefix"
            value={config.prefix}
            onChange={handleChange}
            placeholder="EJ: VERANO"
            style={{ textTransform: 'uppercase' }}
          />
          <small>Los códigos serán: {config.prefix}XXXXXX</small>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Tipo de Descuento</label>
          <select name="discountType" value={config.discountType} onChange={handleChange}>
            <option value="percentage">Porcentaje (%)</option>
            <option value="fixed_amount">Monto Fijo ($)</option>
          </select>
        </div>

        <div className="form-group">
          <label>Valor del Descuento *</label>
          <input
            type="number"
            name="discountValue"
            value={config.discountValue}
            onChange={handleChange}
            step="0.01"
            min="0"
            className={errors.discountValue ? 'error' : ''}
          />
          {errors.discountValue && <span className="error-text">{errors.discountValue}</span>}
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Compra Mínima ($)</label>
          <input
            type="number"
            name="minPurchaseAmount"
            value={config.minPurchaseAmount}
            onChange={handleChange}
            min="0"
            step="0.01"
          />
        </div>

        <div className="form-group">
          <label>Límite por Usuario</label>
          <input
            type="number"
            name="usageLimitPerUser"
            value={config.usageLimitPerUser}
            onChange={handleChange}
            min="1"
          />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Fecha de Inicio</label>
          <input
            type="datetime-local"
            name="startDate"
            value={config.startDate}
            onChange={handleChange}
          />
        </div>

        <div className="form-group">
          <label>Fecha de Fin</label>
          <input
            type="datetime-local"
            name="endDate"
            value={config.endDate}
            onChange={handleChange}
          />
        </div>
      </div>

      <div className="preview-box">
        <h4>Vista previa del código:</h4>
        <code>
          {config.prefix}
          {'XXXXXX'.slice(0, 8 - config.prefix.length)}
        </code>
        <p>
          Ejemplo: <strong>{config.prefix}A7B9C2</strong>
        </p>
      </div>
      {errors.submit && <span className="error-text">{errors.submit}</span>}

      <div className="form-actions">
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancelar
        </button>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Generando...' : `Generar ${config.count} Cupones`}
        </button>
      </div>
    </form>
  )
}

export default BulkGenerator
