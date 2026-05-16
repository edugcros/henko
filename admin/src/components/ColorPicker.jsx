import React, { useState } from 'react'
import {
  Box,
  TextField,
  Typography,
  Paper,
  Popover,
  InputAdornment,
} from '@mui/material'
import { HexColorPicker } from 'react-colorful'

// ===============================
// Utils
// ===============================
const isValidHex = (hex) =>
  /^#([0-9A-F]{3}){1,2}$/i.test(hex)

// ===============================
// Component
// ===============================
const ColorPicker = ({
  label,
  value = '#000000',
  onChange,
  description,
}) => {
  const [anchorEl, setAnchorEl] = useState(null)
  const open = Boolean(anchorEl)

  const handleOpen = (e) => setAnchorEl(e.currentTarget)
  const handleClose = () => setAnchorEl(null)

  const handleInputChange = (e) => {
    const val = e.target.value
    if (val.length <= 7) {
      onChange(val)
    }
  }

  const handleBlur = () => {
    if (!isValidHex(value)) {
      onChange('#000000')
    }
  }

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* Header */}
      <Box mb={1}>
        <Typography variant="body2" fontWeight={600}>
          {label}
        </Typography>

        {description && (
          <Typography variant="caption" color="text.secondary">
            {description}
          </Typography>
        )}
      </Box>

      {/* Input + Preview */}
      <TextField
        fullWidth
        size="small"
        value={value}
        onChange={handleInputChange}
        onBlur={handleBlur}
        placeholder="#3B82F6"
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Box
                onClick={handleOpen}
                sx={{
                  width: 20,
                  height: 20,
                  borderRadius: 1,
                  backgroundColor: value,
                  border: '1px solid',
                  borderColor: 'divider',
                  cursor: 'pointer',
                }}
              />
            </InputAdornment>
          ),
        }}
        sx={{
          '& input': {
            fontFamily: 'monospace',
          },
        }}
      />

      {/* Popover (clean UX) */}
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
      >
        <Box p={2}>
          <HexColorPicker
            color={value}
            onChange={onChange}
            style={{ width: 220, height: 180 }}
          />

          <Box
            mt={1}
            textAlign="center"
            sx={{
              fontFamily: 'monospace',
              fontSize: 12,
              color: 'text.secondary',
            }}
          >
            {value.toUpperCase()}
          </Box>
        </Box>
      </Popover>
    </Paper>
  )
}

export default ColorPicker