import React, { useEffect, useMemo, useState } from 'react'
import {
  Box,
  ButtonBase,
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
export const isValidHex = hex => /^#([0-9A-F]{3}){1,2}$/i.test(hex)

// ===============================
// Component
// ===============================
//
// `compact` lo muestra en una sola fila (muestra, nombre, hex, restaurar), para
// listas largas como el editor de colores. Sin `compact`, la tarjeta de siempre.
const ColorPicker = ({
  label,
  value = '#000000',
  onChange,
  description,
  helperText,
  showReset = false,
  onReset,
  size = 'small',
  compact = false,
  // Para el nombre accesible cuando el mismo nombre se repite en varios grupos
  // ("Fondo" del header, de las cards, del pie).
  context,
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

  // Un hex a medio escribir al salir del campo vuelve al último color válido.
  // Antes lo reemplazaba por negro y lo guardaba.
  const handleBlur = () => {
    if (!isValidHex(draftValue)) setDraftValue(value)
  }

  const handlePickerChange = color => {
    setDraftValue(color)
    debouncedPickerCommit(color)
  }

  const helpText = description || helperText
  const a11yName = context ? `${label} · ${context}` : label
  const shown = isValidHex(draftValue) ? draftValue : value

  const swatch = (
    <ButtonBase
      onClick={handleOpen}
      aria-label={`Elegir color: ${a11yName}`}
      sx={{
        width: compact ? 32 : 20,
        height: compact ? 32 : 20,
        flexShrink: 0,
        borderRadius: compact ? 1.5 : 1,
        backgroundColor: shown,
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35)',
      }}
    />
  )

  const resetButton =
    showReset && onReset ? (
      <Tooltip title="Restaurar color">
        <IconButton
          size="small"
          edge="end"
          onClick={onReset}
          aria-label={`Restaurar color: ${a11yName}`}
        >
          <RefreshIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    ) : null

  const hexInput = (
    <TextField
      fullWidth={!compact}
      size={size}
      value={draftValue}
      onChange={handleInputChange}
      onBlur={handleBlur}
      placeholder="#3B82F6"
      slotProps={{
        htmlInput: { 'aria-label': `Código hex: ${a11yName}`, spellCheck: false },
        input: {
          startAdornment: compact ? null : (
            <InputAdornment position="start">{swatch}</InputAdornment>
          ),
          endAdornment:
            !compact && resetButton ? (
              <InputAdornment position="end">{resetButton}</InputAdornment>
            ) : null,
        },
      }}
      sx={{
        ...(compact ? { width: 112, flexShrink: 0 } : {}),
        '& input': {
          fontFamily: 'monospace',
        },
      }}
    />
  )

  const popover = (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={handleClose}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'left',
      }}
    >
      <Box sx={{ p: 2 }}>
        <HexColorPicker
          color={shown}
          onChange={handlePickerChange}
          style={{ width: 220, height: 180 }}
        />

        <Box
          sx={{
            mt: 1,
            textAlign: 'center',
            fontFamily: 'monospace',
            fontSize: 12,
            color: 'text.secondary',
          }}
        >
          {String(draftValue).toUpperCase()}
        </Box>
      </Box>
    </Popover>
  )

  if (compact) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1, ...sx }}>
        {swatch}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
          {helpText && (
            <Typography variant="caption" color="text.secondary" component="p">
              {helpText}
            </Typography>
          )}
        </Box>
        {hexInput}
        {resetButton}
        {popover}
      </Box>
    )
  }

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
      <Box sx={{ mb: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>

        {helpText && (
          <Typography variant="caption" color="text.secondary">
            {helpText}
          </Typography>
        )}
      </Box>

      {hexInput}
      {popover}
    </Paper>
  )
}

export default ColorPicker
