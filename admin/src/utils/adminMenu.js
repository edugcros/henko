// 📄 src/utils/adminMenu.js
import React from 'react'
import { privateRoutes } from '../routes/routesConfig'
import {
  Dashboard as DashboardIcon,
  ShoppingCart as ShoppingCartIcon,
  Person as PersonIcon,
  Assignment as AssignmentIcon,
  AutoAwesome as AutoAwesomeIcon,
  Storefront as StorefrontIcon,
  LocalOffer as LocalOfferIcon,
  ColorLens as ColorLensIcon,
  AddShoppingCart as AddShoppingCartIcon,
} from '@mui/icons-material'
import OutboxIcon from '@mui/icons-material/Outbox'
import { Badge, ListItemIcon } from '@mui/material'

// 🔹 Traducciones y etiquetas
const translations = {
  dashboard: 'Dashboard', // 🔹 agregada
  customers: 'Clientes',
  enquiries: 'Consultas',
  orders: 'Órdenes',
  EditProduct: 'Editar Producto',
  addproduct: 'Análisis IA',
  ThemeCustomizer: 'Diseño Visual',
  productlist: 'Lista de Productos',
  'product-analysis': 'Agente IA',
  addcoupon: 'Crear Cupón',
  couponlist: 'Lista de Cupones',
  addblog: 'Agregar Blog',
  bloglist: 'Lista de Blogs',
  addblogcategory: 'Agregar Categoría de Blog',
}

// 🔹 Colores por grupo
const groupColors = {
  dashboard: '#4caf50',
  customers: '#2196f3',
  enquiries: '#ff9800',
  orders: '#9c27b0',
  catalog: '#3f51b5',
  marketing: '#f44336',
  blogs: '#795548',
  storedesign: '#009688',
  themeBuilder: '#607d8b',
}

// 🔹 Grupos y subitems con iconos diferenciados
const groups = {
  dashboard: { label: 'Dashboard', icon: DashboardIcon },
  customers: { label: 'Clientes', icon: PersonIcon },
  enquiries: { label: 'Consultas', icon: AssignmentIcon },
  orders: { label: 'Órdenes', icon: ShoppingCartIcon },
  EditProduct: { label: 'Editar Producto', icon: AddShoppingCartIcon },
  catalog: {
    label: 'Productos',
    icon: StorefrontIcon,
    items: [
      { key: 'addproduct', icon: AutoAwesomeIcon },
      { key: 'productlist', icon: StorefrontIcon },
      { key: 'product-analysis', icon: OutboxIcon },
    ],
  },
  marketing: {
    label: 'Marketing',
    icon: LocalOfferIcon,
    items: [{ key: 'addcoupon', icon: LocalOfferIcon }],
  },
  ThemeCustomizer: { label: 'Diseño Visual', icon: ColorLensIcon },
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
  let IconComp = groups[key]?.icon || DashboardIcon // fallback

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
