import React from 'react'
import { Menu, MenuItem, ListItemText } from '@mui/material'
import { primary } from '../theme/colors'

const MenuList = ({ anchorEl, setAnchorEl, ListMenu }) => {
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
        background: primary.white,
        border: `1px solid ${primary.paleBlueStrong}`,
        width: '200px',
        marginTop: 1,
        padding: 0,
      },
      '& .MuiMenuItem-root': {
        borderBottom: `1px solid ${primary.paleBlueStrong}`,
        color: primary.lightBlue,
        padding: '8px 16px',
        textAlign: 'left',
        whiteSpace: 'normal',
      },
    },
    listItemText: {
      fontSize: 15,
      wordWrap: 'break-word',
      color: primary.lightBlue,
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
