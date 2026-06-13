// 📁 src/pages/Profile/Profile.jsx
import React, { useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { useTenant } from '../contexts/TenantContext'
import { logoutUser, clearState, updateProfile } from '@features/user/userSlice'
import { persistor } from '@app/store'
import Cookies from 'js-cookie'

import {
  Box,
  Typography,
  Paper,
  Avatar,
  Grid,
  TextField,
  Button,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Card,
  CardContent,
  Chip,
  IconButton,
  Tooltip,
  useTheme,
  alpha,
  Skeleton,
  Alert,
} from '@mui/material'
import {
  Person as PersonIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  LocationOn as LocationIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Logout as LogoutIcon,
  Favorite as WishlistIcon,
  Compare as CompareIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material'

const Profile = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const theme = useTheme()
  const { themeConfig, isReady } = useTenant()

  const {
    user,
    wishlist,
    isLoading: isUserLoading,
  } = useSelector(state => state.user)
  const { cartItems } = useSelector(state => state.cart)
  const compareItems = useSelector(state => state.compare?.items || [])

  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
    firstname: '',
    lastname: '',
    email: user?.email || '',
    mobile: '',
    address: '',
  })
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  const resetFormFromUser = currentUser => {
    setFormData({
      firstname: currentUser?.firstname || '',
      lastname: currentUser?.lastname || '',
      email: currentUser?.email || '',
      mobile: currentUser?.mobile || '',
      address: currentUser?.address || '',
    })
  }

  useEffect(() => {
    resetFormFromUser(user)
  }, [user])

  // Colores dinámicos del tema
  const colors = {
    primary: themeConfig?.colors?.primary || theme.palette.brand.main,
    background:
      themeConfig?.colors?.background || theme.palette.background.default,
  }

  if (!isReady || (isUserLoading && !user)) {
    return (
      <Box p={4}>
        <Skeleton variant="text" width={300} height={60} />
        <Skeleton variant="rectangular" height={400} sx={{ mt: 2 }} />
      </Box>
    )
  }

  if (!user) {
    return (
      <Box p={4} textAlign="center">
        <Typography variant="h5" gutterBottom>
          No has iniciado sesión
        </Typography>
        <Button
          variant="contained"
          onClick={() => navigate('/login')}
          sx={{
            mt: 2,
            bgcolor: theme.palette.ctaPrimary.main,
            color: theme.palette.ctaPrimary.contrastText,
          }}
        >
          Iniciar Sesión
        </Button>
      </Box>
    )
  }

  const handleLogout = async () => {
    try {
      const token = Cookies.get('token')
      if (token) {
        const refreshToken = (await import('@features/user/userService'))
          .default
        try {
          const refreshResponse = await refreshToken()
          if (refreshResponse.success && refreshResponse.token) {
            Cookies.set('token', refreshResponse.token, {
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'Strict',
            })
          }
        } catch (err) {
          console.warn('Refresh token falló', err)
        }
      }

      await dispatch(logoutUser()).unwrap()
      await persistor.purge()
      dispatch(clearState())
      navigate('/login')
    } catch (error) {
      console.error('Error logout:', error)
      dispatch(clearState())
      navigate('/login')
    }
  }

  const handleSave = async () => {
    setFormError('')
    setFormSuccess('')

    const payload = {
      firstname: formData.firstname.trim(),
      lastname: formData.lastname.trim(),
      mobile: formData.mobile.replace(/[\s()-]/g, ''),
      address: formData.address.trim(),
    }

    if (!payload.firstname || !payload.lastname || !payload.mobile) {
      setFormError('Nombre, apellido y teléfono son obligatorios.')
      return
    }

    try {
      const result = await dispatch(updateProfile(payload)).unwrap()
      resetFormFromUser(result.user)
      setFormSuccess(result.message || 'Perfil actualizado correctamente.')
      setIsEditing(false)
    } catch (error) {
      console.error('Error actualizando perfil:', error)
      setFormError(
        typeof error === 'string'
          ? error
          : error?.message || 'No se pudo actualizar el perfil.',
      )
    }
  }

  const handleCancelEdit = () => {
    resetFormFromUser(user)
    setFormError('')
    setIsEditing(false)
  }

  const fullName =
    [user.firstname, user.lastname].filter(Boolean).join(' ') || 'Usuario'

  const stats = [
    {
      label: 'Favoritos',
      value: wishlist?.length || 0,
      icon: WishlistIcon,
      path: '/wishlist',
    },
    {
      label: 'Comparando',
      value: compareItems.length,
      icon: CompareIcon,
      path: '/compare-product',
    },
  ]

  const menuItems = [
    { label: 'Lista de Deseos', icon: WishlistIcon, path: '/wishlist' },
    {
      label: 'Comparar Productos',
      icon: CompareIcon,
      path: '/compare-product',
    },
    { label: 'Configuración', icon: SettingsIcon, path: '/settings' },
  ]

  return (
    <Box
      p={{ xs: 2, md: 4 }}
      sx={{
        minHeight: '100vh',
        bgcolor: alpha(colors.background, 0.5),
      }}
    >
      <Typography
        variant="h4"
        fontWeight={800}
        gutterBottom
        sx={{ color: 'text.primary' }}
      >
        Mi Perfil
      </Typography>

      <Grid container spacing={3}>
        {/* Columna izquierda: Info del usuario */}
        <Grid item xs={12} md={4}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              borderRadius: 3,
              border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
            }}
          >
            <Box textAlign="center" mb={3}>
              <Avatar
                sx={{
                  width: 100,
                  height: 100,
                  mx: 'auto',
                  mb: 2,
                  bgcolor: colors.primary,
                  fontSize: 40,
                }}
              >
                {fullName.charAt(0).toUpperCase() || <PersonIcon />}
              </Avatar>

              <Typography variant="h6" fontWeight={700}>
                {fullName}
              </Typography>

              <Chip
                label={user.role || 'Cliente'}
                size="small"
                variant="outlined"
                sx={{
                  mt: 1,
                  bgcolor: alpha(theme.palette.brand.main, 0.12),
                  color: theme.palette.brand.main,
                  borderColor: alpha(theme.palette.brand.main, 0.28),
                }}
              />
            </Box>

            <Divider sx={{ my: 2 }} />

            <List dense>
              <ListItem>
                <ListItemIcon>
                  <EmailIcon color="action" />
                </ListItemIcon>
                <ListItemText primary="Email" secondary={user.email} />
              </ListItem>

              <ListItem>
                <ListItemIcon>
                  <PhoneIcon color="action" />
                </ListItemIcon>
                <ListItemText
                  primary="Teléfono"
                  secondary={user.mobile || 'No especificado'}
                />
              </ListItem>
            </List>

            <Button
              fullWidth
              variant="outlined"
              color="error"
              startIcon={<LogoutIcon />}
              onClick={handleLogout}
              sx={{ mt: 2, borderRadius: 2 }}
            >
              Cerrar Sesión
            </Button>
          </Paper>

          {/* Stats */}
          <Grid container spacing={2} sx={{ mt: 2 }}>
            {stats.map(stat => (
              <Grid item xs={4} key={stat.label}>
                <Card
                  sx={{
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'transform 0.2s',
                    '&:hover': { transform: 'translateY(-4px)' },
                  }}
                  onClick={() => navigate(stat.path)}
                >
                  <CardContent sx={{ p: 2 }}>
                    <stat.icon sx={{ color: colors.primary, mb: 1 }} />
                    <Typography variant="h6" fontWeight={700}>
                      {stat.value}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {stat.label}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Grid>

        {/* Columna derecha: Edición y menú */}
        <Grid item xs={12} md={8}>
          <Paper
            elevation={0}
            sx={{
              p: 3,
              borderRadius: 3,
              border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
              mb: 3,
            }}
          >
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              mb={3}
            >
              <Typography variant="h6" fontWeight={700}>
                Información Personal
              </Typography>

              {!isEditing ? (
                <Button
                  startIcon={<EditIcon />}
                  onClick={() => setIsEditing(true)}
                  sx={{ color: colors.primary }}
                >
                  Editar
                </Button>
              ) : (
                <Box>
                  <IconButton
                    onClick={handleCancelEdit}
                    color="error"
                    disabled={isUserLoading}
                  >
                    <CancelIcon />
                  </IconButton>
                  <IconButton
                    onClick={handleSave}
                    color="success"
                    disabled={isUserLoading}
                  >
                    <SaveIcon />
                  </IconButton>
                </Box>
              )}
            </Box>

            {formError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {formError}
              </Alert>
            )}

            {formSuccess && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {formSuccess}
              </Alert>
            )}

            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Nombre"
                  value={formData.firstname}
                  onChange={e =>
                    setFormData(prev => ({
                      ...prev,
                      firstname: e.target.value,
                    }))
                  }
                  disabled={!isEditing}
                  InputProps={{ readOnly: !isEditing }}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Apellido"
                  value={formData.lastname}
                  onChange={e =>
                    setFormData(prev => ({ ...prev, lastname: e.target.value }))
                  }
                  disabled={!isEditing}
                  InputProps={{ readOnly: !isEditing }}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Email"
                  value={formData.email}
                  disabled
                  InputProps={{ readOnly: true }}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Teléfono"
                  value={formData.mobile}
                  onChange={e =>
                    setFormData(prev => ({ ...prev, mobile: e.target.value }))
                  }
                  disabled={!isEditing}
                  InputProps={{ readOnly: !isEditing }}
                />
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Dirección"
                  value={formData.address}
                  onChange={e =>
                    setFormData(prev => ({ ...prev, address: e.target.value }))
                  }
                  disabled={!isEditing}
                  InputProps={{ readOnly: !isEditing }}
                  inputProps={{ maxLength: 200 }}
                />
              </Grid>
            </Grid>
          </Paper>

          {/* Menú rápido */}
          <Paper
            elevation={0}
            sx={{
              p: 3,
              borderRadius: 3,
              border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
            }}
          >
            <Typography variant="h6" fontWeight={700} gutterBottom>
              Accesos Rápidos
            </Typography>

            <List>
              {menuItems.map(item => (
                <ListItem
                  key={item.label}
                  button
                  onClick={() => navigate(item.path)}
                  sx={{
                    borderRadius: 2,
                    mb: 1,
                    '&:hover': { bgcolor: alpha(colors.primary, 0.05) },
                  }}
                >
                  <ListItemIcon>
                    <item.icon sx={{ color: colors.primary }} />
                  </ListItemIcon>
                  <ListItemText primary={item.label} />
                </ListItem>
              ))}
            </List>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  )
}

export default Profile
