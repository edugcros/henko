import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Card,
  CardContent,
  CardMedia,
  Chip,
  AppBar,
  Toolbar,
  Container,
  Grid,
  Rating,
  Fab,
} from '@mui/material';
import { ShoppingCart, Favorite, Share } from '@mui/icons-material';
import { ThemeProvider } from '@mui/material/styles';
import { mapConfigToMuiTheme } from '@utils/themeMapper';
import { useMemo } from 'react';

const LivePreview = ({ themeData }) => {
    const muiTheme = useMemo(() => {
    return mapConfigToMuiTheme(themeData);
  }, [themeData]);

  return (
    <ThemeProvider theme={muiTheme}>
      <Paper 
        elevation={3} 
        sx={{ 
          height: '100%', 
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="h6" fontWeight={600}>
            Vista Previa en Tiempo Real
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Así se verá tu tienda con estos cambios
          </Typography>
        </Box>

        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {/* Mini Tienda Preview */}
          <Box sx={{ bgcolor: 'background.default', minHeight: '100%' }}>
            {/* Header */}
            <AppBar position="static" elevation={1}>
              <Toolbar>
                <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
                  Mi Tienda
                </Typography>
                <Button color="inherit">Inicio</Button>
                <Button color="inherit">Productos</Button>
                <Fab size="small" color="secondary" sx={{ ml: 2 }}>
                  <ShoppingCart />
                </Fab>
              </Toolbar>
            </AppBar>

            {/* Hero Section */}
            <Box sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', py: 6, textAlign: 'center' }}>
              <Container>
                <Typography variant="h2" gutterBottom>
                  Nueva Colección 2024
                </Typography>
                <Typography variant="h5" sx={{ mb: 3, opacity: 0.9 }}>
                  Descubre los mejores productos al mejor precio
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                  <Button 
                    variant="contained" 
                    color="secondary"
                    size="large"
                    sx={{ px: 4 }}
                  >
                    Comprar Ahora
                  </Button>
                  <Button 
                    variant="outlined" 
                    sx={{ 
                      borderColor: 'white', 
                      color: 'white',
                      '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' }
                    }}
                    size="large"
                  >
                    Ver Más
                  </Button>
                </Box>
              </Container>
            </Box>

            {/* Productos */}
            <Container sx={{ py: 4 }}>
              <Typography variant="h4" gutterBottom fontWeight={600}>
                Productos Destacados
              </Typography>
              
              <Grid container spacing={3}>
                {[1, 2, 3].map((item) => (
                  <Grid item xs={12} sm={6} md={4} key={item}>
                    <Card>
                      <CardMedia
                        component="div"
                        sx={{
                          height: 200,
                          bgcolor: 'grey.200',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Typography color="text.secondary">
                          Imagen Producto {item}
                        </Typography>
                      </CardMedia>
                      <CardContent>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                          <Typography variant="h6" component="div" fontWeight={600}>
                            Producto Premium {item}
                          </Typography>
                          <Chip 
                            label="Nuevo" 
                            color="secondary" 
                            size="small"
                          />
                        </Box>
                        
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          Descripción del producto con características destacadas y calidad premium.
                        </Typography>
                        
                        <Rating value={4.5} precision={0.5} size="small" readOnly sx={{ mb: 1 }} />
                        
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
                          <Typography variant="h6" color="primary" fontWeight={700}>
                            $99.00
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button 
                              variant="outlined" 
                              size="small"
                              startIcon={<Favorite />}
                            >
                              Fav
                            </Button>
                            <Button 
                              variant="contained" 
                              size="small"
                              startIcon={<ShoppingCart />}
                            >
                              Agregar
                            </Button>
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>

              {/* Estado Buttons */}
              <Box sx={{ mt: 4, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Button variant="contained" color="success" startIcon={<Share />}>
                  Éxito
                </Button>
                <Button variant="contained" color="error">
                  Error
                </Button>
                <Button variant="contained" color="warning">
                  Advertencia
                </Button>
                <Button variant="outlined" color="primary">
                  Outline Primario
                </Button>
              </Box>
            </Container>
          </Box>
        </Box>
      </Paper>
    </ThemeProvider>
  );
};

export default LivePreview;