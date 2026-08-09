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

const MainLayout = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()

  const [collapsed, setCollapsed] = useState(false)
  const [anchorEl, setAnchorEl] = useState(null)
  const [openGroups, setOpenGroups] = useState({})

  const user = useSelector(state => state.user?.user || null)

  useEffect(() => {
    if (!user?.tenantId) {
      navigate('/login', { replace: true })
    }
  }, [user, navigate])

  const { selectedKey, openKey } = useMemo(() => {
    const key = location.pathname.replace('/admin/', '') || 'dashboard'
    const group = adminMenuItems.find(item =>
      item.children?.some(child => child.key === key),
    )
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

  const renderMenuItems = items =>
    items.map(group => {
      const GroupIcon = group.icon
      const isOpen = openGroups[group.key]

      if (group.children?.length) {
        return (
          <Box key={group.key}>
            <ListItemButton
              onClick={() => handleGroupToggle(group.key)}
              sx={groupHeaderSx}
            >
              <ListItemIcon>
                <Badge color="error" variant={group.isNew ? 'dot' : 'standard'}>
                  <GroupIcon sx={{ fontSize: 22 }} />
                </Badge>
              </ListItemIcon>
              {!collapsed && <ListItemText primary={group.label} />}
              {!collapsed && (
                isOpen
                  ? <ExpandLess sx={{ fontSize: 18, color: TEXT_SECONDARY }} />
                  : <ExpandMore sx={{ fontSize: 18, color: TEXT_SECONDARY }} />
              )}
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
                        <Badge
                          color="error"
                          variant={item.isNew ? 'dot' : 'standard'}
                        >
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
            <Stack direction="row" alignItems="center" spacing={1.5}>
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
                <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#fff', lineHeight: 1.2, letterSpacing: -0.3 }}>
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
              <Stack direction="row" spacing={1.5} alignItems="center">
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
                  <Typography variant="body2" sx={{ color: '#fff', fontWeight: 600, fontSize: '0.8rem' }} noWrap>
                    {user.firstname} {user.lastname}
                  </Typography>
                  <Typography variant="caption" sx={{ color: TEXT_SECONDARY, fontSize: '0.7rem' }} noWrap>
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
              <Stack direction="row" spacing={1} alignItems="center">
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
                    <Typography variant="body2" sx={{ ml: 1, fontWeight: 600, color: 'text.primary', fontSize: '0.85rem' }}>
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
                    <Typography variant="body2" fontWeight={500}>
                      Cerrar sesión
                    </Typography>
                  </MenuItem>
                </Menu>
              </Stack>
            )}
          </Toolbar>
        </AppBar>

        <Box sx={{ p: 3, flex: 1, bgcolor: '#f8fafc' }}>
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
