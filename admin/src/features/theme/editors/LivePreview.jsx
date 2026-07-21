import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Paper, Typography } from '@mui/material'
import { OpenInNew, Refresh } from '@mui/icons-material'
import { env } from '../../../config/env'

const VIEWPORT_WIDTH = {
  desktop: '100%',
  tablet: 820,
  mobile: 390,
}

const PREVIEW_READY_TIMEOUT_MS = 12000

const withProtocol = value => {
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value

  const protocol = window.location.protocol || 'https:'
  return `${protocol}//${value}`
}

const normalizePreviewUrl = value => {
  const cleanValue = String(value || '')
    .trim()
    .replace(/\/$/, '')

  if (!cleanValue) return ''

  const url = new URL(withProtocol(cleanValue))
  const isLocalStorefront =
    url.hostname === 'henko.local' || url.hostname === 'localhost' || url.hostname === '127.0.0.1'

  if (!env.isProduction && isLocalStorefront && !url.port) {
    url.port = '3002'
  }

  return url.toString().replace(/\/$/, '')
}

const getPreviewBaseUrl = () => {
  const explicitUrl = env.storefrontPreviewUrl || process.env.REACT_APP_STOREFRONT_PREVIEW_URL

  if (explicitUrl) {
    return normalizePreviewUrl(explicitUrl)
  }

  if (env.publicBaseDomain) {
    return normalizePreviewUrl(env.publicBaseDomain)
  }

  const protocol = window.location.protocol || 'http:'
  const hostname = window.location.hostname

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:3002`
  }

  if (hostname.startsWith('admin.')) {
    return `${protocol}//${hostname.replace(/^admin\./, '')}`
  }

  return `${protocol}//${hostname}`
}

const getUrlOrigin = value => {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

const LivePreview = ({ themeData = {}, viewport = 'desktop' }) => {
  const iframeRef = useRef(null)
  const readyTimeoutRef = useRef(null)
  const [iframeKey, setIframeKey] = useState(0)
  const [iframeReady, setIframeReady] = useState(false)
  const [loadWarning, setLoadWarning] = useState('')

  const previewUrl = useMemo(() => {
    const params = new URLSearchParams({
      source: 'admin',
      ts: String(iframeKey),
      adminOrigin: window.location.origin,
    })

    return `${getPreviewBaseUrl()}/theme-preview?${params.toString()}`
  }, [iframeKey])

  const previewTargetOrigin = useMemo(() => getUrlOrigin(previewUrl), [previewUrl])

  const previewWidth = VIEWPORT_WIDTH[viewport] || VIEWPORT_WIDTH.desktop

  const postPreview = useCallback(() => {
    const targetWindow = iframeRef.current?.contentWindow

    if (!targetWindow || !previewTargetOrigin) return

    targetWindow.postMessage(
      {
        type: 'HENKO_THEME_PREVIEW_UPDATE',
        payload: themeData,
      },
      previewTargetOrigin,
    )
  }, [previewTargetOrigin, themeData])

  useEffect(() => {
    const handleMessage = event => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (event.origin !== previewTargetOrigin) return

      if (event.data?.type === 'HENKO_THEME_PREVIEW_READY') {
        if (readyTimeoutRef.current) {
          clearTimeout(readyTimeoutRef.current)
          readyTimeoutRef.current = null
        }

        setIframeReady(true)
        setLoadWarning('')
        postPreview()
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [postPreview, previewTargetOrigin])

  useEffect(() => {
    setIframeReady(false)
    setLoadWarning('')

    if (readyTimeoutRef.current) {
      clearTimeout(readyTimeoutRef.current)
    }

    readyTimeoutRef.current = setTimeout(() => {
      setLoadWarning(
        'La tienda no confirmó la conexión de preview. Revisá que el website esté levantado y que esta URL abra correctamente.',
      )
    }, PREVIEW_READY_TIMEOUT_MS)

    postPreview()
    return () => {
      if (readyTimeoutRef.current) {
        clearTimeout(readyTimeoutRef.current)
        readyTimeoutRef.current = null
      }
    }
  }, [postPreview, previewUrl])

  return (
    <Paper
      elevation={0}
      sx={{
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 0,
      }}
    >
      <Box
        sx={{
          px: 1.25,
          py: 0.75,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minHeight: 44,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={800} lineHeight={1.15}>
            Vista Previa Real
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {iframeReady ? 'Conectada con el storefront' : 'Esperando storefront'}
          </Typography>
        </Box>

        <Button
          size="small"
          startIcon={<Refresh />}
          onClick={() => setIframeKey(key => key + 1)}
          sx={{ flexShrink: 0 }}
        >
          Recargar
        </Button>
        <Button
          size="small"
          startIcon={<OpenInNew />}
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ flexShrink: 0 }}
        >
          Abrir
        </Button>
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          bgcolor: 'action.hover',
          p: viewport === 'desktop' ? 0 : 1,
        }}
      >
        {loadWarning && (
          <Alert severity="warning" sx={{ m: 1 }}>
            {loadWarning}
            <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
              URL: {previewUrl}
            </Typography>
          </Alert>
        )}

        <Box
          sx={{
            width: previewWidth,
            maxWidth: '100%',
            height: '100%',
            minHeight: 0,
            mx: 'auto',
            bgcolor: 'background.paper',
            boxShadow: viewport === 'desktop' ? 'none' : 3,
          }}
        >
          <Box
            component="iframe"
            ref={iframeRef}
            key={iframeKey}
            src={previewUrl}
            title="Preview real de tienda"
            onLoad={postPreview}
            sx={{
              width: '100%',
              height: '100%',
              border: 0,
              display: 'block',
              bgcolor: '#fff',
            }}
          />
        </Box>
      </Box>
    </Paper>
  )
}

export default LivePreview
