// Atributos del <input> real en los editores de tema.
//
// En MUI 9 `inputProps` se ignora sin avisar: el campo se ve igual, pero el min, el max, el step o el
// estilo que se pasaba por ahí nunca llegaban al <input>. Estas pruebas miran el atributo en el
// elemento del DOM, que es lo único que prueba que el límite existe. Los rangos son los que valida
// themeConfigModel en el backend.

import React from 'react'
import { render, screen } from '@testing-library/react'

import FooterEditor from './FooterEditor.jsx'
import SpacingEditor from './SpacingEditor.jsx'
import TypographyEditor from './TypographyEditor.jsx'
import BorderRadiusControl from '../../../components/BorderRadiusControl.jsx'

describe('Editores de tema · atributos del input', () => {
  test('el número de columnas del pie va de 1 a 6', () => {
    render(<FooterEditor value={{ columns: 4 }} onChange={() => {}} onLogoUpload={() => {}} />)

    const columnas = screen.getByRole('spinbutton')

    expect(columnas.getAttribute('min')).toBe('1')
    expect(columnas.getAttribute('max')).toBe('6')
  })

  test('los espaciados llevan el rango de cada uno', () => {
    render(<SpacingEditor value={{}} onChange={() => {}} />)

    const campos = screen.getAllByRole('spinbutton')

    expect(campos.length).toBeGreaterThan(0)
    for (const campo of campos) {
      expect(campo.getAttribute('min')).toBe('0')
      expect(Number(campo.getAttribute('max'))).toBeGreaterThan(0)
    }
  })

  test('el peso de la tipografía va de 100 a 900 de a 50, como acepta el backend', () => {
    render(<TypographyEditor value={{}} onChange={() => {}} />)

    const pesos = screen
      .getAllByRole('spinbutton')
      .filter(campo => campo.getAttribute('step') === '50')

    expect(pesos.length).toBeGreaterThan(0)
    for (const peso of pesos) {
      expect(peso.getAttribute('min')).toBe('100')
      expect(peso.getAttribute('max')).toBe('900')
    }
  })

  test('el radio de borde se escribe centrado', () => {
    render(<BorderRadiusControl value={{}} onChange={() => {}} />)

    const campos = screen.getAllByRole('textbox')

    expect(campos.length).toBeGreaterThan(0)
    for (const campo of campos) {
      expect(campo.style.textAlign).toBe('center')
    }
  })
})
