import React, { useState, useEffect, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate, Outlet, useLocation } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import { logoutUser, resetAuthState } from '@features/auth/authSlice'
import { adminMenuItems } from '@utils/adminMenu'
import { persistor } from '@app/store'

import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Avatar,
  Badge,
  Menu,
  MenuItem,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  CssBaseline,
  Divider,
  Stack,
  Tooltip,
} from '@mui/material'

import {
  Menu as MenuIcon,
  ChevronLeft,
  ExpandLess,
  ExpandMore,
  Logout as LogoutIcon,
} from '@mui/icons-material'

import 'react-toastify/dist/ReactToastify.css'
import './MainLayout.css'

const DRAWER_WIDTH = 260
const COLLAPSED_WIDTH = 72

const SIDEBAR_BG = 'linear-gradient(195deg, #0f172a 0%, #1e293b 100%)'
const ACTIVE_BG = 'rgba(99, 102, 241, 0.15)'
const ACTIVE_COLOR = '#818CF8'
const HOVER_BG = 'rgba(255, 255, 255, 0.06)'
const TEXT_PRIMARY = '#e2e8f0'
const TEXT_SECONDARY = 'rgba(148, 163, 184, 0.8)'

const sidebarItemSx = {
  mx: 1,
  borderRadius: 2,
  mb: 0.3,
  transition: 'all 0.15s ease',
  color: TEXT_PRIMARY,
  '&:hover': {
    bgcolor: HOVER_BG,
  },
  '&.Mui-selected': {
    bgcolor: ACTIVE_BG,
    color: ACTIVE_COLOR,
    '&:hover': { bgcolor: ACTIVE_BG },
    '& .MuiListItemIcon-root': { color: ACTIVE_COLOR },
  },
  '& .MuiListItemIcon-root': {
    color: TEXT_SECONDARY,
    minWidth: 40,
  },
  '& .MuiListItemText-primary': {
    fontSize: '0.875rem',
    fontWeight: 500,
  },
}

const groupHeaderSx = {
  mx: 1,
  borderRadius: 2,
  mb: 0.3,
  color: TEXT_PRIMARY,
  transition: 'all 0.15s ease',
  '&:hover': { bgcolor: HOVER_BG },
  '& .MuiListItemIcon-root': {
    color: TEXT_SECONDARY,
    minWidth: 40,
  },
  '& .MuiListItemText-primary': {
    fontSize: '0.875rem',
    fontWeight: 600,
  },
}

const childItemSx = {
  ...sidebarItemSx,
  pl: 5.5,
  '& .MuiListItemText-primary': {
    fontSize: '0.82rem',
    fontWeight: 400,
  },
}

// Fragmento corregido de MainLayout.js
//
// Reemplazar SOLO estas partes del archivo actual. El resto queda igual.
 
// ─────────────────────────────────────────────────────────────────────────
// 1) Estado de sesión: esperar la rehidratación antes de decidir
// ─────────────────────────────────────────────────────────────────────────
//
// PROBLEMA QUE RESUELVE:
// El efecto redirigía a /login en el primer render, cuando redux-persist
// todavía no había rehidratado el store. Ahí `user` es null aunque haya
// sesión válida guardada, así que el admin veía un parpadeo al login (o
// quedaba ahí directamente, según cuánto tardara la rehidratación).
//
// `_persist.rehydrated` lo expone redux-persist en el root del state — el
// mismo que tu código ya asume al hacer localStorage.removeItem('persist:root').
// Si el árbol está envuelto en PersistGate, este flag ya viene en true y el
// chequeo es un no-op: no rompe nada, solo cubre el caso en que no lo esté.
 
const MainLayout = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
 
  const [collapsed, setCollapsed] = useState(false)
  const [anchorEl, setAnchorEl] = useState(null)
  const [openGroups, setOpenGroups] = useState({})
 
  const user = useSelector(state => state.user?.user || null)
 
  // `?? true` como default: si el store no usa redux-persist en el root, no
  // hay nada que esperar y el comportamiento vuelve a ser el de antes.
  const rehydrated = useSelector(state => state._persist?.rehydrated ?? true)
 
  useEffect(() => {
    // Antes de la rehidratación no se sabe si hay sesión: null todavía no
    // significa "no autenticado", significa "no cargado".
    if (!rehydrated) return
 
    if (!user?.tenantId) {
      navigate('/login', { replace: true })
    }
  }, [rehydrated, user, navigate])
 
  // ... el resto de los hooks y handlers queda igual ...
 
  // ─────────────────────────────────────────────────────────────────────
  // 2) No renderizar el layout hasta saber si hay sesión
  // ─────────────────────────────────────────────────────────────────────
  //
  // Sin esto, el panel se dibuja completo por un instante con user en null
  // (sidebar sin datos, avatar vacío) y recién después se va al login. El
  // parpadeo es visible y da sensación de que algo se rompió.
  //
  // Va DESPUÉS de todos los hooks: un return temprano antes de ellos
  // rompería las reglas de hooks de React.
  if (!rehydrated) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          bgcolor: '#f8fafc',
        }}
      >
        <CircularProgress size={28} />
      </Box>
    )
  }
 
  // Sesión ausente: el efecto de arriba ya disparó la navegación al login.
  // Devolver null evita renderizar un panel que está por desaparecer.
  if (!user?.tenantId) return null
 
  const { selectedKey, openKey } = useMemo(() => {
    // El Dashboard vive en la key '' (navega a /admin/). Antes esto devolvía
    // 'dashboard' cuando la ruta quedaba vacía, así que no coincidía con
    // ninguna entrada del menú y el ítem nunca se marcaba como activo. La
    // barra opcional cubre además /admin sin barra final.
    const key = location.pathname.replace(/^\/admin\/?/, '')
    const group = adminMenuItems.find(item => item.children?.some(child => child.key === key))
    return { selectedKey: key, openKey: group?.key }
  }, [location.pathname])

  useEffect(() => {
    if (openKey) {
      setOpenGroups(prev => ({ ...prev, [openKey]: true }))
    }
  }, [openKey])

  const handleLogoutUser = async () => {
    try {
      await dispatch(logoutUser())

      if (persistor) await persistor.purge()

      dispatch(resetAuthState())

      sessionStorage.clear()
      localStorage.removeItem('persist:root')

      // token/refreshToken viven en cookies httpOnly — JS no puede leerlas
      // ni removerlas (ni falta que haga: el logout server-side ya las
      // limpió). Cookies.remove acá era un no-op desde siempre para
      // refreshToken, y lo es para token desde la fase 1 del refactor.

      navigate('/login', { replace: true })
    } catch (error) {
      console.error('Error en logout:', error)
      navigate('/login', { replace: true })
    }
  }

  const handleDropdownOpen = event => {
    setAnchorEl(event.currentTarget)
  }

  const handleDropdownClose = () => {
    setAnchorEl(null)
  }

  const handleGroupToggle = key => {
    setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const renderMenuItems = items =>
    items.map(group => {
      const GroupIcon = group.icon
      const isOpen = openGroups[group.key]

      if (group.children?.length) {
        return (
          <Box key={group.key}>
            <ListItemButton onClick={() => handleGroupToggle(group.key)} sx={groupHeaderSx}>
              <ListItemIcon>
                <Badge color="error" variant={group.isNew ? 'dot' : 'standard'}>
                  <GroupIcon sx={{ fontSize: 22 }} />
                </Badge>
              </ListItemIcon>
              {!collapsed && <ListItemText primary={group.label} />}
              {!collapsed &&
                (isOpen ? (
                  <ExpandLess sx={{ fontSize: 18, color: TEXT_SECONDARY }} />
                ) : (
                  <ExpandMore sx={{ fontSize: 18, color: TEXT_SECONDARY }} />
                ))}
            </ListItemButton>

            <Collapse in={isOpen} timeout="auto" unmountOnExit>
              <List component="div" disablePadding>
                {group.children.map(item => {
                  const ItemIcon = item.icon
                  return (
                    <ListItemButton
                      key={item.key}
                      sx={childItemSx}
                      selected={selectedKey === item.key}
                      onClick={() => navigate(`/admin/${item.key}`)}
                    >
                      <ListItemIcon>
                        <Badge color="error" variant={item.isNew ? 'dot' : 'standard'}>
                          <ItemIcon sx={{ fontSize: 20 }} />
                        </Badge>
                      </ListItemIcon>
                      {!collapsed && <ListItemText primary={item.label} />}
                    </ListItemButton>
                  )
                })}
              </List>
            </Collapse>
          </Box>
        )
      }

      return (
        <ListItemButton
          key={group.key}
          selected={selectedKey === group.key}
          onClick={() => navigate(`/admin/${group.key}`)}
          sx={sidebarItemSx}
        >
          <ListItemIcon>
            <Badge color="error" variant={group.isNew ? 'dot' : 'standard'}>
              <GroupIcon sx={{ fontSize: 22 }} />
            </Badge>
          </ListItemIcon>
          {!collapsed && <ListItemText primary={group.label} />}
        </ListItemButton>
      )
    })

  const drawerWidth = collapsed ? COLLAPSED_WIDTH : DRAWER_WIDTH

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <CssBaseline />

      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            background: SIDEBAR_BG,
            color: TEXT_PRIMARY,
            borderRight: '1px solid rgba(255,255,255,0.06)',
            transition: 'width 0.2s ease',
            overflowX: 'hidden',
          },
        }}
      >
        <Box
          sx={{
            px: collapsed ? 1 : 2.5,
            py: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            minHeight: 64,
          }}
        >
          {!collapsed && (
            <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1.5}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 2.5,
                  background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 900,
                  fontSize: 16,
                  color: '#fff',
                }}
              >
                H
              </Box>
              <Box>
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 800,
                    color: '#fff',
                    lineHeight: 1.2,
                    letterSpacing: -0.3,
                  }}
                >
                  Henko
                </Typography>
                <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontSize: '0.7rem' }}>
                  Admin Panel
                </Typography>
              </Box>
            </Stack>
          )}
          <IconButton
            onClick={() => setCollapsed(prev => !prev)}
            sx={{
              color: TEXT_SECONDARY,
              width: 32,
              height: 32,
              '&:hover': { bgcolor: HOVER_BG, color: '#fff' },
            }}
          >
            {collapsed ? <MenuIcon sx={{ fontSize: 20 }} /> : <ChevronLeft sx={{ fontSize: 20 }} />}
          </IconButton>
        </Box>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mx: 1.5 }} />

        <Box sx={{ py: 1, flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <List disablePadding>{renderMenuItems(adminMenuItems)}</List>
        </Box>

        {user && !collapsed && (
          <>
            <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mx: 1.5 }} />
            <Box sx={{ p: 2 }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Avatar
                  sx={{
                    width: 34,
                    height: 34,
                    bgcolor: '#6366F1',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                  }}
                >
                  {user?.firstname?.[0]?.toUpperCase() || 'A'}
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    variant="body2"
                    sx={{ color: '#fff', fontWeight: 600, fontSize: '0.8rem' }}
                    noWrap
                  >
                    {user.firstname} {user.lastname}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: TEXT_SECONDARY, fontSize: '0.7rem' }}
                    noWrap
                  >
                    {user.email || 'Admin'}
                  </Typography>
                </Box>
              </Stack>
            </Box>
          </>
        )}
      </Drawer>

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <AppBar
          position="sticky"
          elevation={0}
          sx={{
            bgcolor: '#fff',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Toolbar sx={{ justifyContent: 'flex-end', minHeight: '56px !important' }}>
            {user && (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Tooltip title="Cerrar sesión">
                  <IconButton
                    onClick={handleDropdownOpen}
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 2,
                      px: 1.5,
                      py: 0.75,
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Avatar
                      sx={{
                        width: 28,
                        height: 28,
                        bgcolor: '#6366F1',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                      }}
                    >
                      {user?.firstname?.[0]?.toUpperCase() || 'A'}
                    </Avatar>
                    <Typography
                      variant="body2"
                      sx={{
                        ml: 1,
                        fontWeight: 600,
                        color: 'text.primary',
                        fontSize: '0.85rem',
                      }}
                    >
                      {user.firstname}
                    </Typography>
                  </IconButton>
                </Tooltip>

                <Menu
                  anchorEl={anchorEl}
                  open={Boolean(anchorEl)}
                  onClose={handleDropdownClose}
                  slotProps={{
                    paper: {
                      sx: {
                        mt: 1,
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: 'divider',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                        minWidth: 180,
                      },
                    },
                  }}
                >
                  <MenuItem
                    onClick={() => {
                      handleDropdownClose()
                      handleLogoutUser()
                    }}
                    sx={{ gap: 1.5, py: 1.25 }}
                  >
                    <LogoutIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      Cerrar sesión
                    </Typography>
                  </MenuItem>
                </Menu>
              </Stack>
            )}
          </Toolbar>
        </AppBar>

        <Box sx={{ p: 3, flex: 1, bgcolor: '#f8fafc' }}>
          <ToastContainer position="top-right" autoClose={250} newestOnTop theme="light" />
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}

export default MainLayout
