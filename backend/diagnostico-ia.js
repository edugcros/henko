// diagnostico-ia.js  node --env-file=.env.production diagnostico-ia.js
import { GoogleGenerativeAI } from '@google/generative-ai'
import process from 'node:process'

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY no cargada. Ejecutá con --env-file=.env.production')
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

// Modelos a diagnosticar (estado real por proyecto)
const MODELOS_A_PROBAR = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro',
]

async function probarModelos() {
  console.log('🔍 Iniciando diagnóstico de modelos disponibles...\n')

  for (const modelId of MODELOS_A_PROBAR) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId })

      const result = await model.generateContent('Responder solo: OK')
      const response = await result.response

      console.log(`✅ Modelo [${modelId}]: FUNCIONA → ${response.text()}`)
    } catch (error) {
      const message = String(error?.message || error)

      if (message.includes('429')) {
        console.log(`⛔ Modelo [${modelId}]: SIN CUOTA (billing no habilitado)`)
      } else if (message.includes('404')) {
        console.log(`❌ Modelo [${modelId}]: No disponible en este proyecto`)
      } else {
        console.log(`⚠️ Modelo [${modelId}]: Error inesperado → ${message}`)
      }
    }
  }

  console.log('\n🏁 Diagnóstico finalizado')
}

await probarModelos()
process.exit(0)
