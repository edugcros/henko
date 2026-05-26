import React, { useEffect } from 'react'
import { Box, LinearProgress } from '@mui/material'
import { useDispatch, useSelector } from 'react-redux'
import CustomHeader from '@components/CustomHeader'
import Footer from '@components/Footer'
import Home from '@pages/Home'
import {
  setPreviewMode,
  updatePreviewConfig,
} from '@features/theme/themeSlice'
import { env } from '../config/env.js'

const PREVIEW_STORAGE_KEY = 'henko_theme_preview_config'

const parseOrigins = value =>
  String(value || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)

const getOrigin = value => {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

const getAllowedAdminOrigins = () => {
  const configuredOrigins = parseOrigins(env.adminPreviewOrigins)
  const localOrigins = env.isProduction
    ? []
    : [
        'http://admin.henko.local:3001',
        'http://localhost:3001',
        'http://127.0.0.1:3001',
      ]

  return new Set([
    ...configuredOrigins,
    ...localOrigins,
  ].filter(Boolean))
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

  useEffect(() => {
    const allowedAdminOrigins = getAllowedAdminOrigins()
    const requestedParentOrigin =
      getOrigin(new URLSearchParams(window.location.search).get('adminOrigin')) ||
      getOrigin(document.referrer)
    const parentOrigin = allowedAdminOrigins.has(requestedParentOrigin)
      ? requestedParentOrigin
      : [...allowedAdminOrigins][0]

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
      if (!allowedAdminOrigins.has(event.origin)) return
      if (!message || message.type !== 'HENKO_THEME_PREVIEW_UPDATE') return
      if (!message.payload || typeof message.payload !== 'object') return

      sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(message.payload))
      dispatch(updatePreviewConfig(message.payload))
      dispatch(setPreviewMode(true))
    }

    window.addEventListener('message', handleMessage)
    window.parent?.postMessage(
      { type: 'HENKO_THEME_PREVIEW_READY' },
      parentOrigin || window.location.origin,
    )

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [dispatch])

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
