// 📁 src/pages/Login.js
import React, { useEffect, useState } from 'react'
import { useFormik } from 'formik'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import * as yup from 'yup'
import {
  CreditCardOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  RobotOutlined,
  ShopOutlined,
} from '@ant-design/icons'
import { loginUser, clearState, setCsrfToken } from '@features/auth/authSlice'
import api, { fetchCsrfToken } from '@utils/axiosConfig'
import { env } from '../config/env.js'
import logoHenkart from '../assets/images/logo-henkart.png'
import './Login.css'

// Esquema de validación
const validationSchema = yup.object({
  email: yup.string().email('Debe ser un correo válido').required('El correo es obligatorio'),
  password: yup.string().required('La contraseña es obligatoria'),
})

// Lo que el panel hace hoy, dicho como lo dice la pantalla de planes: nada de
// esto es una promesa nueva.
const BENEFICIOS = [
  {
    icon: ShopOutlined,
    title: 'Pedidos, clientes y stock',
    text: 'Todo lo de tu tienda en un solo panel, en español.',
  },
  {
    icon: CreditCardOutlined,
    title: 'Cobros con Mercado Pago',
    text: 'Cobrás desde tu tienda, en tu propia cuenta.',
  },
  {
    icon: RobotOutlined,
    title: 'IA para vender',
    text: 'Fichas de producto y asistente de ventas, con cupos según tu plan.',
  },
]

const urlDelSitio = () => {
  const dominio = String(env?.publicBaseDomain || '').trim()

  if (!dominio) return null
  if (/^https?:\/\//i.test(dominio)) return dominio

  return `${window.location.protocol}//${dominio}`
}

const Login = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [verPassword, setVerPassword] = useState(false)

  // Extraemos el estado global de Redux
  const { user, isError, isSuccess, message, isNotVerified } = useSelector(
    state => state.user || {},
  )

  const [resendState, setResendState] = useState({
    sending: false,
    message: '',
    error: false,
  })

  const handleResendVerification = async () => {
    setResendState({ sending: true, message: '', error: false })

    try {
      const { data } = await api.post('/user/resend-verification', {
        email: formik.values.email,
      })

      setResendState({
        sending: false,
        error: false,
        message: data?.message || 'Listo, revisá tu correo.',
      })
    } catch (error) {
      setResendState({
        sending: false,
        error: true,
        message:
          error?.response?.data?.message ||
          'No pudimos reenviar el correo. Probá de nuevo en unos minutos.',
      })
    }
  }

  // 1. Limpieza: Al desmontar el componente, reseteamos errores y estados de carga
  useEffect(() => {
    return () => {
      dispatch(clearState())
    }
  }, [dispatch])

  // 2. Efecto de Redirección: Solo se dispara cuando el login es exitoso
  // Cuando el login fue exitoso → obtener CSRF + redirigir
  //
  // Antes esto dependía de `token` (leído de Redux) para decidir si
  // redirigir — desde la fase 2 del refactor de JWT, el token ya no vive
  // en Redux (es una cookie httpOnly), así que `token` quedó
  // permanentemente undefined y este efecto nunca disparaba: el login
  // "funcionaba" (el usuario quedaba autenticado en Redux) pero la
  // pantalla se quedaba trabada en el spinner para siempre.
  // loginUser.fulfilled ya setea isSuccess y user juntos, así que alcanza
  // con eso para saber que el login anduvo.
  useEffect(() => {
    if (isSuccess && user) {
      fetchCsrfToken().then(csrf => {
        if (csrf) dispatch(setCsrfToken(csrf))
        navigate('/')
      })
    } else if (isError) {
      setIsSubmitting(false)
    }
  }, [isSuccess, isError, user, navigate, dispatch])

  // 3. Configuración de Formik
  const formik = useFormik({
    initialValues: { email: '', password: '' },
    validationSchema,
    onSubmit: async values => {
      setIsSubmitting(true)
      try {
        await dispatch(loginUser(values)).unwrap()
      } catch {
        setIsSubmitting(false)
      }
    },
  })

  const errorEmail = formik.touched.email && formik.errors.email
  const errorPassword = formik.touched.password && formik.errors.password

  const sitio = urlDelSitio()
  const logo = (
    <img className="hk-auth-logo" src={logoHenkart} alt="Henkart" width="156" height="35" />
  )

  return (
    <main className="hk-auth">
      <aside className="hk-auth-brand">
        <div className="hk-auth-brand-inner">
          {sitio ? (
            <a href={sitio} aria-label="Henkart, volver al sitio">
              {logo}
            </a>
          ) : (
            logo
          )}

          <div className="hk-auth-pitch">
            <span className="hk-auth-eyebrow">PANEL DE ADMINISTRACIÓN</span>
            <p className="hk-auth-tagline">
              Tu tienda, <span className="hk-auth-gradient">lista para vender.</span>
            </p>

            <ul className="hk-auth-benefits">
              {BENEFICIOS.map(item => {
                const Icon = item.icon

                return (
                  <li key={item.title}>
                    <span className="hk-auth-benefit-icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <span>
                      <b>{item.title}</b>
                      <small>{item.text}</small>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </aside>

      <section className="hk-auth-main" aria-labelledby="login-title">
        <div className="hk-auth-card">
          <h1 id="login-title">Ingresá a tu panel</h1>
          <p className="hk-auth-lead">Accedé a tu cuenta para administrar tu tienda.</p>

          <form onSubmit={formik.handleSubmit} noValidate>
            <div className="hk-auth-field">
              <label htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                aria-invalid={Boolean(errorEmail)}
                aria-describedby={errorEmail ? 'email-error' : undefined}
                {...formik.getFieldProps('email')}
              />
              {errorEmail && (
                <p className="hk-auth-field-error" id="email-error">
                  {formik.errors.email}
                </p>
              )}
            </div>

            <div className="hk-auth-field">
              <div className="hk-auth-label-row">
                <label htmlFor="password">Contraseña</label>
                <Link className="hk-auth-link" to="/forgot-password">
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <div className="hk-auth-password">
                <input
                  id="password"
                  name="password"
                  type={verPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  aria-invalid={Boolean(errorPassword)}
                  aria-describedby={errorPassword ? 'password-error' : undefined}
                  {...formik.getFieldProps('password')}
                />
                <button
                  type="button"
                  className="hk-auth-eye"
                  onClick={() => setVerPassword(v => !v)}
                  aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={verPassword}
                >
                  {verPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                </button>
              </div>
              {errorPassword && (
                <p className="hk-auth-field-error" id="password-error">
                  {formik.errors.password}
                </p>
              )}
            </div>

            <button type="submit" className="hk-auth-submit" disabled={isSubmitting}>
              {/*
                Texto envuelto, no desnudo: un hijo de texto suelto que se
                intercambia por un elemento rompe el render cuando el traductor
                de Chrome lo envolvió en <font> (NotFoundError en removeChild).
                Medido en producción contra el login del storefront desde
                Android; el panel tiene el mismo patrón y el comercio también
                entra desde el celular. Detalle en website/src/Pages/Login.js.
              */}
              {isSubmitting && <span className="hk-auth-spinner" aria-hidden="true" />}
              <span>{isSubmitting ? 'Ingresando' : 'Ingresar'}</span>
            </button>

            {isError && !isNotVerified && (
              <p className="hk-auth-alert" role="alert">
                {message || 'Credenciales inválidas o error de conexión.'}
              </p>
            )}

            {/* Cuenta sin verificar: no es un error de credenciales, es una
                cuenta a medio activar. Sin esta salida el correo perdido
                dejaba al comercio afuera para siempre — el alta rechaza el
                email repetido y el login no lo deja pasar. */}
            {isError && isNotVerified && (
              <div className="hk-auth-alert is-info" role="alert">
                <p>{message}</p>

                {resendState.message && (
                  <p className={resendState.error ? 'hk-auth-resend-error' : 'hk-auth-resend-ok'}>
                    {resendState.message}
                  </p>
                )}

                <button
                  type="button"
                  className="hk-auth-secondary"
                  disabled={resendState.sending || !formik.values.email}
                  onClick={handleResendVerification}
                >
                  {resendState.sending ? 'Enviando...' : 'Reenviar correo de verificación'}
                </button>
              </div>
            )}
          </form>

          <p className="hk-auth-foot">
            ¿No tenés una cuenta?{' '}
            <Link className="hk-auth-link is-strong" to="/signup">
              Registrate
            </Link>
            <span className="hk-auth-dot" aria-hidden="true">
              ·
            </span>
            <Link className="hk-auth-link" to="/subscripcion">
              Ver planes
            </Link>
          </p>
        </div>
      </section>
    </main>
  )
}

export default Login
