// 📄 src/utils/adminMenu.js
import React from 'react'
import { privateRoutes } from '../routes/routesConfig'
import {
  Dashboard,
  AutoAwesome,
  Storefront,
  LocalOffer,
  AddShoppingCart,
} from '@mui/icons-material'
import ArchitectureIcon from '@mui/icons-material/Architecture'
import SpaceDashboardIcon from '@mui/icons-material/SpaceDashboard'
import RequestQuoteIcon from '@mui/icons-material/RequestQuote'
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer'
import LocalOfferIcon from '@mui/icons-material/LocalOffer'
import QuizIcon from '@mui/icons-material/Quiz'
import PersonIcon from '@mui/icons-material/Person'
import OutboxIcon from '@mui/icons-material/Outbox'
import { Badge, ListItemIcon } from '@mui/material'

// 🔹 Traducciones y etiquetas
const translations = {
  '': 'Dashboard', // 🔹 agregada
  clientes: 'Clientes',
  consultas: 'Consultas',
  promociones: 'Promociones',
  ordenes: 'Órdenes',
  EditProduct: 'Editar Producto',
  AddProduct: 'Análisis IA',
  diseñoweb: 'Crear Diseño Web',
  productlist: 'Lista de Productos',
  'product-analysis': 'Agente IA',
  'crear-cupon': 'Crear Cupón',
  couponlist: 'Lista de Cupones',
  'bandeja-entrada-ia-comercial': 'Bandeja Entrada Comercial',
}

// 🔹 Colores por grupo
const groupColors = {
  '': '#4caf50',
  clientes: '#2196f3',
  consultas: '#ff9800',
  ordener: '#9c27b0',
  promociones: '#ff5722',
  catalog: '#3f51b5',
  marketing: '#f44336',
  themeBuilder: '#607d8b',
  'bandeja-entrada-ia-comercial': '#00bcd4',
}

// 🔹 Grupos y subitems con iconos diferenciados
const groups = {
  '': { label: 'Dashboard', icon: SpaceDashboardIcon },
  clientes: { label: 'Clientes', icon: PersonIcon },
  consultas: { label: 'Consultas', icon: QuizIcon },
  ordener: {
    label: 'Órdenes',
    icon: RequestQuoteIcon,
    items: [{ key: 'ordenes', icon: RequestQuoteIcon }],
  },
  'bandeja-entrada-ia-comercial': {
    label: 'Bandeja Entrada Comercial',
    icon: QuestionAnswerIcon,
  },
  EditProduct: { label: 'Editar Producto', icon: AddShoppingCart },
  promociones: { label: 'Promociones', icon: LocalOfferIcon },
  catalog: {
    label: 'Productos',
    icon: Storefront,
    items: [
      { key: 'AddProduct', icon: AutoAwesome },
      { key: 'productlist', icon: Storefront },
      { key: 'product-analysis', icon: OutboxIcon },
    ],
  },
  marketing: {
    label: 'Cupones',
    icon: LocalOffer,
    items: [{ key: 'crear-cupon', icon: LocalOffer }],
  },
  themeBuilder: {
    label: 'Diseño Web',
    icon: ArchitectureIcon,
    items: [{ key: 'diseñoweb', icon: ArchitectureIcon }],
  },
}

// 🔹 Función helper para renderizar iconos con MUI
const renderIcon = (IconComp, color = '#616161', isNew = false) => {
  const icon = (
    <ListItemIcon>
      <IconComp
        sx={{
          color,
          minWidth: 36,
          fontSize: 26,
          transition: 'transform 0.2s, color 0.2s',
          '&:hover': { transform: 'scale(1.2)' },
        }}
      />
    </ListItemIcon>
  )

  return isNew ? (
    <Badge color="secondary" variant="dot">
      {icon}
    </Badge>
  ) : (
    icon
  )
}

// 🔁 Generar menú dinámico y agrupado (solo referencias, no JSX)
const adminMenuItems = []

privateRoutes.forEach(({ path, meta }) => {
  const key = path.replace('/admin/', '') || ''

  const label =
    translations[key] ||
    key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  const groupEntry = Object.entries(groups).find(([_, group]) =>
    group.items?.some(item => typeof item === 'object' && item.key === key),
  )

  const color = groupColors[groupEntry?.[0]] || '#616161'
  let IconComp = groups[key]?.icon || Dashboard // fallback

  if (groupEntry) {
    const [groupKey, group] = groupEntry
    const itemDef = group.items?.find(
      item => typeof item === 'object' && item.key === key,
    )
    IconComp = itemDef?.icon || group.icon

    const item = {
      key,
      label,
      icon: IconComp,
      iconColor: color,
      isNew: meta?.new || false,
      component: label,
    }

    const existingGroup = adminMenuItems.find(i => i.key === groupKey)
    if (existingGroup) existingGroup.children.push(item)
    else
      adminMenuItems.push({
        key: groupKey,
        label: group.label,
        icon: group.icon,
        iconColor: color,
        children: [item],
      })
  } else {
    // Items sueltos
    adminMenuItems.push({
      key,
      label,
      icon: IconComp,
      iconColor: color,
      isNew: meta?.new || false,
      component: label,
    })
  }
})

export { adminMenuItems }
