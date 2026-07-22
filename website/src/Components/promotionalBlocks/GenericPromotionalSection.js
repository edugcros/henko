// 📁 src/components/promotionalBlocks/GenericPromotionalSection.jsx
import React from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  Container,
  Grid,
  Typography,
} from '@mui/material'
import { Link } from 'react-router-dom'

const getProduct = item => {
  if (!item) return null
  if (item.productId && typeof item.productId === 'object')
    return item.productId
  if (item.product && typeof item.product === 'object') return item.product
  return null
}

const formatPrice = value => {
  const amount = Number(value || 0)

  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount)
}

const GenericPromotionalSection = ({ block }) => {
  const products = Array.isArray(block?.products) ? block.products : []

  if (products.length === 0) return null

  return (
    <Box component="section" sx={{ py: { xs: 5, md: 6 } }}>
      <Container maxWidth="lg">
        <Box mb={4}>
          <Typography variant="h4" fontWeight={900}>
            {block.title}
          </Typography>

          {block.description && (
            <Typography color="text.secondary" mt={1}>
              {block.description}
            </Typography>
          )}
        </Box>

        <Grid container spacing={3}>
          {products.map(item => {
            const product = getProduct(item)

            if (!product) return null

            return (
              <Grid item xs={12} sm={6} md={3} key={product._id}>
                <Card
                  sx={{
                    height: '100%',
                    borderRadius: 3,
                    overflow: 'hidden',
                    transition: 'all .2s ease',
                    '&:hover': {
                      transform: 'translateY(-4px)',
                      boxShadow: 6,
                    },
                  }}
                >
                  <CardMedia
                    component="img"
                    height="220"
                    image={
                      product.images?.[0]?.url ||
                      '/assets/images/placeholder.png'
                    }
                    alt={product.title || 'Producto'}
                    sx={{
                      objectFit: 'cover',
                      bgcolor: 'grey.100',
                    }}
                  />

                  <CardContent>
                    <Typography fontWeight={800} noWrap>
                      {item.customTitle || product.title}
                    </Typography>

                    <Typography variant="body2" color="text.secondary" noWrap>
                      {product.categoria || product.category || ''}
                    </Typography>

                    <Typography color="primary" fontWeight={900} mt={1}>
                      {formatPrice(product.price)}
                    </Typography>

                    <Button
                      component={Link}
                      to={`/product/${product.slug || product._id}`}
                      fullWidth
                      variant="outlined"
                      sx={{ mt: 2 }}
                    >
                      Ver producto
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            )
          })}
        </Grid>
      </Container>
    </Box>
  )
}

export default GenericPromotionalSection
