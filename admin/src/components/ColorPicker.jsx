import React, { useEffect, useMemo, useState } from 'react'
import {
  Box,
  TextField,
  Typography,
  Paper,
  Popover,
  InputAdornment,
  IconButton,
  Tooltip,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { HexColorPicker } from 'react-colorful'
import { debounce } from 'lodash'

// ===============================
// Utils
// ===============================
const isValidHex = hex => /^#([0-9A-F]{3}){1,2}$/i.test(hex)

// ===============================
// Component
// ===============================
const ColorPicker = ({
  label,
  value = '#000000',
  onChange,
  description,
  helperText,
  showReset = false,
  onReset,
  size = 'small',
  sx,
}) => {
  const [anchorEl, setAnchorEl] = useState(null)
  const [draftValue, setDraftValue] = useState(value)
  const open = Boolean(anchorEl)

  const debouncedPickerCommit = useMemo(
    () =>
      debounce(color => {
        onChange(color)
      }, 120),
    [onChange],
  )

  useEffect(() => {
    setDraftValue(value)
  }, [value])

  useEffect(() => {
    return () => debouncedPickerCommit.cancel()
  }, [debouncedPickerCommit])

  const handleOpen = e => setAnchorEl(e.currentTarget)
  const handleClose = () => {
    debouncedPickerCommit.flush()
    setAnchorEl(null)
  }

  const handleInputChange = e => {
    const val = e.target.value
    if (val.length <= 7) {
      setDraftValue(val)
      if (isValidHex(val)) {
        onChange(val)
      }
    }
  }

  const handleBlur = () => {
    if (!isValidHex(draftValue)) {
      setDraftValue('#000000')
      onChange('#000000')
    }
  }

  const handlePickerChange = color => {
    setDraftValue(color)
    debouncedPickerCommit(color)
  }

  const helpText = description || helperText

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        ...sx,
      }}
    >
      {/* Header */}
      <Box mb={1}>
        <Typography variant="body2" fontWeight={600}>
          {label}
        </Typography>

        {helpText && (
          <Typography variant="caption" color="text.secondary">
            {helpText}
          </Typography>
        )}
      </Box>

      {/* Input + Preview */}
      <TextField
        fullWidth
        size={size}
        value={draftValue}
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
                  backgroundColor: isValidHex(draftValue)
                    ? draftValue
                    : '#000000',
                  border: '1px solid',
                  borderColor: 'divider',
                  cursor: 'pointer',
                }}
              />
            </InputAdornment>
          ),
          endAdornment:
            showReset && onReset ? (
              <InputAdornment position="end">
                <Tooltip title="Restaurar color">
                  <IconButton size="small" edge="end" onClick={onReset}>
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ) : null,
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
            color={isValidHex(draftValue) ? draftValue : '#000000'}
            onChange={handlePickerChange}
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
            {draftValue.toUpperCase()}
          </Box>
        </Box>
      </Popover>
    </Paper>
  )
}

export default ColorPicker
