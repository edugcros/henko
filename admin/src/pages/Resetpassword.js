// 📁 src/pages/Resetpassword.js
import React, { useEffect, useRef, useState } from 'react'
import { useFormik } from 'formik'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as yup from 'yup'
import { CheckOutlined, EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons'
import authService from '@features/auth/authServices'
import AuthShell from '../components/AuthShell.js'

const validationSchema = yup.object({
  password: yup
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .required('La contraseña es obligatoria'),
  confirmPassword: yup
    .string()
    .oneOf([yup.ref('password')], 'Las contraseñas no coinciden')
    .required('Confirmá la contraseña'),
})

// Cuánto se muestra el aviso de «listo» antes de llevar al login.
const REDIRECT_DELAY_MS = 2500

const Resetpassword = () => {
  const { token } = useParams()
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState({ done: false, error: '' })
  const [verPassword, setVerPassword] = useState(false)
  const redirectTimer = useRef(null)

  // Si la persona se va de la pantalla antes de que se cumpla el plazo, no hay que mandarla al
  // login igual: el temporizador seguía corriendo después de desmontar.
  useEffect(() => () => clearTimeout(redirectTimer.current), [])

  const formik = useFormik({
    initialValues: { password: '', confirmPassword: '' },
    validationSchema,
    onSubmit: async values => {
      setIsSubmitting(true)
      setResult({ done: false, error: '' })

      try {
        await authService.resetPassword({ token, password: values.password })
        setResult({ done: true, error: '' })
        redirectTimer.current = setTimeout(() => navigate('/login'), REDIRECT_DELAY_MS)
      } catch (error) {
        setResult({
          done: false,
          error: error?.message || 'Token inválido o expirado. Solicitá uno nuevo.',
        })
      } finally {
        setIsSubmitting(false)
      }
    },
  })

  if (!token) {
    return (
      <AuthShell titleId="reset-title">
        <h1 id="reset-title">El enlace no es válido</h1>
        <p className="hk-auth-lead" role="alert">
          El enlace de recuperación no es válido. Solicitá uno nuevo.
        </p>

        <Link className="hk-auth-submit" to="/forgot-password">
          <span>Pedir un nuevo enlace</span>
        </Link>
      </AuthShell>
    )
  }

  const errorPassword = formik.touched.password && formik.errors.password
  const errorConfirm = formik.touched.confirmPassword && formik.errors.confirmPassword
  const tipoCampo = verPassword ? 'text' : 'password'

  return (
    <AuthShell titleId="reset-title">
      <h1 id="reset-title">{result.done ? '¡Listo!' : 'Elegí tu nueva contraseña'}</h1>
      <p className="hk-auth-lead">
        {result.done
          ? 'Ya podés entrar a tu panel con tu nueva contraseña.'
          : 'Es la que vas a usar para entrar a tu panel.'}
      </p>

      {result.done ? (
        <>
          <div className="hk-auth-notice" role="status">
            <span className="hk-auth-notice-icon" aria-hidden="true">
              <CheckOutlined />
            </span>
            <div>
              <b>Contraseña restablecida</b>
              <p>Contraseña restablecida correctamente. Te redirigimos al login...</p>
            </div>
          </div>

          <Link className="hk-auth-submit" to="/login">
            <span>Ir a iniciar sesión</span>
          </Link>
        </>
      ) : (
        <form onSubmit={formik.handleSubmit} noValidate>
          <div className="hk-auth-field">
            <label htmlFor="password">Nueva contraseña</label>
            <div className="hk-auth-password">
              <input
                id="password"
                name="password"
                type={tipoCampo}
                autoComplete="new-password"
                aria-invalid={Boolean(errorPassword)}
                aria-describedby={errorPassword ? 'password-error' : 'password-hint'}
                {...formik.getFieldProps('password')}
              />
              <button
                type="button"
                className="hk-auth-eye"
                onClick={() => setVerPassword(v => !v)}
                aria-label={verPassword ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
                aria-pressed={verPassword}
              >
                {verPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              </button>
            </div>
            {errorPassword ? (
              <p className="hk-auth-field-error" id="password-error">
                {formik.errors.password}
              </p>
            ) : (
              <p className="hk-auth-hint" id="password-hint">
                Mínimo 8 caracteres.
              </p>
            )}
          </div>

          <div className="hk-auth-field">
            <label htmlFor="confirmPassword">Confirmar contraseña</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type={tipoCampo}
              autoComplete="new-password"
              aria-invalid={Boolean(errorConfirm)}
              aria-describedby={errorConfirm ? 'confirm-error' : undefined}
              {...formik.getFieldProps('confirmPassword')}
            />
            {errorConfirm && (
              <p className="hk-auth-field-error" id="confirm-error">
                {formik.errors.confirmPassword}
              </p>
            )}
          </div>

          <button type="submit" className="hk-auth-submit" disabled={isSubmitting}>
            {/* Texto envuelto, no desnudo: ver website/src/Pages/Login.js. */}
            {isSubmitting && <span className="hk-auth-spinner" aria-hidden="true" />}
            <span>{isSubmitting ? 'Guardando' : 'Restablecer contraseña'}</span>
          </button>

          {result.error && (
            <div className="hk-auth-alert" role="alert">
              <p>{result.error}</p>
              <Link className="hk-auth-link is-strong" to="/forgot-password">
                Pedir un nuevo enlace
              </Link>
            </div>
          )}
        </form>
      )}

      {!result.done && (
        <p className="hk-auth-foot">
          <Link className="hk-auth-link is-strong" to="/login">
            Volver a iniciar sesión
          </Link>
        </p>
      )}
    </AuthShell>
  )
}

export default Resetpassword
