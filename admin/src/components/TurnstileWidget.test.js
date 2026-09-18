// 📁 src/components/TurnstileWidget.test.js
//
// Qué pasa cuando el desafío anti-bot NO se resuelve.
//
// EL CASO QUE COSTÓ CARO
//
// Turnstile avisa por 'error-callback' cuando SABE que algo salió mal. Hay un
// caso en que no lo sabe: render() acepta la clave, devuelve un id de widget y
// arma su HTML, pero el iframe del desafío nunca se dibuja. Medido en
// producción el 18/09/2026 — el widget estaba configurado para el dominio
// viejo y Cloudflare devolvía 110200 sin que el formulario se enterara.
//
// El resultado era una pantalla muerta: sin token, sin error visible, y el
// botón "Crear tienda" deshabilitado para siempre. Nadie podía registrarse y
// nada en la interfaz decía por qué.

import { jest } from '@jest/globals'
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom'

import TurnstileWidget from './TurnstileWidget'

const SITE_KEY = '0xPRUEBA'

let renderMock

beforeEach(() => {
  jest.useFakeTimers()
  renderMock = jest.fn(() => 'widget-1')

  // El componente sale por Promise.resolve() si window.turnstile ya existe, así
  // que no hace falta simular la carga del script.
  window.turnstile = { render: renderMock, remove: jest.fn() }
})

afterEach(() => {
  jest.useRealTimers()
  delete window.turnstile
})

/** Deja correr las microtareas del .then() antes de tocar los timers. */
const dejarMontar = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('TurnstileWidget · cuando el desafío no llega', () => {
  test('sin token ni error, avisa por plazo en vez de esperar para siempre', async () => {
    // ESTA ES LA PRUEBA QUE FALTABA. Cloudflare no llama a ningún callback:
    // simplemente no dibuja nada. Sin plazo, el formulario queda bloqueado sin
    // explicación.
    const onError = jest.fn()

    render(
      <TurnstileWidget siteKey={SITE_KEY} onVerify={jest.fn()} onError={onError} />,
    )

    await dejarMontar()
    expect(onError).not.toHaveBeenCalled()

    await act(async () => {
      jest.advanceTimersByTime(12000)
    })

    expect(onError).toHaveBeenCalledWith('turnstile_timeout')
    expect(screen.getByText(/No pudimos cargar la verificación/i)).toBeInTheDocument()
  })

  test('el código de Cloudflare viaja en el motivo', async () => {
    // 110200 es "dominio no autorizado". Sin el código, la causa real queda
    // invisible desde afuera y el diagnóstico se vuelve adivinanza — que es
    // exactamente lo que pasó.
    const onError = jest.fn()

    render(
      <TurnstileWidget siteKey={SITE_KEY} onVerify={jest.fn()} onError={onError} />,
    )
    await dejarMontar()

    await act(async () => {
      renderMock.mock.calls[0][1]['error-callback']('110200')
    })

    expect(onError).toHaveBeenCalledWith('turnstile_110200')
  })

  test('resolver el desafío cancela el plazo', async () => {
    // Sin cancelarlo, un visitante que resuelve el captcha al segundo 11 vería
    // aparecer el cartel de fallo un segundo después, ya verificado.
    const onVerify = jest.fn()
    const onError = jest.fn()

    render(
      <TurnstileWidget siteKey={SITE_KEY} onVerify={onVerify} onError={onError} />,
    )
    await dejarMontar()

    await act(async () => {
      renderMock.mock.calls[0][1].callback('token-ok')
    })

    expect(onVerify).toHaveBeenCalledWith('token-ok')

    await act(async () => {
      jest.advanceTimersByTime(20000)
    })

    expect(onError).not.toHaveBeenCalled()
  })

  test('reintentar vuelve a pedir el desafío sin recargar la página', async () => {
    // Recargar en un formulario a medio llenar significa perder lo escrito.
    render(<TurnstileWidget siteKey={SITE_KEY} onVerify={jest.fn()} onError={jest.fn()} />)
    await dejarMontar()

    await act(async () => {
      jest.advanceTimersByTime(12000)
    })

    expect(renderMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      screen.getByRole('button', { name: /reintentar/i }).click()
    })
    await dejarMontar()

    expect(renderMock).toHaveBeenCalledTimes(2)
  })

  test('NO se rehace cuando el formulario vuelve a renderizar', async () => {
    // EL BUCLE.
    //
    // Quien usa este componente pasa funciones inline —onVerify={t => …}—, que
    // son nuevas en cada render del formulario. Con esos callbacks en las
    // dependencias del efecto, cada tecla escrita en el formulario disparaba
    // remove() + render() del widget: el desafío parpadeaba sin llegar nunca a
    // resolverse, y desde afuera se ve como si la página se recargara sola.
    //
    // Se rompió así en producción y lo reportó el usuario. Esta prueba lo fija:
    // el widget se arma UNA vez aunque el padre renderice muchas.
    const { rerender } = render(
      <TurnstileWidget
        siteKey={SITE_KEY}
        onVerify={() => {}}
        onExpire={() => {}}
        onError={() => {}}
      />,
    )
    await dejarMontar()

    expect(renderMock).toHaveBeenCalledTimes(1)

    // Tres renders del padre, con callbacks nuevos cada vez — como escribir
    // tres letras en cualquier campo.
    for (let i = 0; i < 3; i += 1) {
      rerender(
        <TurnstileWidget
          siteKey={SITE_KEY}
          onVerify={() => {}}
          onExpire={() => {}}
          onError={() => {}}
        />,
      )
      await dejarMontar()
    }

    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(window.turnstile.remove).not.toHaveBeenCalled()
  })

  test('el callback que corre es el último que pasó el padre', async () => {
    // El precio de guardar los callbacks en refs sería quedarse con una
    // versión vieja. No debe pasar: el token tiene que llegarle a quien está
    // escuchando ahora.
    const viejo = jest.fn()
    const nuevo = jest.fn()

    const { rerender } = render(
      <TurnstileWidget siteKey={SITE_KEY} onVerify={viejo} onError={jest.fn()} />,
    )
    await dejarMontar()

    rerender(
      <TurnstileWidget siteKey={SITE_KEY} onVerify={nuevo} onError={jest.fn()} />,
    )
    await dejarMontar()

    await act(async () => {
      renderMock.mock.calls[0][1].callback('token-ok')
    })

    expect(nuevo).toHaveBeenCalledWith('token-ok')
    expect(viejo).not.toHaveBeenCalled()
  })

  test('sin siteKey no monta nada ni inventa un fallo', async () => {
    // Es el modo "todavía no hay captcha configurado": el registro tiene que
    // seguir andando, no mostrar un error que nadie puede resolver.
    const onError = jest.fn()

    const { container } = render(
      <TurnstileWidget siteKey="" onVerify={jest.fn()} onError={onError} />,
    )

    await act(async () => {
      jest.advanceTimersByTime(20000)
    })

    expect(container).toBeEmptyDOMElement()
    expect(onError).not.toHaveBeenCalled()
    expect(renderMock).not.toHaveBeenCalled()
  })
})
