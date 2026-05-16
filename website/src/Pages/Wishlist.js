// src/pages/Wishlist.jsx
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { getUserProductWishlist, toggleWishlist } from '@features/user/userSlice'
import Meta from '@components/Meta.js'
import BreadCrumb from '@components/BreadCrumb.js'
import Container from '@components/Container.js'
import {
  Card,
  CardMedia,
  CardContent,
  Typography,
  IconButton,
  Grid,
  Box,
  Snackbar,
  Alert,
  InputBase,
  Paper,
  Pagination,
  Stack,
  Skeleton,
  useTheme,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import VisibilityIcon from '@mui/icons-material/Visibility'
import SearchIcon from '@mui/icons-material/Search'
import ClearIcon from '@mui/icons-material/Clear'
import FavoriteIcon from '@mui/icons-material/Favorite'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import placeholder from '@assets/images/placeholder.png'

const ITEMS_PER_PAGE = 12
const DEBOUNCE_MS = 300

const Wishlist = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const theme = useTheme()

  // compatible: wishlist puede estar en varios lugares del state según tu slice
  const wishlistFromState = useSelector(state => state.user?.wishlist)
  const wishlistFromUser = useSelector(state => state.user?.user?.wishlist)
  const loadingGlobal = useSelector(state => state.user?.isLoading)
  const isAuthenticated = useSelector(state => state.user?.isAuthenticated)

  // preferimos el array más probable
  const wishlistSource = wishlistFromState || wishlistFromUser || []

  const [localWishlist, setLocalWishlist] = useState([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success',
  })
  const [removingId, setRemovingId] = useState(null)
  const [page, setPage] = useState(1)

  // Fetch wishlist on mount / auth change
  useEffect(() => {
    if (isAuthenticated) dispatch(getUserProductWishlist())
  }, [dispatch, isAuthenticated])

  // keep local copy in sync (for optimistic UI)
  useEffect(() => {
    setLocalWishlist(Array.isArray(wishlistSource) ? wishlistSource : [])
  }, [wishlistSource])

  // debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search])

  // client-side filtered array
  const filtered = useMemo(() => {
    if (!debouncedSearch) return localWishlist
    const q = debouncedSearch.toLowerCase()
    return localWishlist.filter(item => {
      const title = (item.title || '').toString().toLowerCase()
      const tags = (item.tags || []).join(' ').toLowerCase()
      const desc = (item.description || '').toString().toLowerCase()
      return title.includes(q) || tags.includes(q) || desc.includes(q)
    })
  }, [debouncedSearch, localWishlist])

  // pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  useEffect(() => {
    if (page > totalPages) setPage(1)
  }, [totalPages, page])

  const paginated = useMemo(() => {
    const start = (page - 1) * ITEMS_PER_PAGE
    return filtered.slice(start, start + ITEMS_PER_PAGE)
  }, [filtered, page])

  // optimistic toggle (remove) + server call
  const handleRemoveWishlist = useCallback(
    async productId => {
      try {
        setRemovingId(productId)
        // Optimistic: quitar localmente primero
        setLocalWishlist(prev => prev.filter(p => String(p._id) !== String(productId)))

        const result = await dispatch(toggleWishlist(productId)).unwrap()
        // result is expected to be the updated wishlist array (server)
        if (result && (Array.isArray(result) || result.data)) {
          // si el thunk retorna data o array, sincronizamos
          const serverWishlist = Array.isArray(result) ? result : result.data || result
          setLocalWishlist(serverWishlist)
          setSnackbar({
            open: true,
            message: 'Lista de deseos actualizada',
            severity: 'success',
          })
        } else {
          // fallback: mostrar mensaje y volver a solicitar
          setSnackbar({
            open: true,
            message: result?.message || 'Operación realizada',
            severity: 'info',
          })
          dispatch(getUserProductWishlist())
        }
      } catch (err) {
        // revertir si hubo fallo
        setSnackbar({
          open: true,
          message: err?.message || 'Error actualizando wishlist',
          severity: 'error',
        })
        dispatch(getUserProductWishlist())
      } finally {
        setRemovingId(null)
      }
    },
    [dispatch],
  )

  const handleViewProduct = id => navigate(`/product/${id}`)

  // Skeleton view while loading initial data
  const isLoading = loadingGlobal && (!Array.isArray(wishlistSource) || wishlistSource.length === 0)

  return (
    <>
      <Meta title="Productos Deseados" />
      <Container class1="wishlist-wrapper home-wrapper-2 py-5">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems="center"
          spacing={2}
          mb={3}
        >
          <Typography variant="h4" fontWeight={700}>
            Mi lista de deseos
          </Typography>

          <Paper
            component="form"
            onSubmit={e => {
              e.preventDefault()
              setDebouncedSearch(search.trim())
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              width: { xs: '100%', sm: 420 },
              px: 1,
              py: 0.25,
              borderRadius: 3,
              boxShadow: 1,
            }}
            elevation={0}
            aria-label="Buscar en wishlist"
          >
            <SearchIcon sx={{ ml: 0.5, mr: 1, color: 'text.secondary' }} />
            <InputBase
              placeholder="Buscar por título, etiqueta o descripción..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ flex: 1 }}
              inputProps={{ 'aria-label': 'buscar wishlist' }}
            />
            {search ? (
              <IconButton
                aria-label="clear search"
                onClick={() => {
                  setSearch('')
                  setDebouncedSearch('')
                }}
              >
                <ClearIcon />
              </IconButton>
            ) : null}
          </Paper>
        </Stack>

        {isLoading ? (
          <Grid container spacing={3}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Grid item xs={12} sm={6} md={4} key={i}>
                <Card sx={{ borderRadius: 3 }}>
                  <Skeleton variant="rectangular" height={220} />
                  <CardContent>
                    <Skeleton height={28} width="70%" />
                    <Skeleton height={20} width="50%" />
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : localWishlist.length === 0 ? (
          <Box textAlign="center" mt={6}>
            <Typography variant="h6">Tu lista de deseos está vacía</Typography>
            <Typography variant="body2" color="text.secondary" mt={1}>
              Agrega productos a tu lista para encontrarlos aquí.
            </Typography>
          </Box>
        ) : (
          <>
            <Grid container spacing={3}>
              {paginated.map(item => (
                <Grid item xs={12} sm={6} md={4} key={item._id}>
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.32 }}
                  >
                    <Card
                      sx={{
                        position: 'relative',
                        borderRadius: 3,
                        boxShadow: 3,
                        transition: 'transform 0.25s, box-shadow 0.25s',
                        '&:hover': {
                          transform: 'translateY(-6px)',
                          boxShadow: 6,
                        },
                        overflow: 'hidden',
                        minHeight: 320,
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      {/* Heart quick toggle (left top) */}
                      <Box
                        sx={{
                          position: 'absolute',
                          top: 12,
                          left: 12,
                          zIndex: 3,
                        }}
                      >
                        <IconButton
                          aria-label="quitar de wishlist"
                          onClick={() => handleRemoveWishlist(item._id)}
                          disabled={removingId === item._id}
                          sx={{
                            bgcolor: 'rgba(255,255,255,0.9)',
                            '&:hover': { bgcolor: 'rgba(255,255,255,1)' },
                            boxShadow: 1,
                          }}
                        >
                          <FavoriteIcon sx={{ color: theme.palette.error.main }} />
                        </IconButton>
                      </Box>

                      {/* Floating actions (right top) */}
                      <Box
                        sx={{
                          position: 'absolute',
                          top: 12,
                          right: 12,
                          display: 'flex',
                          gap: 1,
                          zIndex: 3,
                        }}
                        className="wishlist-actions"
                      >
                        <IconButton
                          aria-label="ver producto"
                          onClick={() => handleViewProduct(item._id)}
                          sx={{
                            bgcolor: 'rgba(255,255,255,0.9)',
                            '&:hover': { bgcolor: 'rgba(255,255,255,1)' },
                            boxShadow: 1,
                          }}
                        >
                          <VisibilityIcon />
                        </IconButton>
                      </Box>

                      {/* Image */}
                      <CardMedia
                        component="img"
                        image={item?.images?.[0]?.url || placeholder}
                        alt={item?.title || 'Product'}
                        sx={{
                          height: 220,
                          objectFit: 'cover',
                        }}
                      />

                      {/* Content */}
                      <CardContent sx={{ flex: '1 0 auto' }}>
                        <Typography variant="h6" noWrap title={item?.title}>
                          {item?.title || 'Sin título'}
                        </Typography>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            mt: 0.5,
                            height: 40,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {item?.description || 'Sin descripción'}
                        </Typography>
                        <Typography
                          variant="subtitle1"
                          color="primary"
                          sx={{ mt: 1, fontWeight: 700 }}
                        >
                          ${Number(item?.price || 0).toFixed(2)}
                        </Typography>
                      </CardContent>
                    </Card>
                  </motion.div>
                </Grid>
              ))}
            </Grid>

            {/* Pagination */}
            {totalPages > 1 && (
              <Box display="flex" justifyContent="center" mt={4}>
                <Pagination
                  count={totalPages}
                  page={page}
                  onChange={(_, p) => setPage(p)}
                  color="primary"
                />
              </Box>
            )}
          </>
        )}

        {/* Snackbar */}
        <Snackbar
          open={snackbar.open}
          autoHideDuration={3000}
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
            severity={snackbar.severity}
            sx={{ width: '100%' }}
          >
            {snackbar.message}
          </Alert>
        </Snackbar>
      </Container>
    </>
  )
}

export default Wishlist
