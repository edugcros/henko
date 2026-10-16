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

// Nombre de la ventana de «Abrir». Con nombre fijo, un segundo clic reutiliza la misma
// pestaña en lugar de abrir una por clic.
const PREVIEW_WINDOW_NAME = 'henko-theme-preview'

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
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.local')

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

  // La ventana que abre el botón «Abrir», y si ya saludó.
  const popupRef = useRef(null)
  const popupReadyRef = useRef(false)
  const [popupWarning, setPopupWarning] = useState('')

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

  // No se manda nada hasta que el iframe se identificó.
  //
  // EL RUIDO
  //
  // postPreview depende de themeData, así que el efecto de abajo lo volvía a
  // llamar en CADA edición del tema, y onLoad lo llamaba con el documento
  // cargado pero antes del saludo. Si el iframe todavía está en about:blank, o
  // si la URL de preview redirigió (o devolvió el login porque no hay sesión),
  // su origen real no es previewTargetOrigin y el navegador rechaza el envío:
  //
  //   Failed to execute 'postMessage' on 'DOMWindow': The target origin
  //   provided does not match the recipient window's origin.
  //
  // Medido en el panel: veinte de estos seguidos, uno por edición, con
  // /api/theme/admin devolviendo 401 al mismo tiempo.
  //
  // El handshake HENKO_THEME_PREVIEW_READY ya existe y ya compara
  // event.origin contra previewTargetOrigin, así que recibirlo es la prueba de
  // que el destino es el que creemos. La bandera va en un ref y no en estado
  // porque el propio handler necesita leerla ya en true, sin esperar un
  // re-render.
  const readyRef = useRef(false)

  const postTo = useCallback(
    targetWindow => {
      if (!targetWindow || !previewTargetOrigin) return

      targetWindow.postMessage(
        {
          type: 'HENKO_THEME_PREVIEW_UPDATE',
          payload: themeData,
        },
        previewTargetOrigin,
      )
    },
    [previewTargetOrigin, themeData],
  )

  // El diseño va a DOS destinos: el iframe del panel y, si está abierta, la pestaña de
  // «Abrir». Cada uno recibe solo después de haber saludado: es la prueba de que el
  // destino es el que creemos (ver el comentario de arriba).
  //
  // La pestaña de «Abrir» antes era un enlace con rel=noopener: sin ninguna referencia
  // a ella, el panel no podía mandarle nada, y mostraba la plantilla por defecto en
  // lugar de lo que se estaba diseñando.
  const postPreview = useCallback(() => {
    if (readyRef.current) postTo(iframeRef.current?.contentWindow)

    const popup = popupRef.current

    if (popup && !popup.closed && popupReadyRef.current) postTo(popup)
  }, [postTo])

  useEffect(() => {
    const handleMessage = event => {
      const popup = popupRef.current
      const fromIframe = event.source === iframeRef.current?.contentWindow
      const fromPopup = Boolean(popup) && !popup.closed && event.source === popup

      if (!fromIframe && !fromPopup) return
      if (event.origin !== previewTargetOrigin) return

      if (event.data?.type !== 'HENKO_THEME_PREVIEW_READY') return

      if (fromIframe) {
        if (readyTimeoutRef.current) {
          clearTimeout(readyTimeoutRef.current)
          readyTimeoutRef.current = null
        }

        // El ref antes del postPreview: el saludo llegó, o sea que el destino
        // quedó confirmado y recién ahora se puede enviar.
        readyRef.current = true
        setIframeReady(true)
        setLoadWarning('')
      } else {
        popupReadyRef.current = true
        setPopupWarning('')
      }

      postPreview()
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [postPreview, previewTargetOrigin])

  // Reiniciar el saludo y enviar el tema son dos cosas distintas y van en
  // efectos distintos.
  //
  // Antes estaban juntas con deps [postPreview, previewUrl]. postPreview es un
  // useCallback que depende de themeData, así que cambia de identidad en CADA
  // edición del tema y arrastraba el efecto entero con él: el reinicio corría
  // en cada tecla. Con la guarda de readyRef eso dejaba el preview mudo para
  // siempre después de la primera edición —el iframe ya mandó su único saludo
  // y no lo reenvía sin recargar— y encima aparecía el cartel de "no confirmó
  // la conexión" siendo mentira. Antes de la guarda era sólo un parpadeo
  // cosmético de la etiqueta, así que el defecto estaba latente.
  //
  // Este efecto depende SOLO de previewUrl: corre cuando el iframe realmente
  // se recarga.
  useEffect(() => {
    readyRef.current = false
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

    return () => {
      if (readyTimeoutRef.current) {
        clearTimeout(readyTimeoutRef.current)
        readyTimeoutRef.current = null
      }
    }
  }, [previewUrl])

  // Y este manda el tema cuando cambia. Si el saludo todavía no llegó,
  // postPreview sale solo y el envío lo hace el handler al recibirlo.
  useEffect(() => {
    postPreview()
  }, [postPreview])

  const openPreviewWindow = () => {
    // Cada apertura recarga la ventana y esta vuelve a saludar: hasta entonces no se
    // le manda nada.
    popupReadyRef.current = false

    // Sin 'noopener' a propósito: hace falta la referencia a la ventana para poder
    // mandarle el diseño. El destino es el storefront de Henkart, no una página ajena.
    const popup = window.open(previewUrl, PREVIEW_WINDOW_NAME)

    if (!popup) {
      popupRef.current = null
      setPopupWarning(
        'El navegador bloqueó la ventana de vista previa. Permití las ventanas emergentes para este sitio y volvé a tocar «Abrir».',
      )
      return
    }

    popupRef.current = popup
    setPopupWarning('')
  }

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
          <Typography variant="subtitle2" sx={{ fontWeight: 800, lineHeight: 1.15 }}>
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
          onClick={openPreviewWindow}
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
        {popupWarning && (
          <Alert severity="warning" sx={{ m: 1 }} onClose={() => setPopupWarning('')}>
            {popupWarning}
          </Alert>
        )}

        {loadWarning && (
          <Alert severity="warning" sx={{ m: 1 }}>
            {loadWarning}
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
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
