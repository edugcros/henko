/* eslint-env jest */
import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AiChatWidget, { parseChatInline, parseChatMarkdown } from '../AiChatWidget'

const mockSend = jest.fn()

jest.mock('@utils/aiCartActionUtils', () => ({
  dispatchAiAddToCartEvent: jest.fn(),
  getAiCartActionResultEventName: () => 'ai-cart-result',
  savePendingAiCartAction: jest.fn(),
}))

jest.mock('../../services/aiAgentService', () => ({
  getAiWebchatCustomerProfile: () => ({ name: '', email: '', phone: '' }),
  normalizeAiWebchatResponse: r => ({
    reply: r?.reply || '',
    intent: '',
    leadScore: null,
    actions: [],
    customer: {},
    conversationId: null,
    externalUserId: '',
  }),
  resetAiWebchatSession: jest.fn(),
  saveAiWebchatCustomerProfile: p => p,
  sendAiWebchatMessage: (...args) => mockSend(...args),
  trackAiWebchatEvent: jest.fn(() => Promise.resolve()),
}))

// Lo que el asistente contestó de verdad en producción el 16/10/2026.
const RESPUESTA_REAL = [
  '¡Hola! Te cuento lo más buscado hoy en Henkart:',
  '',
  '* **Zapatillas Nike Swift 3 Running**: $ 120.000 – Livianas y cómodas.',
  '* **Remera Yves Saint Laurent Pour Homme Azul**: $ 85.000 – Corte recto.',
  '',
  '¿Buscás algo en una categoría en particular?',
].join('\n')

// jsdom no implementa scrollIntoView, que el chat usa para ir al último mensaje.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn()
})

beforeEach(() => {
  mockSend.mockReset()
  window.sessionStorage.clear()
  window.localStorage.clear()
})

describe('parseChatInline', () => {
  it('separa texto, negrita, cursiva y enlaces', () => {
    expect(parseChatInline('a **b** c *d* [e](https://x.test/p)')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'bold', value: 'b' },
      { type: 'text', value: ' c ' },
      { type: 'italic', value: 'd' },
      { type: 'text', value: ' ' },
      { type: 'link', value: 'e', href: 'https://x.test/p' },
    ])
  })

  it('un asterisco suelto o rodeado de espacios no es cursiva', () => {
    expect(parseChatInline('2 * 3 * 4')).toEqual([{ type: 'text', value: '2 * 3 * 4' }])
  })

  it('sólo acepta enlaces http(s): javascript: queda como texto', () => {
    const tokens = parseChatInline('[clic](javascript:alert(1))')

    expect(tokens.some(t => t.type === 'link')).toBe(false)
  })

  it('acepta null y undefined sin romper', () => {
    expect(parseChatInline(null)).toEqual([])
    expect(parseChatInline(undefined)).toEqual([])
  })
})

describe('parseChatMarkdown', () => {
  it('agrupa viñetas consecutivas en una sola lista', () => {
    const blocks = parseChatMarkdown(RESPUESTA_REAL)

    expect(blocks.map(b => b.type)).toEqual(['p', 'ul', 'p'])
    expect(blocks[1].items).toHaveLength(2)
    expect(blocks[1].items[0][0]).toEqual({
      type: 'bold',
      value: 'Zapatillas Nike Swift 3 Running',
    })
  })

  it('reconoce listas numeradas y guiones', () => {
    expect(parseChatMarkdown('1. uno\n2) dos').map(b => b.type)).toEqual(['ol'])
    expect(parseChatMarkdown('- uno\n- dos').map(b => b.type)).toEqual(['ul'])
  })

  it('una línea que empieza con negrita no es una viñeta', () => {
    expect(parseChatMarkdown('**Ojo** con esto').map(b => b.type)).toEqual(['p'])
  })

  it('un título pasa a negrita, sin las almohadillas', () => {
    expect(parseChatMarkdown('## Ofertas')[0].lines[0]).toEqual([
      { type: 'bold', value: 'Ofertas' },
    ])
  })

  it('conserva los saltos de línea simples dentro de un párrafo', () => {
    expect(parseChatMarkdown('uno\ndos')[0].lines).toHaveLength(2)
  })

  it('texto vacío, null o sólo espacios no genera bloques', () => {
    expect(parseChatMarkdown('')).toEqual([])
    expect(parseChatMarkdown(null)).toEqual([])
    expect(parseChatMarkdown('  \n \n')).toEqual([])
  })
})

describe('AiChatWidget · respuestas con formato', () => {
  const abrirYPreguntar = async () => {
    const user = userEvent.setup()
    render(<AiChatWidget />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('Busco algo en oferta'))
  }

  it('muestra la negrita y la lista, no los asteriscos', async () => {
    mockSend.mockResolvedValue({ reply: RESPUESTA_REAL })

    await abrirYPreguntar()

    const item = await screen.findByText('Zapatillas Nike Swift 3 Running')

    expect(item.tagName).toBe('STRONG')
    expect(within(item.closest('ul')).getAllByRole('listitem')).toHaveLength(2)
    expect(document.body.textContent).not.toContain('**')
    expect(document.body.textContent).not.toMatch(/\*\s/)
  })

  it('lo que escribe la persona se muestra tal cual, sin interpretarlo', async () => {
    mockSend.mockResolvedValue({ reply: 'ok' })
    const user = userEvent.setup()
    render(<AiChatWidget />)

    await user.click(screen.getByRole('button'))
    await user.type(
      screen.getByPlaceholderText(/escribí tu consulta/i),
      'precio de **este**{enter}',
    )

    const mensaje = await screen.findByText('precio de **este**')

    expect(mensaje.querySelector('strong')).toBeNull()
  })

  it('un enlace de la respuesta se abre en otra pestaña y sin opener', async () => {
    mockSend.mockResolvedValue({ reply: 'Mirá [la tienda](https://henkart.com.ar/productos)' })

    await abrirYPreguntar()

    const enlace = await screen.findByRole('link', { name: 'la tienda' })

    expect(enlace).toHaveAttribute('href', 'https://henkart.com.ar/productos')
    expect(enlace).toHaveAttribute('target', '_blank')
    expect(enlace.getAttribute('rel')).toMatch(/noopener/)
  })

  it('el HTML que venga en la respuesta se muestra como texto, no se interpreta', async () => {
    mockSend.mockResolvedValue({ reply: '<img src=x onerror=alert(1)> hola' })

    await abrirYPreguntar()

    expect(await screen.findByText(/<img src=x onerror=alert\(1\)> hola/)).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })
})

describe('AiChatWidget · formulario de contacto', () => {
  it('una consulta con intención de compra abre el formulario y pliega las consultas rápidas', async () => {
    mockSend.mockResolvedValue({ reply: 'ok' })
    const user = userEvent.setup()
    render(<AiChatWidget />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('Quiero ver productos destacados'))

    expect(await screen.findByText('Datos para seguimiento comercial')).toBeInTheDocument()
    // Siguen en el DOM (Collapse), pero plegadas: no ocupan alto.
    const chips = screen.getByText('Busco algo en oferta').closest('.MuiCollapse-root')

    expect(chips).not.toBeNull()
    await waitFor(() => expect(chips.className).toMatch(/MuiCollapse-hidden/))
  })

  it('«Ahora no» cierra el formulario sin pedir nada', async () => {
    mockSend.mockResolvedValue({ reply: 'ok' })
    const user = userEvent.setup()
    render(<AiChatWidget />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('Quiero ver productos destacados'))
    await user.click(await screen.findByRole('button', { name: 'Ahora no' }))

    await waitFor(() => expect(screen.getByText('Guardar datos')).not.toBeVisible())
  })
})
