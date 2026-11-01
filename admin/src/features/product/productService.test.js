// Publicación de borradores: el backend publica solo lo que cumple la regla de
// publicación (getPublishBlockers en productCtrl) y devuelve el resto en
// `skipped`. Acá se fija cómo lo lee el panel.

import { jest } from '@jest/globals'

process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'

const mockApi = jest.fn()

jest.unstable_mockModule('../../utils/axiosConfig', () => ({
  default: mockApi,
  fetchCsrfToken: async () => 'csrf-test',
}))

const { default: productService, splitBulkPublishResult } = await import('./productService.js')

describe('publicar borradores', () => {
  beforeEach(() => {
    mockApi.mockReset()
  })

  test('separa lo publicado de lo que quedó como borrador', () => {
    const { publishedIds, skippedIds, skipped } = splitBulkPublishResult(['a', 'b', 'c'], {
      published: 2,
      skipped: [{ productId: 'b', title: 'Casco', blockers: ['Debes subir al menos una imagen'] }],
    })

    expect([...publishedIds]).toEqual(['a', 'c'])
    expect([...skippedIds]).toEqual(['b'])
    expect(skipped[0].blockers).toEqual(['Debes subir al menos una imagen'])
  })

  test('una respuesta sin `skipped` (backend viejo) cuenta todo como publicado', () => {
    const { publishedIds, skipped } = splitBulkPublishResult(['a'], { published: 1 })

    expect([...publishedIds]).toEqual(['a'])
    expect(skipped).toEqual([])
  })

  test('publishDraftProduct falla con lo que le falta si el backend no lo publicó', async () => {
    mockApi.mockResolvedValue({
      data: {
        published: 0,
        skipped: [
          {
            productId: 'p1',
            blockers: ['Debes subir al menos una imagen', 'El precio debe ser mayor a 0.'],
          },
        ],
      },
    })

    await expect(productService.publishDraftProduct('p1')).rejects.toThrow(
      'No se puede publicar todavía: Debes subir al menos una imagen · El precio debe ser mayor a 0.',
    )
    expect(mockApi).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'put',
        url: '/product/admin/drafts/bulk-publish',
        data: { productIds: ['p1'] },
      }),
    )
  })

  test('publishDraftProduct resuelve cuando el backend lo publicó', async () => {
    mockApi.mockResolvedValue({ data: { published: 1, skipped: [] } })

    await expect(productService.publishDraftProduct('p1')).resolves.toMatchObject({
      published: 1,
    })
  })
})
