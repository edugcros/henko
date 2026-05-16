import React, { useMemo } from 'react'
import PropTypes from 'prop-types'
import ReactStars from 'react-stars'
import { useNavigate } from 'react-router-dom'
import { Card, CardMedia, CardContent, Typography, Box, alpha, Skeleton } from '@mui/material'
import { useSelector } from 'react-redux'

/**
 * HomeProductCard Optimizado
 * - Utiliza MUI para consistencia visual.
 * - Soporta colores dinámicos del Tenant.
 * - Optimizado con React.memo para listas largas.
 */
const HomeProductCard = React.memo(({ data }) => {
  const navigate = useNavigate()

  // Acceso a los colores dinámicos del tenant para el precio o bordes
  const themeColors = useSelector(state => state.theme?.config?.colors || {})
  const primaryColor = themeColors.primary || '#1976d2'

  // Extraemos el primer item con seguridad
  const item = useMemo(() => (Array.isArray(data) ? data[0] : data), [data])

  if (!item) return null

  const imageUrl = item?.images?.[0]?.url || '/assets/images/placeholder.png'
  const slug = item?.slug || item?._id
  const handleCardClick = () => {
    navigate(`/product/${item._id}`) // 👈 Forzamos el uso del _id
  }

  return (
    <Card
      onClick={handleCardClick}
      sx={{
        width: '100%',
        maxWidth: 260,
        borderRadius: 4, // 16px
        overflow: 'hidden',
        margin: '0 auto',
        backgroundColor: 'background.paper',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        transition: 'transform 0.3s ease, box-shadow 0.3s ease',
        cursor: 'pointer',
        '&:hover': {
          transform: 'translateY(-5px)',
          boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
        },
      }}
    >
      {/* Contenedor de Imagen */}
      <Box sx={{ position: 'relative', pt: '100%', bgcolor: '#fafafa' }}>
        <CardMedia
          component="img"
          image={imageUrl}
          alt={item.title}
          sx={{
            position: 'absolute',
            top: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain', // Mejor que cover para productos
            p: 1,
          }}
        />
      </Box>

      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        {/* Marca */}
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            textTransform: 'uppercase',
            letterSpacing: 1,
            fontWeight: 600,
          }}
        >
          {item.brand || 'General'}
        </Typography>

        {/* Título - Limitado a 2 líneas para no romper el diseño */}
        <Typography
          variant="subtitle1"
          sx={{
            mt: 0.5,
            mb: 1,
            fontWeight: 600,
            fontSize: '1rem',
            lineHeight: 1.2,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: '2.4em', // Mantiene altura constante
          }}
        >
          {item.title}
        </Typography>

        {/* Rating */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <ReactStars
            count={5}
            size={18}
            value={Number(item.totalrating) || 0}
            edit={false}
            color2={primaryColor} // El color de las estrellas puede ser el primario
          />
        </Box>

        {/* Precio */}
        <Typography
          variant="h6"
          sx={{
            fontWeight: 800,
            color: primaryColor,
            fontSize: '1.15rem',
          }}
        >
          {new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency: 'CLP',
          }).format(item.price || 0)}
        </Typography>
      </CardContent>
    </Card>
  )
})

HomeProductCard.displayName = 'HomeProductCard'

HomeProductCard.propTypes = {
  data: PropTypes.oneOfType([PropTypes.array, PropTypes.object]).isRequired,
}

export default HomeProductCard
