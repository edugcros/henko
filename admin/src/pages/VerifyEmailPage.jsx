// 📁 admin/src/pages/VerifyEmailPage.jsx
//
// Destino del enlace de verificación del dueño del comercio.
//
// Antes ese enlace apuntaba a /verify-email de la TIENDA: el comerciante
// verificaba su cuenta en la aplicación equivocada y el botón final lo
// mandaba a iniciar sesión como comprador, donde no tiene cuenta. El panel
// no tenía esta ruta, así que en algunos entornos el enlace directamente
// caía en un 404.
//
// Va en rutas públicas a propósito: quien llega acá todavía no inició sesión,
// justamente porque su cuenta no está verificada.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckOutlined } from '@ant-design/icons'
import api from '@utils/axiosConfig'
import AuthShell from '../components/AuthShell.js'

const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams()

  const token = useMemo(() => {
    return String(searchParams.get('token') || '').trim()
  }, [searchParams])

  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('Verificando tu correo...')

  // El token es de un solo uso: en StrictMode el efecto corre dos veces y el
  // segundo intento recibiría "token inválido" sobre una verificación que en
  // realidad salió bien.
  const requestedTokenRef = useRef(null)

  // La marca de montaje es de la PANTALLA y no de cada corrida del efecto. En StrictMode el efecto
  // corre, se limpia y corre de nuevo: la segunda corrida corta porque el token ya se pidió, y si la
  // marca fuera local, la primera —que sí hizo el pedido— quedaría «desmontada» y nadie actualizaría
  // la pantalla: se quedaba en «Verificando tu correo...» para siempre.
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true

    if (!token) {
      setStatus('error')
      setMessage('El enlace no incluye un token de verificación.')
      return undefined
    }

    if (requestedTokenRef.current === token) return undefined
    requestedTokenRef.current = token

    const run = async () => {
      try {
        const { data } = await api.get(`/user/verify-email?token=${encodeURIComponent(token)}`, {
          skipAuthRefresh: true,
          skipCsrfRetry: true,
        })

        if (data?.success !== true) {
          throw new Error(data?.message || 'No se pudo verificar el correo.')
        }

        if (!mountedRef.current) return

        setStatus('success')
        setMessage(data.message || 'Correo verificado correctamente.')
      } catch (error) {
        if (!mountedRef.current) return

        setStatus('error')
        setMessage(
          error?.response?.data?.message ||
            error?.message ||
            'El enlace es inválido, ya se usó o expiró.',
        )
      }
    }

    run()

    return () => {
      mountedRef.current = false
    }
  }, [token])

  const titulo =
    status === 'success'
      ? '¡Correo verificado!'
      : status === 'error'
        ? 'No pudimos verificar tu correo'
        : 'Verificando tu correo'

  return (
    <AuthShell titleId="verify-title">
      <h1 id="verify-title">{titulo}</h1>

      {status === 'loading' && (
        <p className="hk-auth-lead" role="status">
          <span className="hk-auth-loader" aria-hidden="true" />
          {message}
        </p>
      )}

      {status === 'success' && (
        <>
          <div className="hk-auth-notice" role="status">
            <span className="hk-auth-notice-icon" aria-hidden="true">
              <CheckOutlined />
            </span>
            <div>
              <b>{message}</b>
              <p>Tu cuenta de comercio ya está activa.</p>
            </div>
          </div>

          <Link className="hk-auth-submit" to="/login" style={{ marginTop: 22 }}>
            <span>Entrar al panel</span>
          </Link>
        </>
      )}

      {status === 'error' && (
        <>
          <p className="hk-auth-alert" role="alert">
            {message}
          </p>

          <p className="hk-auth-lead" style={{ marginTop: 18 }}>
            Si el enlace expiró, volvé a registrarte o pedí uno nuevo desde el inicio de sesión.
          </p>

          <Link className="hk-auth-secondary" to="/login">
            Ir al inicio de sesión
          </Link>
        </>
      )}
    </AuthShell>
  )
}

export default VerifyEmailPage
