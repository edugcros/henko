// 📁 src/utils/adminMenu.jsx
//
// Estructura del menú lateral del panel.
//
// Antes se derivaba automáticamente de privateRoutes: el orden del menú era
// el orden del archivo de rutas y todo lo que no estuviera dentro de un grupo
// quedaba suelto en el primer nivel. Eso daba 17 entradas de primer nivel, y
// "Productos" — lo que el comercio usa todos los días — caía en la posición
// 16, debajo de seis pantallas de IA y del wizard de onboarding.
//
// Ahora la estructura es explícita. El orden es el de este archivo, y las
// etiquetas son las que cada pantalla ya usa como título propio, así el menú
// y la página dicen lo mismo:
//
//   - AddProduct         se titula "Crear producto con IA guiada"
//   - ProductAnalysisPage se titula "Programación de imágenes"
//
// Antes se llamaban "Análisis IA" y "Agente IA" respectivamente, mientras que
// las cinco pantallas del chatbot comercial se llamaban "Agente IA · algo".
// Tres cosas distintas con el mismo nombre y ninguna con el suyo.
//
// Ser explícito tiene un riesgo: una ruta nueva que nadie agregue acá se
// vuelve inalcanzable desde el menú. Por eso al final se verifica la
// cobertura contra privateRoutes — lo que falte se agrega igual al final y se
// avisa por consola en desarrollo, así se nota pero nunca desaparece.

import { privateRoutes } from '../routes/routesConfig'

import SpaceDashboardIcon from '@mui/icons-material/SpaceDashboard'
import StorefrontIcon from '@mui/icons-material/Storefront'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import Inventory2Icon from '@mui/icons-material/Inventory2'
import ScheduleIcon from '@mui/icons-material/Schedule'
import RequestQuoteIcon from '@mui/icons-material/RequestQuote'
import PersonIcon from '@mui/icons-material/Person'
import QuizIcon from '@mui/icons-material/Quiz'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer'
import TuneIcon from '@mui/icons-material/Tune'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import SchoolIcon from '@mui/icons-material/School'
import CampaignIcon from '@mui/icons-material/Campaign'
import InsightsIcon from '@mui/icons-material/Insights'
import LocalOfferIcon from '@mui/icons-material/LocalOffer'
import InstagramIcon from '@mui/icons-material/Instagram'
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber'
import PaletteIcon from '@mui/icons-material/Palette'
import ArchitectureIcon from '@mui/icons-material/Architecture'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import PaymentIcon from '@mui/icons-material/Payment'
import SettingsIcon from '@mui/icons-material/Settings'

// Rutas que existen pero no van en el menú, con el motivo.
// Un Set vacío de comentarios haría que la verificación de cobertura de abajo
// pareciera rota cada vez que alguien la lee.
const HIDDEN_ROUTES = new Map([
  // El wizard se abre solo al terminar el alta; como ítem fijo del menú
  // aparecía para siempre, incluso con el onboarding ya completo.
  ['onboarding', 'se entra desde el alta, no desde el menú'],

  // Pantalla de detalle de un producto puntual: se llega desde la lista. Sin
  // esta entrada, la verificación de cobertura la trataría como ruta huérfana
  // y la agregaría al menú con un ':productId' en la etiqueta.
  ['edit-product/:productId', 'se llega desde la lista de productos'],
])

/**
 * Estructura del menú, en orden de aparición.
 *
 * `key` de un grupo NO es una ruta: solo sirve para abrir y cerrar. Las rutas
 * son las `key` de los hijos y las de los ítems sueltos.
 *
 * Dos ítems que serían un grupo de uno (Órdenes, Clientes, Consultas, Pagos)
 * quedan sueltos a propósito: agrupar un solo hijo agrega un clic y no
 * organiza nada.
 */
const MENU_STRUCTURE = [
  { key: '', label: 'Dashboard', icon: SpaceDashboardIcon },

  {
    key: 'productos',
    label: 'Productos',
    icon: StorefrontIcon,
    children: [
      { key: 'AddProduct', label: 'Crear producto', icon: AutoAwesomeIcon },
      { key: 'productlist', label: 'Lista de productos', icon: Inventory2Icon },
      {
        key: 'product-analysis',
        label: 'Programación de imágenes',
        icon: ScheduleIcon,
      },
    ],
  },

  { key: 'ordenes', label: 'Órdenes', icon: RequestQuoteIcon },
  { key: 'clientes', label: 'Clientes', icon: PersonIcon },
  { key: 'consultas', label: 'Consultas', icon: QuizIcon },

  {
    key: 'asistente-ventas',
    label: 'Asistente de ventas',
    icon: SmartToyIcon,
    children: [
      {
        key: 'bandeja-entrada-ia-comercial',
        label: 'Bandeja de entrada',
        icon: QuestionAnswerIcon,
      },
      { key: 'agente-ia-config', label: 'Configuración', icon: TuneIcon },
      {
        key: 'agente-ia-conocimiento',
        label: 'Base de conocimiento',
        icon: MenuBookIcon,
      },
      { key: 'agente-ia-aprendizaje', label: 'Aprendizaje', icon: SchoolIcon },
      { key: 'agente-ia-campanas', label: 'Campañas', icon: CampaignIcon },
      { key: 'agente-ia-panel', label: 'Métricas', icon: InsightsIcon },
    ],
  },

  {
    key: 'marketing',
    label: 'Marketing',
    icon: LocalOfferIcon,
    children: [
      { key: 'promociones', label: 'Promociones', icon: LocalOfferIcon },
      { key: 'crear-cupon', label: 'Cupones', icon: ConfirmationNumberIcon },
      { key: 'redes-sociales', label: 'Redes sociales', icon: InstagramIcon },
      { key: 'meta-pixel', label: 'Meta Pixel', icon: InsightsIcon },
    ],
  },

  {
    key: 'diseno',
    label: 'Diseño y contenido',
    icon: PaletteIcon,
    children: [
      { key: 'diseñoweb', label: 'Diseño web', icon: ArchitectureIcon },
      {
        key: 'editor-imagen-ia',
        label: 'Editor de imágenes',
        icon: AutoFixHighIcon,
      },
    ],
  },

  {
    key: 'configuracion',
    label: 'Configuración',
    icon: SettingsIcon,
    children: [
      {
        key: 'configuracion-comercio',
        label: 'Comercio',
        icon: StorefrontIcon,
      },
      { key: 'configuracion-pagos', label: 'Pagos', icon: PaymentIcon },
    ],
  },
]

// Ruta → meta, para saber cuáles llevan el punto de "nuevo".
const routeMetaByKey = new Map(
  privateRoutes.map(({ path, meta }) => [
    path.replace('/admin/', ''),
    meta || {},
  ]),
)

const isNewRoute = key => Boolean(routeMetaByKey.get(key)?.new)

const buildItem = item => ({
  key: item.key,
  label: item.label,
  icon: item.icon,
  isNew: isNewRoute(item.key),
})

const buildGroup = group => {
  const children = group.children.map(buildItem)

  return {
    key: group.key,
    label: group.label,
    icon: group.icon,
    // El punto de "nuevo" sube al grupo: si vive dentro de un grupo cerrado,
    // nadie lo ve.
    isNew: children.some(child => child.isNew),
    children,
  }
}

const adminMenuItems = MENU_STRUCTURE.map(entry =>
  entry.children ? buildGroup(entry) : buildItem(entry),
)

// ─── Verificación de cobertura ───────────────────────────

const menuKeys = new Set(
  adminMenuItems.flatMap(entry =>
    entry.children ? entry.children.map(child => child.key) : [entry.key],
  ),
)

const orphanRoutes = [...routeMetaByKey.keys()].filter(
  key => !menuKeys.has(key) && !HIDDEN_ROUTES.has(key),
)

// El error simétrico: una entrada del menú que apunta a una ruta que no
// existe navega a un 404 y solo se descubre haciendo clic.
if (process.env.NODE_ENV !== 'production') {
  const brokenKeys = [...menuKeys].filter(key => !routeMetaByKey.has(key))

  if (brokenKeys.length) {
    console.error(
      `[adminMenu] Entradas del menú sin ruta: ${brokenKeys.join(', ')}. ` +
        'Navegan a 404. Revisá privateRoutes (src/routes/routesConfig.js).',
    )
  }
}

if (orphanRoutes.length) {
  // Se agregan al final para que la pantalla siga siendo alcanzable, con la
  // etiqueta derivada de la ruta. Es un estado transitorio, no un diseño:
  // lo correcto es darle lugar propio en MENU_STRUCTURE.
  adminMenuItems.push(
    ...orphanRoutes.map(key => ({
      key,
      label: key
        .replace(/-/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase()),
      icon: SpaceDashboardIcon,
      isNew: isNewRoute(key),
    })),
  )

  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      `[adminMenu] Rutas sin lugar en el menú: ${orphanRoutes.join(', ')}. ` +
        'Se agregaron al final. Ubicalas en MENU_STRUCTURE (src/utils/adminMenu.jsx).',
    )
  }
}

export { adminMenuItems }
