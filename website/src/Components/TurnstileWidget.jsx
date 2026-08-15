import React, { useEffect, useRef, useState } from 'react'
import { Typography } from '@mui/material'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
let scriptPromise = null

const loadScript = () => {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('No se pudo cargar Turnstile'))
    }
    document.head.appendChild(script)
  })

  return scriptPromise
}

// Sin siteKey no renderiza nada — así el registro sigue funcionando igual
// que hoy hasta que se configure REACT_APP_TURNSTILE_SITE_KEY.
const TurnstileWidget = ({ siteKey, onVerify, onExpire }) => {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!siteKey) return undefined

    let cancelled = false

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: token => onVerify(token),
          'expired-callback': () => onExpire?.(),
          'error-callback': () => setFailed(true),
        })
      })
      .catch(() => setFailed(true))

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
      }
    }
  }, [siteKey])

  if (!siteKey) return null

  if (failed) {
    return (
      <Typography variant="body2" color="error">
        No se pudo cargar la verificación anti-bot. Recargá la página.
      </Typography>
    )
  }

  return <div ref={containerRef} />
}

export default TurnstileWidget
