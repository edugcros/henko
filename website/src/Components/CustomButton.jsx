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
  size = 'medium',
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
  const [anchorEl, setAnchorEl] = useState(null)
  const handleOpenMenu = useCallback(event => {
    setAnchorEl(event.currentTarget)
  }, [])

  const buttonStyles = {
    backgroundColor: bgcolor || theme.palette.primary.main,
    color: color || theme.palette.primary.contrastText,
    fontWeight: 'bolder',
    fontSize: sizeText[size],
    padding: paddingButton[size],
    borderRadius: '8px',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    height: '32px',
    textTransform: 'none',
    border: '2px solid transparent',
    transition: 'all 0.25s ease-in-out',
    boxSizing: 'border-box',
    '&:disabled': {
      backgroundColor: theme.palette.action.disabledBackground,
      color: altDisabledTextColor || theme.palette.text.disabled,
      cursor: 'not-allowed',
    },
    '&:hover': {
      backgroundColor: hoverBgcolor || theme.palette.primary.dark || theme.palette.primary.main,
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
