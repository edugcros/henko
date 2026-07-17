import React, { useMemo } from 'react'
import { Menu, MenuItem, ListItemText } from '@mui/material'
import { useSelector } from 'react-redux'
import { useTenant } from '../contexts/TenantContext'
import { getThemeColors } from '@utils/themeRuntime'

const MenuList = ({ anchorEl, setAnchorEl, ListMenu }) => {
  const tenantContext = useTenant()
  const themeState = useSelector(state => state.theme)

  const tenantConfig = tenantContext?.themeConfig
  const reduxConfig = themeState?.config
  const previewConfig = themeState?.previewConfig
  const previewMode = themeState?.previewMode

  const activeConfig = useMemo(() => {
    if (previewMode && previewConfig) return previewConfig
    if (reduxConfig) return reduxConfig
    if (tenantConfig) return tenantConfig
    return {}
  }, [reduxConfig, tenantConfig, previewConfig, previewMode])

  const themeColors = useMemo(() => getThemeColors(activeConfig), [activeConfig])

  const handleClose = handleOnClick => {
    setAnchorEl(null)
    if (typeof handleOnClick === 'function') {
      handleOnClick()
    }
  }

  const menuListStyles = {
    root: {
      '& .MuiPaper-root': {
        boxShadow: '2px 2px 2px 1px rgba(0, 0, 0, 0.2)',
        background: themeColors.cardBackground,
        border: `1px solid ${themeColors.cardBorder}`,
        width: '200px',
        marginTop: 1,
        padding: 0,
      },
      '& .MuiMenuItem-root': {
        borderBottom: `1px solid ${themeColors.cardBorder}`,
        color: themeColors.link,
        padding: '8px 16px',
        textAlign: 'left',
        whiteSpace: 'normal',
      },
    },
    listItemText: {
      fontSize: 15,
      wordWrap: 'break-word',
      color: themeColors.link,
    },
  }

  return (
    <Menu
      keepMounted
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={() => setAnchorEl(null)}
      elevation={0}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      sx={menuListStyles.root}
    >
      {ListMenu.map(item => (
        <MenuItem
          key={item.title}
          onClick={() => handleClose(item.handleOnClick)}
        >
          <ListItemText sx={menuListStyles.listItemText} primary={item.title} />
        </MenuItem>
      ))}
    </Menu>
  )
}

export default MenuList
