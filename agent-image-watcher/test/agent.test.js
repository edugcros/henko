import test from 'node:test'
import assert from 'node:assert/strict'

import {
  detectImageType,
  isRetryableError,
  parseBoolean,
} from '../agent.js'

test('parseBoolean interpreta valores operativos', () => {
  assert.equal(parseBoolean('true'), true)
  assert.equal(parseBoolean('SI'), true)
  assert.equal(parseBoolean('0'), false)
  assert.equal(parseBoolean(undefined, true), true)
})

test('detectImageType valida firmas y no sólo extensiones', () => {
  assert.equal(
    detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00])),
    'image/jpeg',
  )
  assert.equal(
    detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png',
  )
  assert.equal(detectImageType(Buffer.from('not-an-image')), null)
})

test('isRetryableError distingue rechazos definitivos y transitorios', () => {
  assert.equal(isRetryableError({ response: { status: 429 } }), true)
  assert.equal(isRetryableError({ response: { status: 503 } }), true)
  assert.equal(isRetryableError({ response: { status: 400 } }), false)
  assert.equal(isRetryableError({ code: 'ECONNRESET' }), true)
})
