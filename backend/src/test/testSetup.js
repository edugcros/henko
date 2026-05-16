// src/test/testSetup.js
import request from 'supertest'
import app from '../../app.js'

export const getCSRFToken = async () => {
  const res = await request(app).get('/api/user/csrf-token')
  const csrfToken = res.body.csrfToken
  const cookies = res.headers['set-cookie']
  return { csrfToken, cookies }
}