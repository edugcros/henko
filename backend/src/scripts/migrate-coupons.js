// 📁 scripts/migrate-coupons.js
import mongoose from 'mongoose'

const cleanCouponIndexes = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL)
    console.log('🔗 Conectado a MongoDB')

    const db = mongoose.connection.db
    const collection = db.collection('coupons')

    // Obtener índices actuales
    const indexes = await collection.indexes()
    console.log('📋 Índices actuales:', indexes.map(i => i.name))

    // Eliminar índices obsoletos
    const obsoleteIndexes = ['name_1', 'code_1'] // code_1 sin tenant es obsoleto
    
    for (const indexName of obsoleteIndexes) {
      try {
        await collection.dropIndex(indexName)
        console.log(`✅ Índice ${indexName} eliminado`)
      } catch (err) {
        if (err.message.includes('index not found')) {
          console.log(`ℹ️ Índice ${indexName} no existe`)
        } else {
          throw err
        }
      }
    }

    // Crear índice correcto si no existe
    await collection.createIndex({ code: 1, tenantId: 1 }, { unique: true })
    console.log('✅ Índice {code: 1, tenantId: 1} creado')

    // Verificar índices finales
    const finalIndexes = await collection.indexes()
    console.log('📋 Índices finales:', finalIndexes.map(i => i.name))

    await mongoose.disconnect()
    console.log('👋 Desconectado')

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

cleanCouponIndexes()