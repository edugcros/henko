import React from 'react';
import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  Box,
  Paper,
} from '@mui/material';
import { FontDownload } from '@mui/icons-material';

const GOOGLE_FONTS = [
  { name: 'Inter', value: '"Inter", sans-serif', category: 'Sans Serif' },
  { name: 'Roboto', value: '"Roboto", sans-serif', category: 'Sans Serif' },
  { name: 'Open Sans', value: '"Open Sans", sans-serif', category: 'Sans Serif' },
  { name: 'Poppins', value: '"Poppins", sans-serif', category: 'Sans Serif' },
  { name: 'Montserrat', value: '"Montserrat", sans-serif', category: 'Sans Serif' },
  { name: 'Lato', value: '"Lato", sans-serif', category: 'Sans Serif' },
  { name: 'Nunito', value: '"Nunito", sans-serif', category: 'Sans Serif' },
  { name: 'Raleway', value: '"Raleway", sans-serif', category: 'Sans Serif' },
  { name: 'Playfair Display', value: '"Playfair Display", serif', category: 'Serif' },
  { name: 'Merriweather', value: '"Merriweather", serif', category: 'Serif' },
  { name: 'Source Sans Pro', value: '"Source Sans Pro", sans-serif', category: 'Sans Serif' },
  { name: 'Work Sans', value: '"Work Sans", sans-serif', category: 'Sans Serif' },
];

const FontSelector = ({ label, value, onChange }) => {
  const selectedFont = GOOGLE_FONTS.find(f => f.value === value) || GOOGLE_FONTS[0];

  return (
    <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="subtitle2" gutterBottom fontWeight={600}>
        {label}
      </Typography>

      <FormControl fullWidth size="small">
        <InputLabel>Fuente</InputLabel>
        <Select
          value={value}
          label="Fuente"
          onChange={(e) => onChange(e.target.value)}
        >
          {GOOGLE_FONTS.map((font) => (
            <MenuItem key={font.value} value={font.value}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FontDownload fontSize="small" color="action" />
                <span style={{ fontFamily: font.value }}>{font.name}</span>
                <Typography 
                  component="span" 
                  variant="caption" 
                  color="text.secondary"
                  sx={{ ml: 'auto' }}
                >
                  {font.category}
                </Typography>
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Preview */}
      <Box 
        sx={{ 
          mt: 2, 
          p: 2, 
          backgroundColor: 'grey.50', 
          borderRadius: 1,
          border: '1px dashed',
          borderColor: 'divider'
        }}
      >
        <Typography 
          variant="body1" 
          sx={{ fontFamily: value }}
        >
          The quick brown fox jumps over the lazy dog
        </Typography>
        <Typography 
          variant="caption" 
          color="text.secondary"
          sx={{ fontFamily: value, display: 'block', mt: 0.5 }}
        >
          ABCDEFGHIJKLMNOPQRSTUVWXYZ 1234567890
        </Typography>
      </Box>
    </Paper>
  );
};

export default FontSelector;