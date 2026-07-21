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
    : ['http://admin.henko.local:3001', 'http://localhost:3001', 'http://127.0.0.1:3001']

  return new Set([...configuredOrigins, ...localOrigins].filter(Boolean))
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

    const parentOrigin = allowedAdminOrigins.has(requestedParentOrigin)
      ? requestedParentOrigin
      : [...allowedAdminOrigins][0]

    return {
      allowedAdminOrigins,
      parentOrigin: parentOrigin || window.location.origin,
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

      if (event.source !== window.parent) return
      if (!previewHandshake.allowedAdminOrigins.has(event.origin)) return
      if (!message || message.type !== 'HENKO_THEME_PREVIEW_UPDATE') return
      if (!message.payload || typeof message.payload !== 'object') return

      sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(message.payload))

      dispatch(updatePreviewConfig(message.payload))
      dispatch(setPreviewMode(true))
      setIsConnected(true)
    }

    window.addEventListener('message', handleMessage)

    window.parent?.postMessage({ type: 'HENKO_THEME_PREVIEW_READY' }, previewHandshake.parentOrigin)
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
