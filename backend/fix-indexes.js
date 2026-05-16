import mongoose from 'mongoose'
import dotenv from 'dotenv'
//node fix-indexes.js
dotenv.config({ path: '.env.development' }) // Asegúrate de que apunte a tu DB local

const fix = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL)
    console.log('✅ Conectado a MongoDB')

    const collection = mongoose.connection.db.collection('users')
    
    // 1. Ver qué índices existen realmente
    const indexes = await collection.indexes()
    console.log('Índices actuales:', indexes.map(i => i.name))

    // 2. Buscar el índice problemático (normalmente se llama domain_1)
    const domainIndex = indexes.find(i => i.name.includes('domain'))

    if (domainIndex) {
      await collection.dropIndex(domainIndex.name)
      console.log(`🚀 ¡Éxito! Índice "${domainIndex.name}" eliminado.`)
    } else {
      console.log('ℹ️ No se encontró el índice "domain". Intentando borrar por nombre de campo...')
      // Intento preventivo por si tiene otro nombre
      try { await collection.dropIndex('domain_1') } catch (e) {e}
    }

    console.log('Terminado. Ya puedes borrar este archivo y reiniciar tu servidor.')
    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err)
    process.exit(1)
  }
}

fix()