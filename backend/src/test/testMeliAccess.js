// 📁 scripts/testMeliAccess.js
//
// Prueba empírica de qué credencial sirve contra api.mercadolibre.com.
// Correr desde la raíz del backend:  node scripts/testMeliAccess.js
//
// Existe porque afirmé que MP_ACCESS_TOKEN no serviría sin probarlo. Es
// probable que no sirva (los scopes de Mercado Pago son de pagos), pero
// ambas credenciales salen del mismo DevCenter y comparten formato
// APP_USR-, así que la única respuesta confiable es la de la API.

import 'dotenv/config'

const SITE = 'MLA'
const QUERY = 'freidora de aire 5 litros'
const SEARCH_URL = `https://api.mercadolibre.com/sites/${SITE}/search?q=${encodeURIComponent(QUERY)}&limit=3`

const line = () => console.log('─'.repeat(70))

async function probe(label, headers) {
  process.stdout.write(`\n▸ ${label}\n`)

  try {
    const response = await fetch(SEARCH_URL, { headers })
    const body = await response.json().catch(() => null)

    if (response.ok) {
      const count = body?.results?.length ?? 0
      console.log(`  ✅ ${response.status} — ${count} resultados`)
      if (count > 0) {
        console.log(`     ej: "${body.results[0].title}" — $${body.results[0].price}`)
      }
      return true
    }

    console.log(`  ❌ ${response.status} — ${body?.message || body?.error || 'sin detalle'}`)
    return false
  } catch (error) {
    console.log(`  ❌ error de red: ${error.message}`)
    return false
  }
}

async function probeClientCredentials() {
  const clientId = process.env.MELI_CLIENT_ID?.trim()
  const clientSecret = process.env.MELI_CLIENT_SECRET?.trim()

  if (!clientId || !clientSecret) {
    console.log('\n▸ MELI_CLIENT_ID / MELI_CLIENT_SECRET\n  ⊘ no configurados, se omite')
    return false
  }

  process.stdout.write('\n▸ MELI client_credentials (el flujo que usa meliSource.js)\n')

  try {
    const tokenResponse = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    const tokenBody = await tokenResponse.json().catch(() => null)

    if (!tokenResponse.ok) {
      console.log(`  ❌ token: ${tokenResponse.status} — ${tokenBody?.message || tokenBody?.error}`)
      return false
    }

    console.log(`  ✓ token obtenido (expira en ${tokenBody.expires_in}s)`)
    return probe('  └─ búsqueda con ese token', {
      Authorization: `Bearer ${tokenBody.access_token}`,
    })
  } catch (error) {
    console.log(`  ❌ ${error.message}`)
    return false
  }
}

line()
console.log('DIAGNÓSTICO DE ACCESO A LA API DE MERCADOLIBRE')
console.log(`Endpoint: ${SEARCH_URL}`)
line()

const anon = await probe('Sin credenciales (anónimo)', {})

const mpToken = process.env.MP_ACCESS_TOKEN?.trim()
const mp = mpToken
  ? await probe('Con MP_ACCESS_TOKEN (token de Mercado Pago)', {
    Authorization: `Bearer ${mpToken}`,
  })
  : (console.log('\n▸ MP_ACCESS_TOKEN\n  ⊘ no configurado, se omite'), false)

const meli = await probeClientCredentials()

line()
console.log('CONCLUSIÓN')

if (meli) {
  console.log('✅ Las credenciales de MELI funcionan. meliSource.js va a andar.')
} else if (mp) {
  console.log('✅ MP_ACCESS_TOKEN funciona contra la API de MELI.')
  console.log('   Se puede usar como fallback, PERO ese token puede mover dinero:')
  console.log('   conviene igual registrar una app de solo lectura para separar riesgos.')
} else if (anon) {
  console.log('✅ El endpoint acepta llamadas anónimas. Se puede sacar el requisito de token.')
} else {
  console.log('❌ Ninguna credencial funciona. Hay que registrar una app en:')
  console.log('   https://developers.mercadolibre.com.ar/devcenter')
}
line()
