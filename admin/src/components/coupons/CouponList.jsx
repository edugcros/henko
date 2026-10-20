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
  useMediaQuery,
} from '@mui/material'

// Icons
import {
  MoreVert as MoreVertIcon,
  Edit as EditIcon,
  ContentCopy as CloneIcon,
  DeleteOutlined as DeleteIcon,
  DeleteForever as HardDeleteIcon,
  RestoreFromTrash as RestoreIcon,
  Layers as StackableIcon,
  InfoOutlined as InfoIcon,
} from '@mui/icons-material'

// ======================================================
// CONFIGURACIÓN Y UTILIDADES
// ======================================================

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
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
  return isNaN(date.getTime()) ? '-' : date.toLocaleDateString('es-AR')
}

// Pesos argentinos, sin centavos: un descuento de 10000 se lee «$ 10.000».
export const formatMoney = value =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0)

export const formatDiscount = coupon =>
  coupon.discountType === 'percentage'
    ? `${coupon.discountValue}%`
    : formatMoney(coupon.discountValue)

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

export const getStatus = coupon => {
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
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
          {count}
          {limit ? ` / ${limit}` : count === 1 ? ' uso' : ' usos'}
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
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 220 }}>
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
        <Typography
          variant="body2"
          sx={{ fontWeight: 700 }}
          noWrap
          title={getProductTitle(firstProduct)}
        >
          {getProductTitle(firstProduct)}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
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
      <IconButton
        onClick={handleOpen}
        size="small"
        aria-label={`Acciones del cupón ${coupon.code}`}
        aria-haspopup="menu"
      >
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

const CodeTag = ({ coupon }) => (
  <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1}>
    <Typography
      variant="body2"
      component="code"
      sx={{
        bgcolor: BRAND.paper,
        color: BRAND.ink,
        border: `1px solid ${BRAND.line}`,
        px: 1,
        py: 0.5,
        borderRadius: 2,
        fontWeight: 800,
        letterSpacing: 1,
      }}
    >
      {coupon.code}
    </Typography>
    {coupon.stackable && (
      <Tooltip title="Acumulable con otras promociones">
        <StackableIcon
          aria-label="Acumulable con otras promociones"
          sx={{ fontSize: 16, color: 'info.main' }}
        />
      </Tooltip>
    )}
  </Stack>
)

const CouponCard = ({ coupon, actions }) => {
  const status = STATUS_CONFIG[coupon.computedStatus]

  return (
    <Paper
      component="article"
      variant="outlined"
      sx={{ ...PANEL_SX, p: 2, opacity: coupon.isActive === false ? 0.75 : 1 }}
    >
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box sx={{ minWidth: 0 }}>
          <CodeTag coupon={coupon} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {coupon.description || 'Sin descripción'}
          </Typography>
        </Box>
        {actions}
      </Stack>

      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
        <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20 }}>
          {formatDiscount(coupon)}
        </Typography>
        {coupon.maxDiscountAmount && (
          <Typography variant="caption" color="text.secondary">
            Máx: {formatMoney(coupon.maxDiscountAmount)}
          </Typography>
        )}
        <Chip
          label={status.label}
          color={status.color}
          size="small"
          sx={{ fontWeight: 700, ml: 'auto' }}
        />
      </Stack>

      <Typography variant="caption" sx={{ display: 'block', mt: 1.5 }}>
        Desde: {formatDate(coupon.startDate)} · Hasta: {formatDate(coupon.endDate)}
      </Typography>

      <Box sx={{ mt: 1.5 }}>
        <UsageProgress count={coupon.usageCount || 0} limit={coupon.usageLimit} />
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <ProductSummary products={coupon.applicableProducts} />
      </Box>
    </Paper>
  )
}

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
  const isNarrow = useMediaQuery('(max-width:600px)')

  const processedCoupons = useMemo(() => {
    return coupons.map(coupon => ({
      ...coupon,
      id: coupon._id || coupon.id,
      computedStatus: getStatus(coupon),
    }))
  }, [coupons])

  const renderActions = coupon => (
    <ActionMenu
      coupon={coupon}
      onEdit={onEdit}
      onClone={onClone}
      onSoftDelete={onSoftDelete}
      onHardDelete={onHardDelete}
      onRestore={onRestore}
    />
  )

  if (!loading && processedCoupons.length === 0) {
    return (
      <Paper
        variant="outlined"
        sx={{ ...PANEL_SX, p: { xs: 4, md: 8 }, textAlign: 'center', borderStyle: 'dashed' }}
      >
        <Typography
          component="h2"
          sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20, mb: 0.5 }}
        >
          {showDeleted ? 'La papelera está vacía' : 'No se encontraron cupones'}
        </Typography>
        <Typography color="text.secondary">Intenta ajustar los filtros de búsqueda</Typography>
      </Paper>
    )
  }

  const footer = (
    <Stack
      direction="row"
      sx={{
        justifyContent: 'space-between',
        alignItems: 'center',
        p: 2,
        gap: 1,
        flexWrap: 'wrap',
        borderTop: isNarrow ? 'none' : `1px solid ${BRAND.line}`,
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
          siblingCount={isNarrow ? 0 : 1}
          getItemAriaLabel={(type, page, selected) => {
            if (type === 'page') {
              return selected ? `Página ${page}, actual` : `Ir a la página ${page}`
            }

            return {
              first: 'Ir a la primera página',
              last: 'Ir a la última página',
              next: 'Ir a la página siguiente',
              previous: 'Ir a la página anterior',
            }[type]
          }}
        />
      )}
    </Stack>
  )

  if (isNarrow) {
    return (
      <Box>
        <Stack spacing={1.5}>
          {processedCoupons.map(coupon => (
            <CouponCard key={coupon.id} coupon={coupon} actions={renderActions(coupon)} />
          ))}
        </Stack>
        {footer}
      </Box>
    )
  }

  return (
    <TableContainer
      component={Paper}
      variant="outlined"
      sx={{ ...PANEL_SX, overflowX: 'auto', overflowY: 'hidden' }}
    >
      <Table sx={{ minWidth: 900 }}>
        <TableHead>
          <TableRow>
            <TableCell sx={HEAD_CELL_SX}>Código</TableCell>
            <TableCell sx={HEAD_CELL_SX}>Descuento</TableCell>
            <TableCell sx={HEAD_CELL_SX}>Vigencia</TableCell>
            <TableCell sx={HEAD_CELL_SX}>Uso</TableCell>
            <TableCell sx={HEAD_CELL_SX}>Productos</TableCell>
            <TableCell sx={HEAD_CELL_SX}>Estado</TableCell>
            <TableCell align="right" sx={HEAD_CELL_SX}>
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
                  <CodeTag coupon={coupon} />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ display: 'block', maxWidth: 200, mt: 0.5 }}
                  >
                    {coupon.description || 'Sin descripción'}
                  </Typography>
                </TableCell>

                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>
                    {formatDiscount(coupon)}
                  </Typography>
                  {coupon.maxDiscountAmount && (
                    <Typography variant="caption" color="text.secondary">
                      Máx: {formatMoney(coupon.maxDiscountAmount)}
                    </Typography>
                  )}
                </TableCell>

                <TableCell>
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    Desde: {formatDate(coupon.startDate)}
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block' }}>
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
                    sx={{ fontWeight: 700, fontSize: '0.7rem' }}
                  />
                </TableCell>

                <TableCell align="right">{renderActions(coupon)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {footer}
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
