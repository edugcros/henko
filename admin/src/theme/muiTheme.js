import { createTheme } from '@mui/material/styles';
import { Newprimary } from './colors';

// Tema base para el admin (no confundir con el tema de la tienda que editamos)
export const adminBaseTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main : Newprimary.darkBlueGray,
    },
    secondary: {
      main: '#dc004e',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
});

export default adminBaseTheme;