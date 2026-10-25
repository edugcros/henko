// Guardado automático del diseño web (useTheme + themeSlice).
//
// Viene prendido por defecto: el comercio cambia un color o escribe el nombre de la tienda y se
// guarda solo. Se prueba con el store real y la API simulada, porque el problema estaba en cómo se
// combinan los dos: qué se manda, cuándo, y qué pasa con lo que se escribe mientras viaja.

import React from 'react'
import { jest } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'

const mockGet = jest.fn()
const mockPatch = jest.fn()
const mockReset = jest.fn()

jest.unstable_mockModule('../features/theme/themeApi.js', () => ({
  getTheme: mockGet,
  updateTheme: jest.fn(),
  patchTheme: mockPatch,
  resetTheme: mockReset,
  uploadImage: jest.fn(),
  exportTheme: jest.fn(),
  importTheme: jest.fn(),
  toggleMaintenance: jest.fn(),
  validateTheme: jest.fn(),
  normalizeImageAsset: value => value,
}))

const { default: themeReducer } = await import('../features/theme/themeSlice.js')
const { useTheme } = await import('./useThemeConfig.js')

const BASE = { general: { storeName: 'Kiosco', tagline: '' } }

// El backend devuelve el tema completo con el parche aplicado.
let guardado
const aplicarParche = async parche => {
  guardado = {
    ...guardado,
    general: { ...guardado.general, ...(parche.general || {}) },
  }
  return guardado
}

const montar = () => {
  const store = configureStore({ reducer: { theme: themeReducer } })
  const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>
  const hook = renderHook(() => useTheme(), { wrapper })
  return { ...hook, store }
}

const copia = value => JSON.parse(JSON.stringify(value))
const espera = ms => new Promise(resolve => setTimeout(resolve, ms))

beforeEach(() => {
  jest.clearAllMocks()
  guardado = copia(BASE)
  mockGet.mockImplementation(async () => copia(guardado))
  mockPatch.mockImplementation(aplicarParche)
})

describe('Diseño web · guardado automático', () => {
  test('manda lo último que se escribió, no solo el primer cambio', async () => {
    const { result } = montar()
    await waitFor(() => expect(result.current.theme).toBeTruthy())

    act(() => result.current.updateField('general.storeName', 'Kiosco L'))
    await act(() => espera(200))
    act(() => result.current.updateField('general.storeName', 'Kiosco Lucía'))

    await waitFor(() => expect(mockPatch).toHaveBeenCalled(), { timeout: 4000 })
    await waitFor(() => expect(result.current.hasChanges).toBe(false), { timeout: 4000 })

    expect(guardado.general.storeName).toBe('Kiosco Lucía')
    expect(result.current.theme.general.storeName).toBe('Kiosco Lucía')
  }, 15000)

  test('lo que se escribe mientras se guarda no se pierde', async () => {
    const { result } = montar()
    await waitFor(() => expect(result.current.theme).toBeTruthy())

    let soltar
    mockPatch.mockImplementationOnce(
      parche =>
        new Promise(resolve => {
          soltar = () => resolve(aplicarParche(parche))
        }),
    )

    act(() => result.current.updateField('general.storeName', 'Kiosco L'))
    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1), { timeout: 4000 })

    // Mientras el primer guardado viaja, el comercio sigue escribiendo.
    act(() => result.current.updateField('general.tagline', 'De todo un poco'))
    await act(async () => soltar())

    // Lo escrito sigue en pantalla y termina guardándose.
    expect(result.current.theme.general.tagline).toBe('De todo un poco')
    await waitFor(() => expect(guardado.general.tagline).toBe('De todo un poco'), {
      timeout: 4000,
    })
    await waitFor(() => expect(result.current.hasChanges).toBe(false), { timeout: 4000 })
  }, 15000)

  test('apagado no guarda solo', async () => {
    const { result } = montar()
    await waitFor(() => expect(result.current.theme).toBeTruthy())

    act(() => result.current.toggleAutoSave())
    act(() => result.current.updateField('general.storeName', 'Otro'))
    await act(() => espera(2000))

    expect(mockPatch).not.toHaveBeenCalled()
    expect(result.current.hasChanges).toBe(true)
  }, 15000)
})

describe('Diseño web · guardado automático, casos de borde', () => {
  test('manda de a un guardado: el siguiente sale cuando vuelve el anterior', async () => {
    const { result } = montar()
    await waitFor(() => expect(result.current.theme).toBeTruthy())

    let soltar
    mockPatch.mockImplementationOnce(
      parche =>
        new Promise(resolve => {
          soltar = () => resolve(aplicarParche(parche))
        }),
    )

    act(() => result.current.updateField('general.storeName', 'Kiosco L'))
    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1), { timeout: 4000 })

    // Pasa más que el debounce con el primero todavía en viaje.
    act(() => result.current.updateField('general.storeName', 'Kiosco Lucía'))
    await act(() => espera(2000))
    expect(mockPatch).toHaveBeenCalledTimes(1)

    await act(async () => soltar())

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(2), { timeout: 4000 })
    await waitFor(() => expect(guardado.general.storeName).toBe('Kiosco Lucía'), {
      timeout: 4000,
    })
  }, 20000)

  test('volver al diseño original descarta lo pendiente: no se manda después', async () => {
    mockReset.mockImplementation(async () => copia(BASE))
    const { result } = montar()
    await waitFor(() => expect(result.current.theme).toBeTruthy())

    act(() => result.current.toggleAutoSave())
    act(() => result.current.updateField('general.storeName', 'Antes del reset'))
    await act(async () => result.current.reset())
    act(() => result.current.toggleAutoSave())
    await act(() => espera(2000))

    expect(mockPatch).not.toHaveBeenCalled()
    expect(result.current.theme.general.storeName).toBe('Kiosco')
  }, 15000)

  test('un reintento por 429 no se manda si se apagó el guardado automático', async () => {
    const { result } = montar()
    await waitFor(() => expect(result.current.theme).toBeTruthy())

    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    try {
      mockPatch.mockRejectedValueOnce(
        Object.assign(new Error('Demasiados pedidos'), { status: 429 }),
      )

      act(() => result.current.updateField('general.storeName', 'Kiosco L'))
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1600)
      })
      expect(mockPatch).toHaveBeenCalledTimes(1)
      // El reintento ya quedó programado para cuando termine la espera.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1600)
      })

      act(() => result.current.toggleAutoSave())
      await act(async () => {
        await jest.advanceTimersByTimeAsync(20000)
      })

      expect(mockPatch).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  }, 15000)
})

describe('Diseño web · carga', () => {
  test('si la carga falla no se reintenta en un ciclo sin fin', async () => {
    mockGet.mockRejectedValue(new Error('Sin conexión'))
    const { result } = montar()

    await waitFor(() => expect(result.current.error).toBe('Sin conexión'))
    await act(() => espera(300))

    expect(mockGet).toHaveBeenCalledTimes(1)

    mockGet.mockImplementation(async () => copia(guardado))
    await act(async () => result.current.refresh())
    await waitFor(() => expect(result.current.theme).toBeTruthy())
  })
})
