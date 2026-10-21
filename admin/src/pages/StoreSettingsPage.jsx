// 📁 admin/src/pages/StoreSettingsPage.jsx
//
// Datos del comercio: identidad, contacto y marca.
//
// Estos campos ya se cargaban en el wizard de alta y después no había forma
// de volver a tocarlos: el wizard es de una sola pasada y ninguna pantalla
// del panel escribía `PUT /tenants/me/settings`. El email de contacto es el
// que más duele de esa lista, porque es la dirección de respuesta de todos
// los mails transaccionales y el destino de los avisos de venta — un comercio
// que se equivocaba al darse de alta no tenía cómo corregirlo.
//
// El backend ya estaba entero (validación incluida); lo único que faltaba era
// esta pantalla.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Grid,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import StorefrontIcon from '@mui/icons-material/Storefront'
import MailOutlineIcon from '@mui/icons-material/MailOutlined'
import PaletteIcon from '@mui/icons-material/Palette'
import SaveIcon from '@mui/icons-material/Save'

import { fetchTenantSettings, saveTenantSettings } from '../features/tenant/tenantSlice'
import SendingDomainSection from '../components/emailDomain/SendingDomainSection'
import StoreDomainSection from '../components/domains/StoreDomainSection'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'
const GRADIENT = 'linear-gradient(100deg, #0b6bff 0%, #5b3dff 58%, #8a2cff 100%)'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

const clean = value => String(value ?? '').trim()

// Mismo criterio que el backend (tenantSettingsCtrl), para que la pantalla no
// acepte lo que la API va a rechazar.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const toForm = data => ({
  name: data?.name || '',
  description: data?.settings?.store?.description || '',
  contactEmail: data?.settings?.store?.contactEmail || '',
  contactPhone: data?.settings?.store?.contactPhone || '',
  address: data?.settings?.store?.address || '',
  logoUrl: data?.settings?.branding?.logoUrl || '',
  faviconUrl: data?.settings?.branding?.faviconUrl || '',
})

export const sameForm = (a, b) =>
  Boolean(a) && Boolean(b) && Object.keys(a).every(key => a[key] === b[key])

// El servidor no valida el formato de las direcciones del logo y del favicon: una escrita sin
// «https://» se guarda igual y después el logo no aparece en la tienda ni en los correos.
export const looksLikeUrl = value => /^https?:\/\//i.test(clean(value))

const SectionCard = ({ title, subtitle, icon, children }) => (
  <Paper component="section" variant="outlined" sx={{ ...PANEL_SX, p: { xs: 2.5, md: 3.5 } }}>
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 0.5 }}>
      {icon}
      <Typography component="h2" sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20 }}>
        {title}
      </Typography>
    </Stack>
    {subtitle && (
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        {subtitle}
      </Typography>
    )}
    <Divider sx={{ mb: 2.5, borderColor: BRAND.line }} />
    {children}
  </Paper>
)

/**
 * Cómo le va a llegar el mail al comprador.
 *
 * Se muestra literal porque es la pregunta que genera más confusión: el
 * remitente es de la plataforma salvo que el dominio propio esté verificado
 * (SendGrid exige DNS para eso) — lo que el comercio siempre controla es el
 * nombre visible y el reply-to. Decirlo acá evita el ticket de "¿por qué no
 * sale desde mi dominio?".
 */
const EmailPreview = ({ fromName, fromAddress, replyTo }) => (
  <Paper
    variant="outlined"
    sx={{ p: 2, borderRadius: 3, borderColor: BRAND.line, bgcolor: BRAND.paper }}
  >
    <Typography
      variant="caption"
      sx={{ color: BRAND.muted, fontWeight: 700, letterSpacing: '0.06em' }}
    >
      ASÍ LO VE TU CLIENTE
    </Typography>

    <Stack spacing={0.5} sx={{ mt: 1 }}>
      <Typography variant="body2" color="text.primary">
        <strong>De:</strong> {fromName || 'Tu comercio'}
        {fromAddress ? <> &lt;{fromAddress}&gt;</> : null}
      </Typography>
      <Typography variant="body2" color="text.primary">
        <strong>Responder a:</strong>{' '}
        {replyTo || (
          <Typography component="span" variant="body2" color="text.secondary">
            sin definir — las respuestas se pierden
          </Typography>
        )}
      </Typography>
    </Stack>
  </Paper>
)

const LogoPreview = ({ url }) => {
  const [failed, setFailed] = useState(false)

  // Si la dirección cambia, se vuelve a intentar con la nueva.
  useEffect(() => setFailed(false), [url])

  if (!looksLikeUrl(url)) return null

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        p: 1.5,
        border: `1px dashed ${BRAND.line}`,
        borderRadius: 3,
        minHeight: 64,
      }}
    >
      {failed ? (
        <Typography variant="body2" color="warning.main">
          No se pudo cargar la imagen: revisá la dirección.
        </Typography>
      ) : (
        <Box
          component="img"
          src={clean(url)}
          alt="Logo de la tienda"
          onError={() => setFailed(true)}
          sx={{ maxHeight: 48, maxWidth: '100%', objectFit: 'contain' }}
        />
      )}
    </Box>
  )
}

const StoreSettingsPage = () => {
  const dispatch = useDispatch()
  const { data, isLoading, isSaving, isError, message } = useSelector(state => state.tenant || {})

  const [form, setForm] = useState(null)
  // Lo último que se cargó del servidor: con esto se sabe si hay cambios sin guardar.
  const [baseline, setBaseline] = useState(null)
  const [emailIdentity, setEmailIdentity] = useState(null)
  const [snackbar, setSnackbar] = useState({
    open: false,
    severity: 'success',
    message: '',
  })

  const formRef = useRef(null)
  const baselineRef = useRef(null)
  const forceRehydrate = useRef(false)

  formRef.current = form
  baselineRef.current = baseline

  useEffect(() => {
    dispatch(fetchTenantSettings())
  }, [dispatch])

  // Se rehidrata el formulario cuando llega data nueva del servidor, salvo que haya algo escrito
  // sin guardar: las secciones de dominios vuelven a pedir la configuración al terminar, y eso
  // pisaba lo que el comercio estaba tipeando. Después de guardar sí se rehidrata, para mostrar
  // lo que el servidor devolvió.
  useEffect(() => {
    if (!data) return

    const next = toForm(data)
    const current = formRef.current
    const hasUnsavedChanges = current && !sameForm(current, baselineRef.current)

    if (!current || forceRehydrate.current || !hasUnsavedChanges) {
      forceRehydrate.current = false
      setForm(next)
      setBaseline(next)
    }
  }, [data])

  const setField = useCallback((key, value) => {
    // Si se vuelve a escribir después de guardar, ya no hay que pisar lo escrito con lo del servidor.
    forceRehydrate.current = false
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  const isDirty = Boolean(form) && !sameForm(form, baseline)

  const emailError = useMemo(() => {
    const value = clean(form?.contactEmail)
    if (!value) return ''
    return EMAIL_RE.test(value) ? '' : 'Revisá el formato del correo'
  }, [form?.contactEmail])

  const canSave = useMemo(() => {
    return Boolean(clean(form?.name)) && !emailError && !isSaving
  }, [form?.name, emailError, isSaving])

  const handleSave = useCallback(async () => {
    if (!canSave) return

    try {
      forceRehydrate.current = true

      await dispatch(
        saveTenantSettings({
          name: clean(form.name),
          settings: {
            store: {
              description: clean(form.description),
              contactEmail: clean(form.contactEmail),
              contactPhone: clean(form.contactPhone),
              address: clean(form.address),
            },
            branding: {
              logoUrl: clean(form.logoUrl),
              faviconUrl: clean(form.faviconUrl),
            },
          },
        }),
      ).unwrap()

      setSnackbar({
        open: true,
        severity: 'success',
        message: 'Datos del comercio guardados.',
      })
    } catch (error) {
      forceRehydrate.current = false
      setSnackbar({
        open: true,
        severity: 'error',
        message: error || 'No se pudieron guardar los datos.',
      })
    }
  }, [canSave, dispatch, form])

  if (isLoading && !form) {
    return (
      <Stack sx={{ alignItems: 'center', py: 6 }}>
        <CircularProgress />
      </Stack>
    )
  }

  if (isError && !form) {
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 900, mx: 'auto' }}>
        <Alert
          severity="error"
          variant="outlined"
          sx={{ borderRadius: 3 }}
          action={
            <Button color="inherit" size="small" onClick={() => dispatch(fetchTenantSettings())}>
              Reintentar
            </Button>
          }
        >
          {message || 'No se pudo cargar la configuración del comercio.'}
        </Alert>
      </Box>
    )
  }

  if (!form) return null

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 900, mx: 'auto' }}>
      <Box component="header" sx={{ mb: 4 }}>
        <Typography
          variant="overline"
          sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          TU TIENDA
        </Typography>
        <Typography
          component="h1"
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 800,
            fontSize: { xs: 26, md: 34 },
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
          }}
        >
          Configuración del comercio
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Los datos con los que tu tienda se presenta y por los que te contactan.
        </Typography>
      </Box>

      <Stack spacing={3}>
        <SectionCard
          title="Identidad"
          subtitle="El nombre aparece en la tienda y como remitente de tus correos."
          icon={<StorefrontIcon sx={{ color: BRAND.blue }} />}
        >
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                required
                label="Nombre del comercio"
                value={form.name}
                onChange={e => setField('name', e.target.value)}
                error={!clean(form.name)}
                helperText={!clean(form.name) ? 'El nombre no puede quedar vacío' : ''}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                multiline
                minRows={2}
                label="Descripción"
                value={form.description}
                onChange={e => setField('description', e.target.value)}
                inputProps={{ maxLength: 300 }}
                helperText={`${form.description.length}/300`}
              />
            </Grid>
          </Grid>
        </SectionCard>

        <SectionCard
          title="Contacto y correo"
          subtitle="El correo de contacto recibe los avisos de venta y es la dirección a la que responden tus clientes."
          icon={<MailOutlineIcon sx={{ color: BRAND.blue }} />}
        >
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                type="email"
                label="Correo de contacto"
                value={form.contactEmail}
                onChange={e => setField('contactEmail', e.target.value)}
                error={Boolean(emailError)}
                helperText={
                  emailError ||
                  'A esta dirección llegan los avisos de venta y las respuestas de tus clientes.'
                }
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <EmailPreview
                fromName={clean(form.name)}
                fromAddress={emailIdentity?.effectiveFromAddress || ''}
                replyTo={clean(form.contactEmail)}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Divider sx={{ mb: 2, borderColor: BRAND.line }} />
              <Typography component="h3" variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Enviar desde tu propio dominio
              </Typography>
              <SendingDomainSection onIdentityChange={setEmailIdentity} />
            </Grid>

            {/* Van juntos porque la gente los confunde, y separados porque son
                cosas distintas: uno es por dónde SALEN los correos, el otro es
                por dónde ENTRAN los clientes. Un comercio puede tener uno, el
                otro, o los dos. */}
            <Grid size={{ xs: 12 }}>
              <Divider sx={{ mb: 2, borderColor: BRAND.line }} />
              <Typography component="h3" variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                La dirección de tu tienda
              </Typography>
              <StoreDomainSection />
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Teléfono"
                value={form.contactPhone}
                onChange={e => setField('contactPhone', e.target.value)}
                inputProps={{ maxLength: 30 }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Dirección"
                value={form.address}
                onChange={e => setField('address', e.target.value)}
                inputProps={{ maxLength: 200 }}
              />
            </Grid>
          </Grid>
        </SectionCard>

        <SectionCard
          title="Marca"
          subtitle="Logo y favicon de la tienda. El logo también encabeza los correos."
          icon={<PaletteIcon sx={{ color: BRAND.blue }} />}
        >
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="URL del logo"
                value={form.logoUrl}
                onChange={e => setField('logoUrl', e.target.value)}
                placeholder="https://..."
                helperText={
                  clean(form.logoUrl) && !looksLikeUrl(form.logoUrl)
                    ? 'Tiene que empezar con https:// para que se vea en la tienda y en los correos.'
                    : ''
                }
                slotProps={{ formHelperText: { sx: { color: 'warning.main' } } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="URL del favicon"
                value={form.faviconUrl}
                onChange={e => setField('faviconUrl', e.target.value)}
                placeholder="https://..."
                helperText={
                  clean(form.faviconUrl) && !looksLikeUrl(form.faviconUrl)
                    ? 'Tiene que empezar con https:// para que se vea en la pestaña del navegador.'
                    : ''
                }
                slotProps={{ formHelperText: { sx: { color: 'warning.main' } } }}
              />
            </Grid>
            {looksLikeUrl(form.logoUrl) && (
              <Grid size={{ xs: 12 }}>
                <LogoPreview url={form.logoUrl} />
              </Grid>
            )}
          </Grid>
        </SectionCard>

        <Paper
          variant="outlined"
          sx={{
            ...PANEL_SX,
            p: 2,
            position: 'sticky',
            bottom: 16,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { sm: 'center' },
            justifyContent: 'space-between',
            gap: 1.5,
          }}
        >
          <Typography
            variant="body2"
            role="status"
            sx={{ color: isDirty ? '#9a5b00' : BRAND.muted, fontWeight: isDirty ? 700 : 400 }}
          >
            {isDirty ? 'Hay cambios sin guardar.' : 'Todo está guardado.'}
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={isSaving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
            onClick={handleSave}
            disabled={!canSave}
            sx={{
              borderRadius: 3,
              textTransform: 'none',
              fontWeight: 700,
              px: 4,
              background: canSave ? GRADIENT : undefined,
            }}
          >
            {isSaving ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </Paper>
      </Stack>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert
          severity={snackbar.severity}
          variant="filled"
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default StoreSettingsPage
