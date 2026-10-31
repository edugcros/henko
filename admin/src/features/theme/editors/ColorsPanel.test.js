// Pestaña de colores del diseñador de tienda (ColorsPanel).
//
// Lo que se fija: aplicar una paleta cambia todos los colores y se puede
// deshacer; editar un color cambia solo ese; un hex a medio escribir no pisa el
// color guardado; y el editor avisa cuando un par de colores no se lee.

import React from 'react'
import { jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ColorsPanel from './ColorsPanel.jsx'
import { COLOR_PRESETS, DEFAULT_THEME_COLORS } from '../colorSystem.js'

const ROLE_KEYS = Object.keys(DEFAULT_THEME_COLORS)

const montar = (colors = DEFAULT_THEME_COLORS) => {
  const updateField = jest.fn()
  const onChange = jest.fn()
  render(<ColorsPanel colors={colors} updateField={updateField} onChange={onChange} />)
  return { updateField, onChange }
}

const paletas = () =>
  within(screen.getByRole('list', { name: 'Paletas disponibles' })).getAllByRole('listitem')
const verTodas = () => userEvent.click(screen.getByRole('button', { name: /Ver las \d+ paletas/ }))
const abrirGrupo = titulo =>
  userEvent.click(screen.getByRole('button', { name: new RegExp(titulo) }))

describe('Colores · paletas', () => {
  test('aplicar una paleta manda todos los colores de la paleta', async () => {
    const { onChange } = montar()
    const oceano = COLOR_PRESETS.find(p => p.name === 'Océano Surf')

    await verTodas()
    await userEvent.click(screen.getByRole('listitem', { name: 'Aplicar paleta Océano Surf' }))

    const enviado = onChange.mock.calls[0][0]
    expect(Object.keys(enviado).sort()).toEqual([...ROLE_KEYS].sort())
    expect(enviado.headerBackground).toBe(oceano.headerBackground)
    expect(enviado.footerBackground).toBe(oceano.footerBackground)
  })

  test('después de aplicar se puede deshacer y vuelven los colores de antes', async () => {
    const antes = { ...DEFAULT_THEME_COLORS, text: '#123456' }
    const { onChange } = montar(antes)

    await verTodas()
    await userEvent.click(screen.getByRole('listitem', { name: 'Aplicar paleta Cítrico Fresco' }))
    expect(screen.getByText(/Aplicaste «Cítrico Fresco»/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Deshacer' }))

    const restaurado = onChange.mock.calls.at(-1)[0]
    expect(restaurado.text).toBe('#123456')
    expect(restaurado.headerBackground).toBe(DEFAULT_THEME_COLORS.headerBackground)
  })

  test('la paleta que coincide con los colores actuales se marca como en uso', async () => {
    const tech = COLOR_PRESETS.find(p => p.name === 'Tech Clean')
    const { name, ...colores } = tech
    montar(colores)
    await verTodas()

    expect(screen.getByRole('listitem', { name: 'Aplicar paleta Tech Clean' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('listitem', { name: 'Aplicar paleta Océano Surf' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(name).toBe('Tech Clean')
  })

  test('muestra las primeras 9 y el resto al pedirlo', async () => {
    montar()

    expect(paletas()).toHaveLength(9)
    await verTodas()
    expect(paletas()).toHaveLength(COLOR_PRESETS.length)
  })

  test('la paleta en uso se ve aunque no esté entre las primeras', () => {
    const { name, ...colores } = COLOR_PRESETS.find(p => p.name === 'Medianoche Azul')
    montar(colores)

    expect(paletas()).toHaveLength(10)
    expect(screen.getByRole('listitem', { name: `Aplicar paleta ${name}` })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('restaurar los originales pide confirmación', async () => {
    const { onChange } = montar({ ...DEFAULT_THEME_COLORS, primary: '#000000' })

    await userEvent.click(screen.getByRole('button', { name: 'Restaurar originales' }))
    expect(onChange).not.toHaveBeenCalled()

    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Restaurar' }),
    )

    expect(onChange.mock.calls[0][0].primary).toBe(DEFAULT_THEME_COLORS.primary)
  })
})

describe('Colores · ajuste de cada color', () => {
  test('editar un color manda solo ese color', async () => {
    const { updateField, onChange } = montar()

    await abrirGrupo('Header')
    fireEvent.change(screen.getByLabelText('Código hex: Íconos · Header'), {
      target: { value: '#ff0000' },
    })

    expect(updateField).toHaveBeenCalledWith('colors.headerIcon', '#ff0000')
    expect(updateField).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  test('un hex a medio escribir no se guarda y vuelve al color anterior al salir', async () => {
    const { updateField } = montar()

    await abrirGrupo('Header')
    const campo = screen.getByLabelText('Código hex: Íconos · Header')
    fireEvent.change(campo, { target: { value: '#12' } })
    fireEvent.blur(campo)

    expect(updateField).not.toHaveBeenCalled()
    expect(campo.value).toBe(DEFAULT_THEME_COLORS.headerIcon)
  })

  test('cada color dice dónde se aplica', async () => {
    montar()

    await abrirGrupo('Pie de página')

    expect(screen.getByText('Fondo del pie de página.')).toBeInTheDocument()
  })

  test('sin colores de pie guardados, muestra los que usa la tienda (texto y fondo invertidos)', async () => {
    const { footerBackground, footerText, ...sinPie } = {
      ...DEFAULT_THEME_COLORS,
      text: '#222222',
      background: '#fafafa',
    }
    montar(sinPie)

    await abrirGrupo('Pie de página')

    expect(screen.getByLabelText('Código hex: Fondo · Pie de página').value).toBe('#222222')
    expect(screen.getByLabelText('Código hex: Texto · Pie de página').value).toBe('#fafafa')
    expect([footerBackground, footerText]).toEqual(['#1a1a1a', '#ffffff'])
  })
})

describe('Colores · contraste', () => {
  test('avisa cuando un par no se lee y en qué grupo revisar', () => {
    montar({ ...DEFAULT_THEME_COLORS, actionPrimary: '#ffffff', actionPrimaryText: '#f5f5f5' })

    expect(
      screen.getByText(/Texto del botón primario: 1,\d:1 \(mínimo 4,5:1\)/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Botones y links.*revisar contraste/ }),
    ).toBeInTheDocument()
  })

  test('con una paleta bien armada no hay avisos', () => {
    const { name, ...colores } = COLOR_PRESETS[0]
    montar(colores)

    expect(screen.queryByText(/se lee(n)? con dificultad/)).toBeNull()
    expect(name).toBeTruthy()
  })
})
