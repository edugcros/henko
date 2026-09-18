// 📁 src/pages/AdminRegister.slug.test.js
//
// El identificador de tienda es la DIRECCIÓN PÚBLICA del comercio.
//
// QUÉ PASÓ
//
// El formulario sugiere el identificador a partir del nombre de la tienda, y
// dejaba de hacerlo "cuando el usuario lo tocaba". Pero medía eso con
// formik.touched, que se marca en el BLUR — y el campo escribe con
// setFieldValue, que tampoco lo marca.
//
// Resultado: alguien tipeaba su identificador, volvía a retocar el nombre sin
// haber salido del campo, y el nombre se lo pisaba en silencio. Pasó en
// producción el 18/09/2026: se pidió "prueba-qa-2" y el comercio quedó como
// "tienda-de-prueba-qa". Nadie avisó, y el comerciante se entera cuando le da
// la dirección a un cliente.

import { jest } from '@jest/globals'
import React from 'react'

// La pantalla lee la configuración al importarse y aborta sin esto — mismo
// motivo que en pages.smoke.test.js.
process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'
process.env.REACT_APP_NODE_ENV = 'test'
process.env.REACT_APP_PUBLIC_BASE_DOMAIN = 'henkart.com.ar'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

// Los aliases los resuelve babel dentro del código, pero el string que se le
// pasa al mock se usa tal cual: acá va la ruta relativa real.
jest.unstable_mockModule('../features/auth/authSlice', () => ({
  __esModule: true,
  default: (state = {}) => state,
  createUserAdmin: jest.fn(() => ({ type: 'noop' })),
}))

const { default: AdminRegister } = await import('./AdminRegister')
const { Provider } = await import('react-redux')
const { configureStore } = await import('@reduxjs/toolkit')
const { MemoryRouter } = await import('react-router-dom')

const montar = () => {
  const store = configureStore({
    reducer: {
      auth: () => ({
        loading: {},
        isError: false,
        isSuccess: false,
        message: '',
      }),
    },
  })

  return render(
    <Provider store={store}>
      <MemoryRouter>
        <AdminRegister />
      </MemoryRouter>
    </Provider>,
  )
}

const campos = () => ({
  nombre: screen.getByRole('textbox', { name: /nombre de la tienda/i }),
  slug: screen.getByRole('textbox', { name: /identificador de tienda/i }),
})

describe('el identificador de tienda', () => {
  test('se sugiere desde el nombre mientras nadie lo escriba', async () => {
    // La comodidad que hay que conservar: quien no quiere elegirlo, no tiene
    // que pensarlo.
    const user = userEvent.setup()
    montar()

    const { nombre, slug } = campos()
    await user.type(nombre, 'Kiosco Lucia')

    expect(slug).toHaveValue('kiosco-lucia')
  })

  test('el nombre NO pisa un identificador escrito a mano', async () => {
    // ESTA ES LA PROPIEDAD. Sin salir del campo del identificador —o sea sin
    // disparar el blur que formik.touched esperaba— se vuelve a tocar el
    // nombre. El identificador tiene que quedarse como lo escribieron.
    const user = userEvent.setup()
    montar()

    const { nombre, slug } = campos()

    await user.type(nombre, 'Tienda de Prueba QA')
    await user.clear(slug)
    await user.type(slug, 'prueba-qa-2')

    // Retoque del nombre, sin blur previo del identificador.
    await user.type(nombre, ' 2')

    expect(slug).toHaveValue('prueba-qa-2')
  })

  test('se pueden escribir guiones', async () => {
    // EL BUG QUE DESTAPÓ ESTA PRUEBA, Y EL PEOR DE LOS DOS.
    //
    // normalizeSlug recortaba los guiones de los extremos en CADA tecla. Al
    // tipear "prueba-" el guion quedaba al final, se borraba, y la letra
    // siguiente se pegaba: salía "pruebaqa2".
    //
    // O sea que era imposible escribir un identificador con guiones — y el
    // placeholder del campo dice "mi-tienda", justo lo que no se podía tipear.
    const user = userEvent.setup()
    montar()

    const { slug } = campos()

    await user.clear(slug)
    await user.type(slug, 'prueba-qa-2')

    expect(slug).toHaveValue('prueba-qa-2')
  })

  test('al salir del campo se limpia el guion colgado', async () => {
    // Mientras se escribe, un guion al final es un estado intermedio legítimo.
    // Lo que no puede salir con guiones sueltos es el valor que se envía.
    const user = userEvent.setup()
    montar()

    const { nombre, slug } = campos()

    await user.clear(slug)
    await user.type(slug, 'kiosco-')
    expect(slug).toHaveValue('kiosco-')

    await user.click(nombre)

    expect(slug).toHaveValue('kiosco')
  })

  test('vaciarlo vuelve a delegar en el nombre', async () => {
    // Es la forma natural de decir "elegilo vos": si se borra, la sugerencia
    // tiene que volver, o el campo queda vacío y el alta falla por validación.
    const user = userEvent.setup()
    montar()

    const { nombre, slug } = campos()

    await user.type(nombre, 'Kiosco Lucia')
    await user.clear(slug)
    await user.type(slug, 'otro-nombre')
    await user.clear(slug)

    await user.type(nombre, '!')

    expect(slug).toHaveValue('kiosco-lucia')
  })
})
