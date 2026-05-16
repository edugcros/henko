import React from 'react';
import {
  Box,
  Typography,
  TextField,
  Paper,
  Grid,
  Switch,
  FormControlLabel,
} from '@mui/material';
import ImageUploader from './ImageUploader';

const SOCIAL_PLATFORMS = [
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/...' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/...' },
  { key: 'twitter', label: 'Twitter', placeholder: 'https://twitter.com/...' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/...' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@...' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/...' },
];

const FooterEditor = ({ value, onChange }) => {
  const footer = value || {};
  const social = footer.social || {};

  const handleChange = (field, newValue) => {
    onChange({ ...footer, [field]: newValue });
  };

  const handleSocialChange = (platform, newValue) => {
    onChange({
      ...footer,
      social: { ...social, [platform]: newValue },
    });
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>Configuración del Footer</Typography>
      
      {/* Logo y Descripción */}
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Typography variant="subtitle2" gutterBottom>Logo del Footer</Typography>
          <ImageUploader
            value={footer.logo}
            onChange={(img) => handleChange('logo', img)}
            label="Logo Footer"
          />
        </Grid>
        
        <Grid item xs={12}>
          <TextField
            fullWidth
            multiline
            rows={2}
            label="Descripción"
            value={footer.description || ''}
            onChange={(e) => handleChange('description', e.target.value)}
          />
        </Grid>
        
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Email de Contacto"
            value={footer.email || ''}
            onChange={(e) => handleChange('email', e.target.value)}
          />
        </Grid>
        
        <Grid item xs={12} sm={6}>
          <TextField
            fullWidth
            label="Teléfono"
            value={footer.phone || ''}
            onChange={(e) => handleChange('phone', e.target.value)}
          />
        </Grid>
      </Grid>

      {/* Newsletter */}
      <Box sx={{ mt: 3 }}>
        <FormControlLabel
          control={
            <Switch
              checked={footer.showNewsletter !== false}
              onChange={(e) => handleChange('showNewsletter', e.target.checked)}
            />
          }
          label="Mostrar Newsletter"
        />
        
        {footer.showNewsletter !== false && (
          <TextField
            fullWidth
            sx={{ mt: 1 }}
            label="Texto del Newsletter"
            value={footer.newsletterText || ''}
            onChange={(e) => handleChange('newsletterText', e.target.value)}
          />
        )}
      </Box>

      {/* Redes Sociales */}
      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle2" gutterBottom>Redes Sociales</Typography>
        <Grid container spacing={2}>
          {SOCIAL_PLATFORMS.map(({ key, label, placeholder }) => (
            <Grid item xs={12} sm={6} key={key}>
              <TextField
                fullWidth
                size="small"
                label={label}
                placeholder={placeholder}
                value={social[key] || ''}
                onChange={(e) => handleSocialChange(key, e.target.value)}
              />
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* Columnas */}
      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle2" gutterBottom>
          Número de Columnas: {footer.columns || 4}
        </Typography>
        <TextField
          type="number"
          inputProps={{ min: 1, max: 6 }}
          value={footer.columns || 4}
          onChange={(e) => handleChange('columns', Number(e.target.value))}
          size="small"
        />
      </Box>
    </Paper>
  );
};

export default FooterEditor;