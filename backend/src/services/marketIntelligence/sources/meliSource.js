/**
 * meliSource.js — RETIRADO
 *
 * MercadoLibre cerró /sites/{siteId}/search a integradores externos. El
 * PolicyAgent devuelve 403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES incluso con
 * un access_token válido y todos los scopes concedidos — verificado con
 * scripts/testMeliAccess.js contra las credenciales reales de HENKO:
 *
 *   ▸ Sin credenciales (anónimo)          → 403 forbidden
 *   ▸ Con MP_ACCESS_TOKEN                 → 403 At least one policy...
 *   ▸ MELI client_credentials             → token OK, búsqueda 403
 *
 * No es un problema de configuración: no existe combinación de credenciales
 * que lo resuelva. Otros integradores reportan lo mismo (el servidor MCP
 * oficial de MercadoLibre deprecó su herramienta search_products por esta
 * misma razón).
 *
 * Este módulo se mantiene como stub que falla rápido, en vez de borrarse,
 * por dos motivos:
 *   1. Evita que alguien vuelva a implementarlo sin conocer el historial.
 *   2. Si MELI reabre el recurso, solo hay que restaurar la implementación
 *      (está en el historial de git) — el contrato con el scoring no cambia.
 *
 * NO hace ninguna llamada HTTP: cada intento costaba ~1s de latencia por
 * análisis para terminar siempre en el mismo 403.
 */

const RETIRED_REASON =
  'NO_DISPONIBLE: MercadoLibre cerró su API de búsqueda a integradores externos (403 PolicyAgent)'

/**
 * @returns {Promise<{available: false, reason: string, retired: true}>}
 */
export async function getMeliSignals() {
  return {
    available: false,
    retired: true,
    reason: RETIRED_REASON,
  }
}
