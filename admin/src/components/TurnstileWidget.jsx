import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Stack, Typography } from '@mui/material'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
let scriptPromise = null

/**
 * Cuánto se espera a que el desafío aparezca antes de darlo por fallado.
 *
 * POR QUÉ HACE FALTA UN PLAZO Y NO ALCANZA CON 'error-callback'
 *
 * Cloudflare avisa por 'error-callback' cuando SABE que algo salió mal. Hay un
 * caso en que no lo sabe: render() acepta la clave, devuelve un id de widget y
 * arma su HTML, pero el iframe del desafío nunca llega a dibujarse —red que se
 * corta, una extensión que lo bloquea, un entorno que no le deja abrir el
 * canal postMessage—. Ahí no hay token, no hay error, y el formulario queda
 * esperando para siempre con el botón deshabilitado y sin decir por qué.
 *
 * Doce segundos son holgados para una conexión lenta y siguen siendo poco
 * para alguien mirando una pantalla que no responde.
 */
const TIMEOUT_MS = 12000

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
const TurnstileWidget = ({ siteKey, onVerify, onExpire, onError }) => {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const timerRef = useRef(null)
  const [failed, setFailed] = useState(false)
  // Cambiarlo vuelve a correr el efecto: es el "reintentar" sin recargar toda
  // la página, que en un formulario a medio llenar significa perder lo escrito.
  const [intento, setIntento] = useState(0)

  const marcarFallo = useCallback(
    motivo => {
      setFailed(true)
      onError?.(motivo)
    },
    [onError],
  )

  useEffect(() => {
    if (!siteKey) return undefined

    let cancelled = false

    const limpiarTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: token => {
            limpiarTimer()
            onVerify(token)
          },
          'expired-callback': () => onExpire?.(),
          'error-callback': codigo => {
            limpiarTimer()
            // El código de Cloudflare importa: 110200 es "dominio no
            // autorizado", y sin él la causa se vuelve invisible desde afuera.
            marcarFallo(codigo ? `turnstile_${codigo}` : 'turnstile_error')
          },
        })

        timerRef.current = setTimeout(() => {
          if (!cancelled) marcarFallo('turnstile_timeout')
        }, TIMEOUT_MS)
      })
      .catch(() => marcarFallo('script_no_carga'))

    return () => {
      cancelled = true
      limpiarTimer()

      if (widgetIdRef.current && window.turnstile) {
        // El widget puede haber sido invalidado por Cloudflare (doble
        // montaje de StrictMode, HMR) antes de este cleanup — remove()
        // lanza "Cannot find Widget" en ese caso y no debe romper el efecto.
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // no-op: el widget ya no existe del lado de Cloudflare
        }
        widgetIdRef.current = null
      }
    }
  }, [siteKey, intento, marcarFallo, onVerify, onExpire])

  if (!siteKey) return null

  if (failed) {
    return (
      <Stack spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="body2" color="error" align="center">
          No pudimos cargar la verificación anti-bot.
        </Typography>
        <Button
          size="small"
          variant="outlined"
          onClick={() => {
            setFailed(false)
            setIntento(n => n + 1)
          }}
        >
          Reintentar verificación
        </Button>
      </Stack>
    )
  }

  return <div ref={containerRef} />
}

export default TurnstileWidget
