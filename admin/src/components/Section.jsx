import React from 'react'
import { Paper, Typography, Box } from '@mui/material';

const Section = ({ title, subtitle, children }) => {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
      }}
    >
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Box>

      {children}
    </Paper>
  );
};

export default Section;