import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const waitFor = async (predicate, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('Tiempo de espera agotado')
}

test('el agente entrega una imagen al pipeline IA y la archiva', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henko-agent-'))
  const watchFolder = path.join(root, 'inbox')
  const processedFolder = path.join(root, 'processed')
  const failedFolder = path.join(root, 'failed')
  await Promise.all([
    fs.mkdir(watchFolder),
    fs.mkdir(processedFolder),
    fs.mkdir(failedFolder),
  ])

  let requestBody = ''
  let requestHeaders = {}
  const server = http.createServer((request, response) => {
    requestHeaders = request.headers
    request.on('data', chunk => {
      requestBody += chunk.toString('latin1')
    })
    request.on('end', () => {
      response.writeHead(201, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        success: true,
        message: 'Imagen analizada',
        job: { _id: 'job-integration', status: 'completed' },
      }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  const child = spawn(process.execPath, ['agent.js'], {
    cwd: packageDir,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      WATCH_FOLDER: watchFolder,
      PROCESSED_FOLDER: processedFolder,
      FAILED_FOLDER: failedFolder,
      API_BASE_URL: `http://127.0.0.1:${port}`,
      TENANT_DOMAIN: 'integration.local',
      AGENT_API_KEY: 'integration-secret',
      ANALYSIS_ENDPOINT: '/product-analysis/import',
      AUTO_ANALYZE: 'true',
      AGENT_CONCURRENCY: '1',
      AGENT_MAX_RETRIES: '1',
      AGENT_LOCK_STALE_MS: '30000',
      PROMOTION_NOTIFIER_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitFor(async () => {
      try {
        const raw = await fs.readFile(path.join(watchFolder, 'agent-status.json'), 'utf8')
        return JSON.parse(raw).state === 'running'
      } catch {
        return false
      }
    })

    await fs.writeFile(
      path.join(watchFolder, 'producto.jpg'),
      Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]),
    )

    await waitFor(async () => (await fs.readdir(processedFolder)).some(name => name.endsWith('.jpg')))

    assert.equal(requestHeaders['x-agent-api-key'], 'integration-secret')
    assert.equal(requestHeaders['x-tenant-domain'], 'integration.local')
    assert.match(requestBody, /name="autoAnalyze"\r\n\r\ntrue/)
    assert.equal((await fs.readdir(failedFolder)).length, 0)
  } finally {
    child.kill('SIGTERM')
    await new Promise(resolve => {
      child.once('exit', resolve)
      setTimeout(resolve, 3000)
    })
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})
