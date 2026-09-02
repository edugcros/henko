import React, { useMemo, useState } from 'react'
import PropTypes from 'prop-types'

// Material UI Components
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Chip,
  Box,
  Avatar,
  AvatarGroup,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  LinearProgress,
  Tooltip,
  Divider,
  Pagination,
  Stack,
  alpha,
  useTheme,
} from '@mui/material'

// Icons
import {
  MoreVert as MoreVertIcon,
  Edit as EditIcon,
  ContentCopy as CloneIcon,
  DeleteOutline as DeleteIcon,
  DeleteForever as HardDeleteIcon,
  RestoreFromTrash as RestoreIcon,
  Layers as StackableIcon,
  InfoOutlined as InfoIcon,
} from '@mui/icons-material'

// ======================================================
// CONFIGURACIÓN Y UTILIDADES
// ======================================================

const STATUS_CONFIG = {
  active: { label: 'Activo', color: 'success' },
  inactive: { label: 'Inactivo', color: 'default' },
  scheduled: { label: 'Programado', color: 'info' },
  expired: { label: 'Expirado', color: 'warning' },
  exhausted: { label: 'Agotado', color: 'error' },
  deleted: { label: 'Eliminado', color: 'error' },
}

const formatDate = dateString => {
  if (!dateString) return '-'
  const date = new Date(dateString)
  return isNaN(date.getTime()) ? '-' : date.toLocaleDateString('es-ES')
}

const PLACEHOLDER_IMAGE = '/placeholder-product.png'

const getImageBaseUrl = () => {
  const rawBaseUrl = process.env.REACT_APP_API_BASE_URL || process.env.REACT_APP_API_URL || ''

  return rawBaseUrl.replace(/\/api\/?$/, '').replace(/\/$/, '')
}

const getProductId = product => {
  if (!product || typeof product !== 'object') return String(product || '')
  return product.id || product._id || product.productId || product.sku || ''
}

const getProductTitle = product => {
  if (!product || typeof product !== 'object') return 'Producto'
  return product.title || product.name || product.sku || 'Producto sin nombre'
}

const getProductImage = product => {
  if (!product || typeof product !== 'object') return PLACEHOLDER_IMAGE

  const image = product.images?.[0] || product.image || null
  const url =
    typeof image === 'string' ? image : image?.url || image?.secure_url || image?.src || ''

  if (!url) return PLACEHOLDER_IMAGE
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url
  if (url.startsWith('/')) return `${getImageBaseUrl()}${url}`
  return `${getImageBaseUrl()}/${url}`
}

const getStatus = coupon => {
  const now = new Date()
  const start = coupon.startDate ? new Date(coupon.startDate) : null
  const end = coupon.endDate ? new Date(coupon.endDate) : null

  if (coupon.isDeleted) return 'deleted'
  if (!coupon.isActive) return 'inactive'
  if (start && now < start) return 'scheduled'
  if (end && now > end) return 'expired'
  if (coupon.usageLimit && (coupon.usageCount || 0) >= coupon.usageLimit) return 'exhausted'
  return 'active'
}

// ======================================================
// SUB-COMPONENTES
// ======================================================

const UsageProgress = ({ count, limit }) => {
  const percentage = limit > 0 ? Math.min((count / limit) * 100, 100) : count > 0 ? 100 : 0
  const color = percentage >= 100 ? 'error' : percentage >= 80 ? 'warning' : 'primary'

  return (
    <Box sx={{ minWidth: 120 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Typography variant="caption" fontWeight="bold">
          {count}
          {limit ? ` / ${limit}` : ' usos'}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={percentage}
        color={color}
        sx={{
          height: 6,
          borderRadius: 3,
          bgcolor: theme => alpha(theme.palette.divider, 0.1),
        }}
      />
    </Box>
  )
}

const ProductSummary = ({ products = [] }) => {
  const visibleProducts = Array.isArray(products) ? products.filter(Boolean) : []

  if (!visibleProducts.length) {
    return <Chip label="Todos los productos" size="small" variant="outlined" color="primary" />
  }

  const firstProduct = visibleProducts[0]
  const extraCount = visibleProducts.length - 1

  return (
    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 220 }}>
      <AvatarGroup
        max={3}
        sx={{
          '& .MuiAvatar-root': {
            width: 34,
            height: 34,
            fontSize: 12,
            borderColor: 'background.paper',
          },
        }}
      >
        {visibleProducts.slice(0, 3).map((product, index) => (
          <Avatar
            key={getProductId(product) || index}
            alt={getProductTitle(product)}
            src={getProductImage(product)}
            imgProps={{
              onError: event => {
                event.currentTarget.onerror = null
                event.currentTarget.src = PLACEHOLDER_IMAGE
              },
            }}
          >
            {getProductTitle(product).slice(0, 1)}
          </Avatar>
        ))}
      </AvatarGroup>

      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={700} noWrap title={getProductTitle(firstProduct)}>
          {getProductTitle(firstProduct)}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap display="block">
          {extraCount > 0
            ? `+${extraCount} producto${extraCount === 1 ? '' : 's'} más`
            : firstProduct?.sku || 'Producto asignado'}
        </Typography>
      </Box>
    </Stack>
  )
}

const ActionMenu = ({ coupon, onEdit, onClone, onSoftDelete, onHardDelete, onRestore }) => {
  const [anchorEl, setAnchorEl] = useState(null)
  const open = Boolean(anchorEl)
  const isDeleted = coupon.isDeleted === true
  const hasUsage = (coupon.usageCount || 0) > 0

  const handleOpen = e => setAnchorEl(e.currentTarget)
  const handleClose = () => setAnchorEl(null)

  const handleAction = callback => {
    handleClose()
    callback(coupon)
  }

  return (
    <>
      <IconButton onClick={handleOpen} size="small">
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        {!isDeleted ? (
          <>
            <MenuItem onClick={() => handleAction(onEdit)}>
              <ListItemIcon>
                <EditIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText>Editar</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => handleAction(onClone)}>
              <ListItemIcon>
                <CloneIcon fontSize="small" color="info" />
              </ListItemIcon>
              <ListItemText>Clonar</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => handleAction(onSoftDelete)}>
              <ListItemIcon>
                <DeleteIcon fontSize="small" color="error" />
              </ListItemIcon>
              <ListItemText sx={{ color: 'error.main' }}>Eliminar</ListItemText>
            </MenuItem>
          </>
        ) : (
          <>
            <MenuItem onClick={() => handleAction(onRestore)}>
              <ListItemIcon>
                <RestoreIcon fontSize="small" color="success" />
              </ListItemIcon>
              <ListItemText sx={{ color: 'success.main' }}>Restaurar</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => handleAction(onHardDelete)} disabled={hasUsage}>
              <ListItemIcon>
                <HardDeleteIcon fontSize="small" color="error" />
              </ListItemIcon>
              <ListItemText sx={{ color: 'error.main' }}>Eliminar Permanente</ListItemText>
            </MenuItem>
          </>
        )}
      </Menu>
    </>
  )
}

// ======================================================
// COMPONENTE PRINCIPAL
// ======================================================

const CouponList = ({
  coupons = [],
  loading = false,
  onEdit,
  onSoftDelete,
  onHardDelete,
  onRestore,
  onClone,
  showDeleted = false,
  pagination = { total: 0, page: 1, pages: 1 },
  onPageChange,
}) => {
  const theme = useTheme()

  const processedCoupons = useMemo(() => {
    return coupons.map(coupon => ({
      ...coupon,
      id: coupon._id || coupon.id,
      computedStatus: getStatus(coupon),
    }))
  }, [coupons])

  if (!loading && processedCoupons.length === 0) {
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 10,
          textAlign: 'center',
          borderRadius: 4,
          borderStyle: 'dashed',
        }}
      >
        <Typography variant="h6" color="text.secondary" gutterBottom>
          {showDeleted ? 'La papelera está vacía' : 'No se encontraron cupones'}
        </Typography>
        <Typography variant="body2" color="text.disabled">
          Intenta ajustar los filtros de búsqueda
        </Typography>
      </Paper>
    )
  }

  return (
    <TableContainer
      component={Paper}
      elevation={0}
      sx={{
        borderRadius: 4,
        border: '1px solid',
        borderColor: 'divider',
        overflow: 'hidden',
      }}
    >
      <Table sx={{ minWidth: 900 }}>
        <TableHead sx={{ bgcolor: alpha(theme.palette.primary.main, 0.03) }}>
          <TableRow>
            <TableCell sx={{ fontWeight: 'bold' }}>Código</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Descuento</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Vigencia</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Uso</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Productos</TableCell>
            <TableCell sx={{ fontWeight: 'bold' }}>Estado</TableCell>
            <TableCell align="right" sx={{ fontWeight: 'bold' }}>
              Acciones
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {processedCoupons.map(coupon => {
            const status = STATUS_CONFIG[coupon.computedStatus]
            return (
              <TableRow
                key={coupon.id}
                hover
                sx={{
                  '&:last-child td, &:last-child th': { border: 0 },
                  opacity: coupon.isActive === false ? 0.7 : 1,
                }}
              >
                <TableCell>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography
                      variant="body2"
                      component="code"
                      sx={{
                        bgcolor: 'action.hover',
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        fontWeight: 'bold',
                        letterSpacing: 1,
                      }}
                    >
                      {coupon.code}
                    </Typography>
                    {coupon.stackable && (
                      <Tooltip title="Acumulable con otras promociones">
                        <StackableIcon sx={{ fontSize: 16, color: 'info.main' }} />
                      </Tooltip>
                    )}
                  </Stack>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    noWrap
                    sx={{ maxWidth: 200, mt: 0.5 }}
                  >
                    {coupon.description || 'Sin descripción'}
                  </Typography>
                </TableCell>

                <TableCell>
                  <Typography variant="body2" fontWeight="bold">
                    {coupon.discountType === 'percentage'
                      ? `${coupon.discountValue}%`
                      : `$${coupon.discountValue}`}
                  </Typography>
                  {coupon.maxDiscountAmount && (
                    <Typography variant="caption" color="text.secondary">
                      Max: ${coupon.maxDiscountAmount}
                    </Typography>
                  )}
                </TableCell>

                <TableCell>
                  <Typography variant="caption" display="block">
                    Desde: {formatDate(coupon.startDate)}
                  </Typography>
                  <Typography variant="caption" display="block">
                    Hasta: {formatDate(coupon.endDate)}
                  </Typography>
                </TableCell>

                <TableCell>
                  <UsageProgress count={coupon.usageCount || 0} limit={coupon.usageLimit} />
                </TableCell>

                <TableCell>
                  <ProductSummary products={coupon.applicableProducts} />
                </TableCell>

                <TableCell>
                  <Chip
                    label={status.label}
                    color={status.color}
                    size="small"
                    sx={{ fontWeight: 'bold', fontSize: '0.7rem' }}
                  />
                </TableCell>

                <TableCell align="right">
                  <ActionMenu
                    coupon={coupon}
                    onEdit={onEdit}
                    onClone={onClone}
                    onSoftDelete={onSoftDelete}
                    onHardDelete={onHardDelete}
                    onRestore={onRestore}
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {/* Footer / Pagination */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{
          p: 2,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: alpha(theme.palette.background.paper, 0.5),
        }}
      >
        <Typography variant="caption" color="text.secondary">
          Total: <strong>{pagination.total}</strong> cupones encontrados
        </Typography>
        {pagination.pages > 1 && (
          <Pagination
            count={pagination.pages}
            page={pagination.page}
            onChange={(e, val) => onPageChange(val)}
            color="primary"
            size="small"
            shape="rounded"
          />
        )}
      </Stack>
    </TableContainer>
  )
}

CouponList.propTypes = {
  coupons: PropTypes.array,
  loading: PropTypes.bool,
  onEdit: PropTypes.func,
  onSoftDelete: PropTypes.func,
  onHardDelete: PropTypes.func,
  onRestore: PropTypes.func,
  onClone: PropTypes.func,
  showDeleted: PropTypes.bool,
  pagination: PropTypes.object,
  onPageChange: PropTypes.func,
}

export default React.memo(CouponList)
