import React, { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  getUsers,
  removeUser,
  toggleBlockUser,
  verifyUserManually,
} from '@features/customers/customerSlice'
import { toast } from 'react-toastify'

import {
  Alert,
  Avatar,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'

import DeleteIcon from '@mui/icons-material/Delete'
import BlockIcon from '@mui/icons-material/Block'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import FilterAltOffIcon from '@mui/icons-material/FilterAltOff'
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead'
import PersonIcon from '@mui/icons-material/Person'
import SearchIcon from '@mui/icons-material/Search'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  violet: '#7a2cff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

const HEAD_CELL_SX = {
  fontWeight: 700,
  color: BRAND.muted,
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  bgcolor: BRAND.paper,
  borderColor: BRAND.line,
}

const ROLE_LABELS = { user: 'Cliente', admin: 'Administrador' }

export const getRoleLabel = role => ROLE_LABELS[role] || role || 'Cliente'

// Sin mayúsculas ni acentos: quien busca «perez» tiene que encontrar a «Pérez».
export const normalizeText = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

export const matchesSearch = (user, search) => {
  const query = normalizeText(search)

  if (!query) return true

  return normalizeText(
    [
      user.firstname,
      user.lastname,
      `${user.firstname || ''} ${user.lastname || ''}`,
      user.email,
      user.mobile,
    ].join(' '),
  ).includes(query)
}

const STATUS_FILTERS = {
  all: () => true,
  active: user => !user.isBlocked,
  blocked: user => Boolean(user.isBlocked),
  unverified: user => !user.isEmailVerified,
}

export const filterCustomers = (customers, { status = 'all', search = '' } = {}) =>
  (customers || []).filter(
    user => (STATUS_FILTERS[status] || STATUS_FILTERS.all)(user) && matchesSearch(user, search),
  )

// Cada cifra del resumen es también un filtro rápido.
const SummaryTile = ({ title, value, color, onClick, active }) => (
  <ButtonBase
    onClick={onClick}
    aria-pressed={active}
    sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 0.25,
      width: '100%',
      height: '100%',
      p: 2,
      textAlign: 'left',
      borderBottom: active ? `3px solid ${color}` : '3px solid transparent',
      bgcolor: active ? BRAND.paper : 'transparent',
      '&:hover': { bgcolor: BRAND.paper },
    }}
  >
    <Typography
      component="span"
      variant="caption"
      sx={{ color: BRAND.muted, fontWeight: 700, letterSpacing: '0.04em' }}
    >
      {title}
    </Typography>
    <Typography
      component="span"
      sx={{
        fontFamily: DISPLAY_FONT,
        fontWeight: 800,
        fontSize: 28,
        lineHeight: 1.2,
        color,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </Typography>
  </ButtonBase>
)

const StatusChips = ({ user }) => (
  <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
    <Chip
      label={user.isBlocked ? 'Bloqueado' : 'Activo'}
      color={user.isBlocked ? 'error' : 'success'}
      size="small"
    />
    {!user.isEmailVerified && <Chip label="Sin verificar" color="warning" size="small" />}
  </Stack>
)

const CustomerActions = ({ user, onAction, disabled }) => (
  <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
    {!user.isEmailVerified && (
      <Tooltip title="Verificar manualmente">
        <span>
          <IconButton
            size="small"
            disabled={disabled}
            aria-label={`Verificar manualmente a ${user.firstname}`}
            onClick={() => onAction(user, 'verify')}
            sx={{ color: BRAND.blue }}
          >
            <MarkEmailReadIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    )}
    <Tooltip title={user.isBlocked ? 'Desbloquear' : 'Bloquear'}>
      <span>
        <IconButton
          size="small"
          disabled={disabled}
          aria-label={`${user.isBlocked ? 'Desbloquear' : 'Bloquear'} a ${user.firstname}`}
          onClick={() => onAction(user, user.isBlocked ? 'unblock' : 'block')}
          sx={{ color: user.isBlocked ? 'success.main' : 'warning.main' }}
        >
          {user.isBlocked ? <CheckCircleIcon fontSize="small" /> : <BlockIcon fontSize="small" />}
        </IconButton>
      </span>
    </Tooltip>
    <Tooltip title="Eliminar">
      <span>
        <IconButton
          size="small"
          color="error"
          disabled={disabled}
          aria-label={`Eliminar a ${user.firstname}`}
          onClick={() => onAction(user, 'delete')}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  </Stack>
)

const CustomerAvatar = ({ user }) => (
  <Avatar sx={{ bgcolor: user.isBlocked ? 'error.light' : BRAND.blue }}>
    <PersonIcon />
  </Avatar>
)

const DIALOG_TITLES = {
  delete: 'Eliminar cliente',
  block: 'Bloquear cliente',
  unblock: 'Desbloquear cliente',
  verify: 'Verificar cliente',
}

const Customers = () => {
  const dispatch = useDispatch()
  const { customers, isLoading, error } = useSelector(state => state.customers)
  const isNarrow = useMediaQuery('(max-width:600px)')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [actionType, setActionType] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

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
    if (!selectedUser || busy) return

    setBusy(true)

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
      setBusy(false)
      setConfirmOpen(false)
      setSelectedUser(null)
      setActionType('')
    }
  }

  const handleCancel = () => {
    if (busy) return

    setConfirmOpen(false)
    setSelectedUser(null)
    setActionType('')
  }

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('all')
  }

  const toggleStatusFilter = status =>
    setStatusFilter(current => (current === status ? 'all' : status))

  const totalUsers = customers?.length || 0
  const blockedUsers = customers?.filter(u => u.isBlocked).length || 0
  const unverifiedUsers = customers?.filter(u => !u.isEmailVerified).length || 0
  const activeUsers = totalUsers - blockedUsers

  const visibleCustomers = useMemo(
    () => filterCustomers(customers, { status: statusFilter, search }),
    [customers, statusFilter, search],
  )

  const hayFiltros = Boolean(search.trim()) || statusFilter !== 'all'
  const loadFailed = Boolean(error) && totalUsers === 0

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1280, mx: 'auto' }}>
      <Box component="header" sx={{ mb: 4 }}>
        <Typography
          variant="overline"
          sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          TU TIENDA
        </Typography>
        <Typography
          component="h1"
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 800,
            fontSize: { xs: 26, md: 34 },
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
          }}
        >
          Clientes
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Administra los usuarios registrados en tu tienda
        </Typography>
      </Box>

      <Paper
        component="section"
        aria-label="Resumen de clientes"
        variant="outlined"
        sx={{ ...PANEL_SX, mb: 3, overflow: 'hidden' }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          }}
        >
          <SummaryTile
            title="Total"
            value={totalUsers}
            color={BRAND.blue}
            onClick={clearFilters}
            active={!hayFiltros}
          />
          <SummaryTile
            title="Activos"
            value={activeUsers}
            color="#047857"
            onClick={() => toggleStatusFilter('active')}
            active={statusFilter === 'active'}
          />
          <SummaryTile
            title="Bloqueados"
            value={blockedUsers}
            color="#b42318"
            onClick={() => toggleStatusFilter('blocked')}
            active={statusFilter === 'blocked'}
          />
          <SummaryTile
            title="Sin verificar"
            value={unverifiedUsers}
            color="#9a5b00"
            onClick={() => toggleStatusFilter('unverified')}
            active={statusFilter === 'unverified'}
          />
        </Box>
      </Paper>

      {totalUsers > 0 && (
        <Paper variant="outlined" sx={{ ...PANEL_SX, mb: 3, p: 2 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { sm: 'center' } }}
          >
            <TextField
              fullWidth
              size="small"
              placeholder="Nombre, correo o teléfono..."
              value={search}
              onChange={event => setSearch(event.target.value)}
              sx={{ maxWidth: { sm: 460 } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon color="action" />
                    </InputAdornment>
                  ),
                },
                htmlInput: { 'aria-label': 'Buscar clientes' },
              }}
            />

            {hayFiltros && (
              <Button
                onClick={clearFilters}
                startIcon={<FilterAltOffIcon />}
                sx={{ textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
              >
                Limpiar filtros
              </Button>
            )}
          </Stack>
        </Paper>
      )}

      {isLoading && totalUsers > 0 && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

      {loadFailed && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={() => dispatch(getUsers())}>
              Reintentar
            </Button>
          }
        >
          {typeof error === 'string' ? error : 'No se pudo cargar la lista de clientes.'}
        </Alert>
      )}

      {isLoading && totalUsers === 0 ? (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '50vh',
          }}
        >
          <CircularProgress size={60} thickness={4} />
        </Box>
      ) : visibleCustomers.length > 0 ? (
        isNarrow ? (
          <Stack spacing={1.5}>
            {visibleCustomers.map(user => (
              <Paper
                key={user._id}
                component="article"
                variant="outlined"
                sx={{
                  ...PANEL_SX,
                  p: 2,
                  ...(user.isBlocked ? { borderColor: '#ef5350' } : null),
                }}
              >
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1.5 }}>
                  <CustomerAvatar user={user} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontWeight: 700 }}>
                      {user.firstname} {user.lastname}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {user.email}
                    </Typography>
                  </Box>
                </Stack>

                <Typography variant="body2" sx={{ mb: 1.5 }}>
                  {user.mobile || 'No registrado'}
                </Typography>

                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                >
                  <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    <Chip label={getRoleLabel(user.role)} size="small" variant="outlined" />
                    <StatusChips user={user} />
                  </Stack>
                  <CustomerActions user={user} onAction={handleActionClick} disabled={busy} />
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <TableContainer
            component={Paper}
            variant="outlined"
            sx={{ ...PANEL_SX, overflowX: 'auto' }}
          >
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={HEAD_CELL_SX}>Cliente</TableCell>
                  <TableCell sx={HEAD_CELL_SX}>Teléfono</TableCell>
                  <TableCell sx={HEAD_CELL_SX}>Rol</TableCell>
                  <TableCell sx={HEAD_CELL_SX}>Estado</TableCell>
                  <TableCell align="right" sx={HEAD_CELL_SX}>
                    Acciones
                  </TableCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {visibleCustomers.map(user => (
                  <TableRow
                    key={user._id}
                    hover
                    sx={user.isBlocked ? { bgcolor: '#fff8f7' } : undefined}
                  >
                    <TableCell>
                      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                        <CustomerAvatar user={user} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography noWrap sx={{ fontWeight: 600 }}>
                            {user.firstname} {user.lastname}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {user.email}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>{user.mobile || 'No registrado'}</TableCell>
                    <TableCell>
                      <Chip label={getRoleLabel(user.role)} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <StatusChips user={user} />
                    </TableCell>
                    <TableCell align="right">
                      <CustomerActions user={user} onAction={handleActionClick} disabled={busy} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      ) : (
        !loadFailed && (
          <Paper variant="outlined" sx={{ ...PANEL_SX, p: 6, textAlign: 'center' }}>
            <Typography
              component="h2"
              sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20, mb: 0.5 }}
            >
              {hayFiltros && totalUsers > 0
                ? 'Ningún cliente coincide con la búsqueda.'
                : 'No hay clientes registrados en tu comercio.'}
            </Typography>
            <Typography color="text.secondary">
              {hayFiltros && totalUsers > 0
                ? 'Probá con otro nombre o limpiá los filtros.'
                : 'Cuando alguien se registre en tu tienda, lo vas a ver acá.'}
            </Typography>
          </Paper>
        )
      )}

      {/* Confirm Dialog */}
      <Dialog open={confirmOpen} onClose={handleCancel} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          {DIALOG_TITLES[actionType] || 'Confirmar Acción'}
        </DialogTitle>
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
          <Button onClick={handleCancel} color="inherit" disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            color={actionType === 'delete' ? 'error' : 'primary'}
            disabled={busy}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
          >
            Confirmar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default Customers
