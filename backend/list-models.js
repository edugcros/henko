//import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'
import path from 'path'

// Cargamos tu env de producción
dotenv.config({ path: path.resolve(process.cwd(), '.env.production') })

/*const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)*/

async function listModels() {
  try {
    // Usamos el cliente directamente para pedir la lista
    // Probamos con v1 que es la estable
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}`)
    const data = await response.json()

    console.log('--- MODELOS DISPONIBLES EN TU CUENTA ---')
    
    if (data.models) {
      data.models.forEach(m => {
        // Filtramos solo los que sirven para generar contenido (IA Generativa)
        if (m.supportedGenerationMethods.includes('generateContent')) {
          console.log(`✅ ID: ${m.name.split('/')[1]}`)
          console.log(`   Descripción: ${m.description}`)
          console.log(`   Límites: Entrada ${m.inputTokenLimit} tokens / Salida ${m.outputTokenLimit}`)
          console.log('---------------------------------------')
        }
      })
    } else {
      console.log('❌ No se encontraron modelos. Revisa tu API Key.')
      console.log('Respuesta de Google:', data)
    }
  } catch (error) {
    console.error('❌ Error al conectar con Google:', error.message)
  }
}

listModels()