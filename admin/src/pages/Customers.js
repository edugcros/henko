import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  getUsers,
  removeUser,
  toggleBlockUser,
  verifyUserManually,
} from '@features/customers/customerSlice'
import { toast } from 'react-toastify'

import {
  Box,
  Typography,
  Stack,
  Card,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Grid,
  Fade,
  Avatar,
  Divider,
} from '@mui/material'

import DeleteIcon from '@mui/icons-material/Delete'
import BlockIcon from '@mui/icons-material/Block'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead'
import PersonIcon from '@mui/icons-material/Person'
import PhoneIcon from '@mui/icons-material/Phone'

const Customers = () => {
  const dispatch = useDispatch()
  const { customers, isLoading, error } = useSelector(state => state.customers)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [actionType, setActionType] = useState('')

  // 1. Carga inicial de datos específicos del Tenant (vía dominio)
  useEffect(() => {
    dispatch(getUsers())
  }, [dispatch])

  const handleActionClick = (user, type) => {
    setSelectedUser(user)
    setActionType(type)
    setConfirmOpen(true)
  }

  const handleConfirm = async () => {
    if (!selectedUser) return

    try {
      if (actionType === 'delete') {
        await dispatch(removeUser(selectedUser._id)).unwrap()
      } else if (actionType === 'block') {
        await dispatch(toggleBlockUser({ id: selectedUser._id, block: true })).unwrap()
      } else if (actionType === 'unblock') {
        await dispatch(toggleBlockUser({ id: selectedUser._id, block: false })).unwrap()
      } else if (actionType === 'verify') {
        await dispatch(verifyUserManually(selectedUser._id)).unwrap()
        toast.success(`${selectedUser.email} verificado correctamente.`)
      }
    } catch (err) {
      console.error('Error ejecutando acción:', err)
      // Las 3 ramas restantes (delete/block/unblock) solo logueaban a
      // consola y cerraban el modal como si nada — el operador nunca se
      // enteraba de que la acción había fallado.
      const fallbackByAction = {
        delete: 'No se pudo eliminar al cliente.',
        block: 'No se pudo bloquear al cliente.',
        unblock: 'No se pudo desbloquear al cliente.',
        verify: 'No se pudo verificar al usuario.',
      }
      toast.error(err || fallbackByAction[actionType] || 'No se pudo completar la acción.')
    } finally {
      setConfirmOpen(false)
      setSelectedUser(null)
      setActionType('')
    }
  }

  const handleCancel = () => {
    setConfirmOpen(false)
    setSelectedUser(null)
    setActionType('')
  }

  const totalUsers = customers?.length || 0
  const blockedUsers = customers?.filter(u => u.isBlocked).length || 0

  return (
    <Box p={{ xs: 2, md: 4 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={4}>
        <Box>
          <Typography variant="h4" fontWeight={700} color="primary.main">
            Gestión de Clientes
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Administra los usuarios registrados en tu tienda
          </Typography>
        </Box>

        <Stack direction="row" spacing={2}>
          <Chip
            label={`Total: ${totalUsers}`}
            variant="outlined"
            sx={{
              fontWeight: 'bold',
              bgcolor: 'primary.light',
              color: 'primary.contrastText',
            }}
          />
          <Chip label={`Bloqueados: ${blockedUsers}`} color="error" sx={{ fontWeight: 'bold' }} />
        </Stack>
      </Stack>

      {isLoading && customers.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
          <CircularProgress size={60} thickness={4} />
        </Box>
      ) : (
        <Grid container spacing={3}>
          {customers.map(user => (
            <Grid xs={12} sm={6} lg={4} key={user._id}>
              <Fade in={true} timeout={500}>
                <Card
                  elevation={3}
                  sx={{
                    borderRadius: 3,
                    transition: '0.3s',
                    '&:hover': { transform: 'translateY(-5px)', boxShadow: 6 },
                    border: user.isBlocked ? '1px solid #ef5350' : 'none',
                  }}
                >
                  <Box p={3}>
                    <Stack direction="row" spacing={2} alignItems="center" mb={2}>
                      <Avatar
                        sx={{
                          bgcolor: user.isBlocked ? 'error.light' : 'primary.main',
                        }}
                      >
                        <PersonIcon />
                      </Avatar>
                      <Box overflow="hidden">
                        <Typography variant="h6" noWrap fontWeight={600}>
                          {user.firstname} {user.lastname}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {user.email}
                        </Typography>
                      </Box>
                    </Stack>

                    <Divider sx={{ my: 1.5 }} />

                    <Stack spacing={1} mb={2}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <PhoneIcon fontSize="small" color="action" />
                        <Typography variant="body2">{user.mobile || 'No registrado'}</Typography>
                      </Stack>
                      <Stack direction="row" spacing={1}>
                        <Chip label={user.role} size="small" variant="outlined" />
                        <Chip
                          label={user.isBlocked ? 'BLOQUEADO' : 'ACTIVO'}
                          color={user.isBlocked ? 'error' : 'success'}
                          size="small"
                        />
                        {!user.isEmailVerified && (
                          <Chip label="SIN VERIFICAR" color="warning" size="small" />
                        )}
                      </Stack>
                    </Stack>

                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      {!user.isEmailVerified && (
                        <Tooltip title="Verificar manualmente">
                          <IconButton
                            size="small"
                            onClick={() => handleActionClick(user, 'verify')}
                            sx={{
                              bgcolor: 'info.light',
                              color: 'white',
                              '&:hover': { opacity: 0.8 },
                            }}
                          >
                            <MarkEmailReadIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title={user.isBlocked ? 'Desbloquear' : 'Bloquear'}>
                        <IconButton
                          size="small"
                          onClick={() =>
                            handleActionClick(user, user.isBlocked ? 'unblock' : 'block')
                          }
                          sx={{
                            bgcolor: user.isBlocked ? 'success.light' : 'warning.light',
                            '&:hover': { opacity: 0.8 },
                          }}
                        >
                          {user.isBlocked ? (
                            <CheckCircleIcon fontSize="small" />
                          ) : (
                            <BlockIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Eliminar">
                        <IconButton
                          size="small"
                          onClick={() => handleActionClick(user, 'delete')}
                          sx={{
                            bgcolor: 'error.light',
                            color: 'white',
                            '&:hover': { opacity: 0.8 },
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Box>
                </Card>
              </Fade>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Empty State */}
      {!isLoading && customers.length === 0 && (
        <Box textAlign="center" py={10}>
          <Typography variant="h6" color="text.secondary">
            No hay clientes registrados en tu comercio.
          </Typography>
        </Box>
      )}

      {/* Confirm Dialog */}
      <Dialog open={confirmOpen} onClose={handleCancel} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 'bold' }}>Confirmar Acción</DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            {actionType === 'delete' &&
              `¿Estás seguro de eliminar permanentemente a ${selectedUser?.firstname}?`}
            {actionType === 'block' && `¿Deseas restringir el acceso a ${selectedUser?.firstname}?`}
            {actionType === 'unblock' &&
              `¿Deseas restaurar el acceso a ${selectedUser?.firstname}?`}
            {actionType === 'verify' &&
              `¿Confirmás que verificaste por otro medio que ${selectedUser?.email} es una casilla real de ${selectedUser?.firstname}? Esta acción marca su cuenta como verificada sin pasar por el correo de confirmación.`}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleCancel} color="inherit">
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            color={actionType === 'delete' ? 'error' : 'primary'}
          >
            Confirmar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default Customers
