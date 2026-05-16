// -----------------------------------------------------
// CACHE EN MEMORIA (PRODUCCIÓN SIN REDIS)
// -----------------------------------------------------
// TTL por cada key, Map en memoria, limpieza automática.
// -----------------------------------------------------

// Mapa interno
const memoryCache = new Map()

// Limpieza automática para evitar acumulación
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt <= now) {
      memoryCache.delete(key)
    }
  }
}, 60 * 1000) // limpia cada 1 minuto

// -----------------------------------------------------
// SET
// -----------------------------------------------------
export const cacheSet = async (key, value, ttlSec = 3600) => {
  try {
    memoryCache.set(key, {
      value,
      expiresAt: Date.now() + ttlSec * 1000,
    })
    return true
  } catch (err) {
    console.error('[CacheSet] Error:', err)
    return false
  }
}

// -----------------------------------------------------
// GET
// -----------------------------------------------------
export const cacheGet = async key => {
  try {
    const entry = memoryCache.get(key)
    if (!entry) return null

    if (Date.now() > entry.expiresAt) {
      memoryCache.delete(key)
      return null
    }
    return entry.value

  } catch (err) {
    console.error('[CacheGet] Error:', err)
    return null
  }
}

// -----------------------------------------------------
// DEL
// -----------------------------------------------------
export const cacheDel = async key => {
  try {
    memoryCache.delete(key)
    return true
  } catch (err) {
    console.error('[CacheDel] Error:', err)
    return false
  }
}
