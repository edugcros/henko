// Seguimiento de un lead (LeadFollowUpModal).
//
// El campo de fecha y hora tiene que llevar la etiqueta encogida: un datetime-local siempre muestra
// el formato (dd/mm/aaaa --:--), y con la etiqueta en reposo se pisan. En MUI 9 `InputLabelProps` se
// ignora sin avisar, así que se mira el atributo de la etiqueta real.

import React from 'react'
import { render, screen } from '@testing-library/react'

import LeadFollowUpModal from './LeadFollowUpModal.jsx'

describe('Seguimiento de un lead · fecha y hora', () => {
  test('la etiqueta va encogida aunque el campo esté vacío', () => {
    render(<LeadFollowUpModal open lead={null} onClose={() => {}} onSubmit={() => {}} />)

    const campo = screen.getByLabelText('Fecha y hora')
    const etiqueta = document.querySelector(`label[for="${campo.id}"]`)

    expect(etiqueta.getAttribute('data-shrink')).toBe('true')
  })
})
