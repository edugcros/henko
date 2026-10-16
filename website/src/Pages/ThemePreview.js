import React, { useEffect, useMemo, useState } from 'react'
import { Box, LinearProgress } from '@mui/material'
import { useDispatch, useSelector } from 'react-redux'
import CustomHeader from '@components/CustomHeader'
import Footer from '@components/Footer'
import Home from '@pages/Home'
import { setPreviewMode, updatePreviewConfig } from '@features/theme/themeSlice'
import { env } from '../config/env.js'

const PREVIEW_STORAGE_KEY = 'henko_theme_preview_config'

const parseOrigins = value =>
  String(value || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)

const getOrigin = value => {
  try {
    if (!value || typeof window === 'undefined') return ''

    return new window.URL(value).origin
  } catch {
    return ''
  }
}

const getAllowedAdminOrigins = () => {
  const configuredOrigins = parseOrigins(env.adminPreviewOrigins)
  const localOrigins = env.isProduction
    ? []
    : [
        `http://${env.adminBaseDomain || 'admin.localhost'}:3001`,
        'http://localhost:3001',
        'http://127.0.0.1:3001',
      ]

  return new Set([...configuredOrigins, ...localOrigins].filter(Boolean))
}

// Con quién conversa esta vista previa.
//
// Dentro del iframe del diseñador es el padre. Pero el botón «Abrir» del admin la abre
// en una pestaña propia, donde window.parent es la propia ventana y el admin es quien
// la abrió (window.opener).
//
// Antes solo se miraba window.parent. En una pestaña propia el saludo se mandaba a sí
// misma y se rechazaba cualquier mensaje, así que esa pestaña no tenía forma de recibir
// el diseño: mostraba la plantilla por defecto y nunca lo que se estaba diseñando. El
// sessionStorage tampoco ayudaba: es por pestaña, y la nueva arranca vacía.
export const getAdminWindow = () => {
  if (typeof window === 'undefined') return null
  if (window.parent && window.parent !== window) return window.parent

  return window.opener || null
}

const readStoredPreview = () => {
  try {
    const raw = sessionStorage.getItem(PREVIEW_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const ThemePreview = () => {
  const dispatch = useDispatch()
  const previewConfig = useSelector(state => state.theme?.previewConfig)
  const [isConnected, setIsConnected] = useState(false)

  const previewHandshake = useMemo(() => {
    const allowedAdminOrigins = getAllowedAdminOrigins()

    const searchParams =
      typeof window !== 'undefined' ? new window.URLSearchParams(window.location.search) : null

    const requestedParentOrigin =
      getOrigin(searchParams?.get('adminOrigin')) ||
      getOrigin(typeof document !== 'undefined' ? document.referrer : '')

    // Preferimos el origen pedido (adminOrigin del query param, o
    // document.referrer) por sobre la allowlist: si REACT_APP_
    // ADMIN_PREVIEW_ORIGINS no está configurada (allowedAdminOrigins vacío),
    // el fallback anterior terminaba en window.location.origin — el propio
    // origen del storefront — y el postMessage de "estoy listo" fallaba
    // porque el padre real (el panel admin) nunca es el mismo origen que
    // este iframe. La allowlist sigue siendo la que manda para ACEPTAR
    // mensajes entrantes (línea de abajo, handleMessage) — esto solo
    // decide a qué origen intentar avisar que ya cargamos.
    const parentOrigin =
      requestedParentOrigin || (allowedAdminOrigins.size ? [...allowedAdminOrigins][0] : '')

    return {
      allowedAdminOrigins,
      parentOrigin,
    }
  }, [])

  useEffect(() => {
    const storedPreview = readStoredPreview()

    if (storedPreview) {
      dispatch(updatePreviewConfig(storedPreview))
      dispatch(setPreviewMode(true))
    } else {
      dispatch(setPreviewMode(true))
    }

    const handleMessage = event => {
      const message = event.data

      const adminWindow = getAdminWindow()

      if (!adminWindow || event.source !== adminWindow) return
      if (!previewHandshake.allowedAdminOrigins.has(event.origin)) return
      if (!message || message.type !== 'HENKO_THEME_PREVIEW_UPDATE') return
      if (!message.payload || typeof message.payload !== 'object') return

      sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(message.payload))

      dispatch(updatePreviewConfig(message.payload))
      dispatch(setPreviewMode(true))
      setIsConnected(true)
    }

    window.addEventListener('message', handleMessage)

    // Sin un parentOrigin real no hay a quién avisarle "estoy listo" —
    // mandar el postMessage igual tiraría el mismo error de origen que
    // este fix resuelve para el caso normal.
    const adminWindow = getAdminWindow()

    if (adminWindow && previewHandshake.parentOrigin) {
      adminWindow.postMessage({ type: 'HENKO_THEME_PREVIEW_READY' }, previewHandshake.parentOrigin)
    }
    setIsConnected(true)

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [dispatch, previewHandshake])

  if (!isConnected) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <LinearProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {!previewConfig && <LinearProgress />}
      <CustomHeader />
      <main style={{ minHeight: '80vh' }}>
        <Home />
      </main>
      <Footer />
    </Box>
  )
}

export default ThemePreview
