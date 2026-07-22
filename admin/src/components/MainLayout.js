import React, { useState, useEffect, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate, Outlet, useLocation } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import { logoutUser, resetAuthState } from '@features/auth/authSlice'
import { adminMenuItems } from '@utils/adminMenu'
import { persistor } from '@app/store'
import Cookies from 'js-cookie'

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
} from '@mui/material'

import {
  Menu as MenuIcon,
  ChevronLeft,
  ExpandLess,
  ExpandMore,
} from '@mui/icons-material'

import 'react-toastify/dist/ReactToastify.css'
import './MainLayout.css'

const DRAWER_WIDTH = 220

const MainLayout = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()

  const [collapsed, setCollapsed] = useState(false)
  const [anchorEl, setAnchorEl] = useState(null)
  const [openGroups, setOpenGroups] = useState({})

  const user = useSelector(state => state.user?.user || null)

  // 🔐 Protección básica de sesión
  useEffect(() => {
    if (!user?.tenantId) {
      navigate('/login', { replace: true })
    }
  }, [user, navigate])

  // 🔹 Selección de ruta y grupo
  const { selectedKey, openKey } = useMemo(() => {
    const key = location.pathname.replace('/admin/', '') || 'dashboard'
    const group = adminMenuItems.find(item =>
      item.children?.some(child => child.key === key),
    )
    return { selectedKey: key, openKey: group?.key }
  }, [location.pathname])

  // 🔹 Expandir grupo activo automáticamente
  useEffect(() => {
    if (openKey) {
      setOpenGroups(prev => ({ ...prev, [openKey]: true }))
    }
  }, [openKey])

  // 🔐 Logout completo
  const handleLogoutUser = async () => {
    try {
      await dispatch(logoutUser())

      if (persistor) await persistor.purge()

      dispatch(resetAuthState())

      sessionStorage.clear()
      localStorage.removeItem('persist:root')

      Cookies.remove('token')
      Cookies.remove('refreshToken')

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

  // 🔹 Renderizado del menú
  const renderMenuItems = items =>
    items.map(group => {
      const GroupIcon = group.icon
      const isOpen = openGroups[group.key]

      if (group.children?.length) {
        return (
          <Box key={group.key}>
            <ListItemButton onClick={() => handleGroupToggle(group.key)}>
              <ListItemIcon>
                <Badge color="error" variant={group.isNew ? 'dot' : 'standard'}>
                  <GroupIcon sx={{ color: group.iconColor }} />
                </Badge>
              </ListItemIcon>
              {!collapsed && <ListItemText primary={group.label} />}
              {!collapsed && (isOpen ? <ExpandLess /> : <ExpandMore />)}
            </ListItemButton>

            <Collapse in={isOpen} timeout="auto" unmountOnExit>
              <List component="div" disablePadding>
                {group.children.map(item => {
                  const ItemIcon = item.icon
                  return (
                    <ListItemButton
                      key={item.key}
                      sx={{ pl: 4 }}
                      selected={selectedKey === item.key}
                      onClick={() => navigate(`/admin/${item.key}`)}
                    >
                      <ListItemIcon>
                        <Badge
                          color="error"
                          variant={item.isNew ? 'dot' : 'standard'}
                        >
                          <ItemIcon sx={{ color: item.iconColor }} />
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
        >
          <ListItemIcon>
            <Badge color="error" variant={group.isNew ? 'dot' : 'standard'}>
              <GroupIcon sx={{ color: group.iconColor }} />
            </Badge>
          </ListItemIcon>
          {!collapsed && <ListItemText primary={group.label} />}
        </ListItemButton>
      )
    })

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <CssBaseline />

      {/* SIDEBAR */}
      <Drawer
        variant="permanent"
        sx={{
          width: collapsed ? 64 : DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: collapsed ? 64 : DRAWER_WIDTH,
            boxSizing: 'border-box',
            backgroundColor: '#001529',
            color: '#fff',
          },
        }}
      >
        <IconButton
          onClick={() => setCollapsed(prev => !prev)}
          sx={{ color: '#fff', m: 1 }}
        >
          {collapsed ? <MenuIcon /> : <ChevronLeft />}
        </IconButton>

        <List>{renderMenuItems(adminMenuItems)}</List>
      </Drawer>

      {/* HEADER + CONTENT */}
      <Box sx={{ flexGrow: 1 }}>
        <AppBar position="static" color="default" elevation={1}>
          <Toolbar sx={{ justifyContent: 'flex-end' }}>
            {user && (
              <>
                <IconButton onClick={handleDropdownOpen}>
                  <Avatar sx={{ bgcolor: '#87d068' }}>
                    {user?.firstname?.[0]?.toUpperCase() || 'A'}
                  </Avatar>
                </IconButton>

                <Typography sx={{ ml: 1 }}>
                  {user.firstname} {user.lastname}
                </Typography>

                <Menu
                  anchorEl={anchorEl}
                  open={Boolean(anchorEl)}
                  onClose={handleDropdownClose}
                >
                  <MenuItem
                    onClick={() => {
                      handleDropdownClose()
                      handleLogoutUser()
                    }}
                  >
                    Cerrar sesión
                  </MenuItem>
                </Menu>
              </>
            )}
          </Toolbar>
        </AppBar>

        <Box sx={{ p: 3 }}>
          <ToastContainer
            position="top-right"
            autoClose={250}
            newestOnTop
            theme="light"
          />
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}

export default MainLayout
