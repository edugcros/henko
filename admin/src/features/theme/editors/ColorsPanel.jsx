// 📁 src/features/theme/editors/ColorsPanel.jsx
//
// Colores de la tienda: una paleta lista con un toque, y cada color ajustable
// por separado, agrupado por la parte de la tienda que pinta. Qué pinta cada
// uno sale de COLOR_ROLE_GROUPS (colorSystem.js), verificado contra el
// storefront.
import React, { useCallback, useMemo, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ColorPicker, { isValidHex } from '@components/ColorPicker'
import {
  COLOR_PRESETS,
  COLOR_ROLE_GROUPS,
  CONTRAST_PAIRS,
  DEFAULT_THEME_COLORS,
  contrastRatio,
  resolveThemeColors,
} from '@features/theme/colorSystem'

const ROLE_KEYS = Object.keys(DEFAULT_THEME_COLORS)
const FIRST_PRESETS = 9

const paletteOf = preset => Object.fromEntries(ROLE_KEYS.map(key => [key, preset[key]]))

const samePalette = (a, b) =>
  ROLE_KEYS.every(key => String(a[key]).toLowerCase() === String(b[key]).toLowerCase())

// Los pares de contraste que no llegan al mínimo, con el rol que hay que tocar.
export const contrastIssues = colors =>
  CONTRAST_PAIRS.map(pair => ({
    ...pair,
    ratio: contrastRatio(colors[pair.fg], colors[pair.bg]),
  })).filter(pair => pair.ratio !== null && pair.ratio < pair.min)

const formatRatio = value => value.toFixed(1).replace('.', ',')

// Una miniatura de la tienda con la paleta: header, fondo, una card con precio
// y un botón. Así se ve qué cambia, no solo tres manchas de color.
const PalettePreview = ({ palette }) => (
  <Box
    aria-hidden
    sx={{
      height: 52,
      borderRadius: 1.5,
      overflow: 'hidden',
      border: '1px solid',
      borderColor: 'divider',
      bgcolor: palette.background,
      display: 'flex',
      flexDirection: 'column',
    }}
  >
    <Box
      sx={{
        height: 12,
        bgcolor: palette.headerBackground,
        display: 'flex',
        alignItems: 'center',
        px: 0.75,
        gap: 0.5,
      }}
    >
      <Box sx={{ width: 18, height: 3, borderRadius: 1, bgcolor: palette.headerText }} />
      <Box
        sx={{ ml: 'auto', width: 4, height: 4, borderRadius: '50%', bgcolor: palette.headerIcon }}
      />
    </Box>
    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 0.75, px: 0.75 }}>
      <Box
        sx={{
          flex: 1,
          height: 34,
          borderRadius: 1,
          bgcolor: palette.cardBackground,
          border: `1px solid ${palette.cardBorder}`,
          p: 0.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.4,
        }}
      >
        <Box sx={{ width: '70%', height: 3, borderRadius: 1, bgcolor: palette.cardText }} />
        <Box sx={{ width: '40%', height: 3, borderRadius: 1, bgcolor: palette.cardPrice }} />
        <Box
          sx={{
            width: '55%',
            height: 7,
            borderRadius: 0.75,
            bgcolor: palette.actionPrimary,
            mt: 'auto',
          }}
        />
      </Box>
      <Box sx={{ width: 14, height: 7, borderRadius: 0.75, bgcolor: palette.badgeBackground }} />
    </Box>
    <Box sx={{ height: 6, bgcolor: palette.footerBackground }} />
  </Box>
)

const ColorsPanel = ({ colors = {}, updateField, onChange }) => {
  const effectiveColors = useMemo(() => resolveThemeColors(colors), [colors])
  // La paleta anterior a la última aplicada, para poder deshacer.
  const [undo, setUndo] = useState(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [showAllPresets, setShowAllPresets] = useState(false)

  // Las primeras paletas, más la que está en uso si no es una de ellas.
  const visiblePresets = useMemo(() => {
    if (showAllPresets) return COLOR_PRESETS
    const first = COLOR_PRESETS.slice(0, FIRST_PRESETS)
    const inUse = COLOR_PRESETS.find(preset => samePalette(paletteOf(preset), effectiveColors))
    return inUse && !first.includes(inUse) ? [...first, inUse] : first
  }, [effectiveColors, showAllPresets])

  const issues = useMemo(() => contrastIssues(effectiveColors), [effectiveColors])

  const handleColorChange = useCallback(
    (key, value) => {
      if (!isValidHex(value)) return
      setUndo(null)
      if (updateField) updateField(`colors.${key}`, value)
      else onChange?.({ ...effectiveColors, [key]: value })
    },
    [effectiveColors, onChange, updateField],
  )

  const applyPalette = useCallback(
    (palette, name) => {
      setUndo({ name, previous: paletteOf(effectiveColors) })
      onChange?.(palette)
    },
    [effectiveColors, onChange],
  )

  const handleUndo = () => {
    if (!undo) return
    onChange?.(undo.previous)
    setUndo(null)
  }

  const handleResetAll = () => {
    setConfirmReset(false)
    applyPalette(paletteOf(DEFAULT_THEME_COLORS), 'colores originales')
  }

  return (
    <Box>
      {/* --------------------------------------------------------------- */}
      {/* Paletas                                                          */}
      {/* --------------------------------------------------------------- */}
      <Box component="section" aria-labelledby="paletas-titulo" sx={{ mb: 3 }}>
        <Typography id="paletas-titulo" variant="subtitle1" sx={{ fontWeight: 800 }}>
          Paletas
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Cambian todos los colores de una vez. Después podés ajustar cada uno abajo.
        </Typography>

        {undo && (
          <Alert
            severity="success"
            sx={{ mb: 1.5 }}
            action={
              <Button color="inherit" size="small" onClick={handleUndo}>
                Deshacer
              </Button>
            }
          >
            Aplicaste{' '}
            {undo.name === 'colores originales' ? 'los colores originales' : `«${undo.name}»`}.
          </Alert>
        )}

        <Box
          role="list"
          aria-label="Paletas disponibles"
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}
        >
          {visiblePresets.map(preset => {
            const palette = paletteOf(preset)
            const active = samePalette(palette, effectiveColors)
            return (
              <ButtonBase
                key={preset.name}
                role="listitem"
                aria-label={`Aplicar paleta ${preset.name}`}
                aria-pressed={active}
                onClick={() => applyPalette(palette, preset.name)}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 0.75,
                  p: 0.75,
                  borderRadius: 2,
                  border: '2px solid',
                  borderColor: active ? 'primary.main' : 'transparent',
                  textAlign: 'left',
                  '&:hover': { bgcolor: 'action.hover' },
                  '&.Mui-focusVisible': { borderColor: 'primary.main' },
                }}
              >
                <PalettePreview palette={palette} />
                <Typography variant="caption" sx={{ fontWeight: active ? 800 : 600 }} noWrap>
                  {preset.name}
                  {active ? ' · en uso' : ''}
                </Typography>
              </ButtonBase>
            )
          })}
        </Box>
        {COLOR_PRESETS.length > FIRST_PRESETS && (
          <Button
            size="small"
            onClick={() => setShowAllPresets(value => !value)}
            sx={{ mt: 1, textTransform: 'none' }}
          >
            {showAllPresets ? 'Ver menos' : `Ver las ${COLOR_PRESETS.length} paletas`}
          </Button>
        )}
      </Box>

      {/* --------------------------------------------------------------- */}
      {/* Ajuste por color                                                 */}
      {/* --------------------------------------------------------------- */}
      <Box component="section" aria-labelledby="ajuste-titulo">
        <Stack
          direction="row"
          sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 0.5 }}
        >
          <Typography id="ajuste-titulo" variant="subtitle1" sx={{ fontWeight: 800 }}>
            Ajustar cada color
          </Typography>
          <Button size="small" onClick={() => setConfirmReset(true)} sx={{ textTransform: 'none' }}>
            Restaurar originales
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Cada color pinta solo la parte de la tienda que dice.
        </Typography>

        {issues.length > 0 && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
              {issues.length === 1
                ? 'Un par de colores se lee con dificultad:'
                : `${issues.length} pares de colores se leen con dificultad:`}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {issues.map(issue => (
                <li key={`${issue.fg}-${issue.bg}`}>
                  <Typography variant="body2">
                    {issue.label}: {formatRatio(issue.ratio)}:1 (mínimo {formatRatio(issue.min)}:1)
                  </Typography>
                </li>
              ))}
            </Box>
          </Alert>
        )}

        {COLOR_ROLE_GROUPS.map(group => {
          const groupIssues = issues.filter(issue =>
            group.fields.some(f => f.key === issue.fg || f.key === issue.bg),
          ).length
          return (
            <Accordion
              key={group.id}
              disableGutters
              elevation={0}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                '&:not(:last-of-type)': { borderBottom: 0 },
                '&::before': { display: 'none' },
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                sx={{ '& .MuiAccordionSummary-content': { minWidth: 0, overflow: 'hidden' } }}
              >
                <Box
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flex: 1 }}
                >
                  <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }} aria-hidden>
                    {group.fields.map(field => (
                      <Box
                        key={field.key}
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          bgcolor: effectiveColors[field.key],
                          border: '1px solid',
                          borderColor: 'divider',
                        }}
                      />
                    ))}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {group.title}
                      {groupIssues > 0 && (
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{ color: 'warning.dark', ml: 1, fontWeight: 700 }}
                        >
                          revisar contraste
                        </Typography>
                      )}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="p" noWrap>
                      {group.description}
                    </Typography>
                  </Box>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                {group.fields.map(field => (
                  <ColorPicker
                    key={field.key}
                    compact
                    context={group.title}
                    label={field.label}
                    helperText={field.appliesTo}
                    value={effectiveColors[field.key]}
                    onChange={value => handleColorChange(field.key, value)}
                    showReset
                    onReset={() => handleColorChange(field.key, DEFAULT_THEME_COLORS[field.key])}
                  />
                ))}
              </AccordionDetails>
            </Accordion>
          )
        })}
      </Box>

      <Dialog open={confirmReset} onClose={() => setConfirmReset(false)} maxWidth="xs" fullWidth>
        <DialogTitle>¿Restaurar los colores originales?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Todos los colores vuelven a los de fábrica. Después vas a poder deshacerlo.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmReset(false)}>Cancelar</Button>
          <Button variant="contained" onClick={handleResetAll}>
            Restaurar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default React.memo(ColorsPanel)
