// src/components/VersionHistory.jsx - VERSIÓN PRODUCCIÓN
import React, { useEffect, useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  IconButton,
  Typography,
  Chip,
  Box,
  Divider,
  Tooltip,
  CircularProgress,
  Alert,
} from '@mui/material'
import {
  Close as CloseIcon,
  Restore as RestoreIcon,
  Save as SaveIcon,
  CalendarToday as CalendarIcon,
  Person as PersonIcon,
} from '@mui/icons-material'
import { useTheme } from '@hooks/useThemeConfig'

const VersionHistory = ({ open, onClose }) => {
  const {
    history,
    isHistoryLoading,
    loadHistory,
    rollback,
    theme,
  } = useTheme()

  const [selectedVersion, setSelectedVersion] = useState(null)
  const [isRollingBack, setIsRollingBack] = useState(false)

  // Cargar historial al abrir
  useEffect(() => {
    if (open) {
      loadHistory(20)
    }
  }, [open, loadHistory])

  const handleRollback = async (version) => {
    if (!window.confirm(`¿Volver a la versión ${version}? Se perderán los cambios actuales.`)) {
      return
    }

    setIsRollingBack(true)
    try {
      await rollback(version)
      onClose()
    } catch (error) {
      console.error('Error en rollback:', error)
    } finally {
      setIsRollingBack(false)
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'Fecha desconocida'
    return new Date(dateString).toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { minHeight: 500 }
      }}
    >
      <DialogTitle sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        pb: 1,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <RestoreIcon color="primary" />
          <Typography variant="h6" component="span">
            Historial de Versiones
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ p: 0 }}>
        {/* Versión Actual */}
        <Box sx={{ p: 2, bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Versión Actual
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Chip 
              icon={<SaveIcon fontSize="small" />}
              label={`v${theme?.version || 1}`}
              color="primary"
              size="small"
            />
            <Typography variant="body2" color="text.secondary">
              Última modificación: {formatDate(theme?.updatedAt)}
            </Typography>
          </Box>
        </Box>

        <Divider />

        {/* Lista de Versiones */}
        {isHistoryLoading ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <CircularProgress size={40} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Cargando historial...
            </Typography>
          </Box>
        ) : history?.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">
              No hay versiones anteriores disponibles
            </Typography>
          </Box>
        ) : (
          <List sx={{ pt: 0 }}>
            {history?.map((item, index) => (
              <ListItem
                key={item._id || index}
                disablePadding
                secondaryAction={
                  <Button
                    size="small"
                    startIcon={<RestoreIcon />}
                    onClick={() => handleRollback(item.version)}
                    disabled={isRollingBack || item.isActive}
                    color={item.isActive ? 'success' : 'primary'}
                    variant={item.isActive ? 'outlined' : 'text'}
                  >
                    {item.isActive ? 'Activa' : 'Restaurar'}
                  </Button>
                }
              >
                <ListItemButton
                  selected={selectedVersion === item.version}
                  onClick={() => setSelectedVersion(item.version)}
                  disabled={item.isActive}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" fontWeight={600}>
                          Versión {item.version}
                        </Typography>
                        {item.isActive && (
                          <Chip label="Actual" size="small" color="success" />
                        )}
                      </Box>
                    }
                    secondary={
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <CalendarIcon fontSize="inherit" color="action" />
                          <Typography variant="caption" color="text.secondary">
                            {formatDate(item.updatedAt)}
                          </Typography>
                        </Box>
                        {item.lastModifiedBy && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <PersonIcon fontSize="inherit" color="action" />
                            <Typography variant="caption" color="text.secondary">
                              {typeof item.lastModifiedBy === 'object' 
                                ? item.lastModifiedBy.email || item.lastModifiedBy.name
                                : 'Usuario'}
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    }
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
          {history?.length > 0 ? `${history.length} versiones encontradas` : ''}
        </Typography>
        <Button onClick={onClose} color="inherit">
          Cerrar
        </Button>
      </DialogActions>

      {/* Overlay de carga durante rollback */}
      {isRollingBack && (
        <Box sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          bgcolor: 'rgba(255,255,255,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1,
        }}>
          <Box sx={{ textAlign: 'center' }}>
            <CircularProgress size={50} />
            <Typography variant="body2" sx={{ mt: 2 }}>
              Restaurando versión...
            </Typography>
          </Box>
        </Box>
      )}
    </Dialog>
  )
}

export default React.memo(VersionHistory)