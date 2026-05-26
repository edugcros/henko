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

export const GOOGLE_FONTS = [
  { id: 'inter', name: 'Inter', family: 'Inter', value: '"Inter", sans-serif', category: 'Sans Serif', weights: '300;400;500;600;700' },
  { id: 'roboto', name: 'Roboto', family: 'Roboto', value: '"Roboto", sans-serif', category: 'Sans Serif', weights: '300;400;500;700' },
  { id: 'open-sans', name: 'Open Sans', family: 'Open Sans', value: '"Open Sans", sans-serif', category: 'Sans Serif', weights: '300;400;500;600;700' },
  { id: 'poppins', name: 'Poppins', family: 'Poppins', value: '"Poppins", sans-serif', category: 'Sans Serif', weights: '300;400;500;600;700' },
  { id: 'montserrat', name: 'Montserrat', family: 'Montserrat', value: '"Montserrat", sans-serif', category: 'Sans Serif', weights: '300;400;500;600;700' },
  { id: 'lato', name: 'Lato', family: 'Lato', value: '"Lato", sans-serif', category: 'Sans Serif', weights: '300;400;700' },
  { id: 'nunito', name: 'Nunito', family: 'Nunito', value: '"Nunito", sans-serif', category: 'Sans Serif', weights: '300;400;500;600;700' },
  { id: 'raleway', name: 'Raleway', family: 'Raleway', value: '"Raleway", sans-serif', category: 'Sans Serif', weights: '300;400;500;600;700' },
  { id: 'playfair-display', name: 'Playfair Display', family: 'Playfair Display', value: '"Playfair Display", serif', category: 'Serif', weights: '400;500;600;700' },
  { id: 'merriweather', name: 'Merriweather', family: 'Merriweather', value: '"Merriweather", serif', category: 'Serif', weights: '300;400;700' },
  { id: 'source-sans-pro', name: 'Source Sans Pro', family: 'Source Sans Pro', value: '"Source Sans Pro", sans-serif', category: 'Sans Serif', weights: '300;400;600;700' },
  { id: 'work-sans', name: 'Work Sans', family: 'Work Sans', value: '"Work Sans", sans-serif', category: 'Sans Serif', weights: '300;400;500;600;700' },
];

const FontSelector = ({ label, value, onChange }) => {
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
