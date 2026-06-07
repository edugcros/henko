import React, { useState, useCallback } from 'react'
import { Box, Button, Tooltip } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import MenuList from './MenuList.jsx'

const sizeText = {
  small: 12,
  medium: 15,
  large: 18,
}

const paddingButton = {
  small: '3px 16px',
  medium: '7px 16px',
  large: '8px 16px',
}

const CustomButton = ({
  title,
  size,
  startIcon,
  endIcon,
  disabled = false,
  typeButton = 'button',
  tooltip = '',
  tooltipPlacement = 'top',
  id,
  sx = {},
  handleOnClick,
  onClick,
  ListMenu,
  customStyle = {},
  altDisabledTextColor = '',
  bgcolor,
  color,
  hoverBgcolor,
  hoverBorder,
  autoFocus,
  ...props
}) => {
  const theme = useTheme()
  const buttonConfig = theme.storeTheme?.buttons || {}
  const effectiveSize = size || buttonConfig.size || 'medium'
  const effectiveVariant = props.variant || buttonConfig.variant || 'contained'
  const buttonRadius = buttonConfig.radius ?? theme.shape.borderRadius
  const [anchorEl, setAnchorEl] = useState(null)
  const handleOpenMenu = useCallback(event => {
    setAnchorEl(event.currentTarget)
  }, [])

  const buttonStyles = {
    backgroundColor: bgcolor || theme.palette.ctaPrimary.main,
    color: color || theme.palette.ctaPrimary.contrastText,
    fontWeight: 700,
    fontSize: sizeText[effectiveSize],
    padding: paddingButton[effectiveSize],
    borderRadius: `${buttonRadius}px`,
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    minHeight: '36px',
    textTransform: buttonConfig.uppercase ? 'uppercase' : 'none',
    border: '2px solid transparent',
    transition: 'all 0.25s ease-in-out',
    boxSizing: 'border-box',
    '&:disabled': {
      backgroundColor: theme.palette.action.disabledBackground,
      color: altDisabledTextColor || theme.palette.text.disabled,
      cursor: 'not-allowed',
    },
    '&:hover': {
      backgroundColor:
        hoverBgcolor || theme.palette.ctaPrimary.dark || theme.palette.ctaPrimary.main,
      border: hoverBorder || '2px solid transparent',
    },
    ...customStyle,
    ...sx,
  }

  return (
    <>
      <Tooltip
        title={tooltip}
        placement={tooltipPlacement}
        slotProps={{
          tooltip: {
            sx: {
              backgroundColor: theme.palette.text.primary,
              px: 2,
              py: 1,
              fontSize: '0.85rem',
            },
          },
        }}
      >
        <Box component="span">
          <Button
            {...props}
            id={id}
            type={typeButton}
            variant={effectiveVariant}
            size={effectiveSize}
            sx={buttonStyles}
            startIcon={startIcon}
            endIcon={endIcon}
            disabled={disabled}
            onClick={ListMenu ? handleOpenMenu : handleOnClick || onClick}
            autoFocus={autoFocus}
          >
            {title}
          </Button>
        </Box>
      </Tooltip>

      {ListMenu && <MenuList anchorEl={anchorEl} setAnchorEl={setAnchorEl} ListMenu={ListMenu} />}
    </>
  )
}

export default CustomButton
