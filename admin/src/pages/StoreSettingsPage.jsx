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
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
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

const clean = value => String(value ?? '').trim()

// Mismo criterio que el backend (tenantSettingsCtrl), para que la pantalla no
// acepte lo que la API va a rechazar.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const toForm = data => ({
  name: data?.name || '',
  description: data?.settings?.store?.description || '',
  contactEmail: data?.settings?.store?.contactEmail || '',
  contactPhone: data?.settings?.store?.contactPhone || '',
  address: data?.settings?.store?.address || '',
  logoUrl: data?.settings?.branding?.logoUrl || '',
  faviconUrl: data?.settings?.branding?.faviconUrl || '',
})

const SectionCard = ({ title, subtitle, icon, children }) => (
  <Card variant="outlined" sx={{ borderRadius: 3 }}>
    <CardContent>
      <Stack direction="row" spacing={1.5} alignItems="center" mb={0.5}>
        {icon}
        <Typography variant="h6" fontWeight={700}>
          {title}
        </Typography>
      </Stack>
      {subtitle && (
        <Typography variant="body2" color="text.secondary" mb={2}>
          {subtitle}
        </Typography>
      )}
      <Divider sx={{ mb: 2.5 }} />
      {children}
    </CardContent>
  </Card>
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
  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'grey.50' }}>
    <Typography variant="caption" color="text.secondary" fontWeight={700}>
      ASÍ LO VE TU CLIENTE
    </Typography>

    <Stack spacing={0.5} mt={1}>
      <Typography variant="body2" color="text.primary">
        <strong>De:</strong> {fromName || 'Tu comercio'} &lt;{fromAddress}&gt;
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

const StoreSettingsPage = () => {
  const dispatch = useDispatch()
  const { data, isLoading, isSaving, isError, message } = useSelector(state => state.tenant || {})

  const [form, setForm] = useState(null)
  const [emailIdentity, setEmailIdentity] = useState(null)
  const [snackbar, setSnackbar] = useState({
    open: false,
    severity: 'success',
    message: '',
  })

  useEffect(() => {
    dispatch(fetchTenantSettings())
  }, [dispatch])

  // Solo se rehidrata el formulario cuando llega data nueva del servidor, no
  // en cada render: si no, pisaría lo que el comercio está escribiendo.
  useEffect(() => {
    if (data) setForm(toForm(data))
  }, [data])

  const setField = useCallback((key, value) => setForm(prev => ({ ...prev, [key]: value })), [])

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
      setSnackbar({
        open: true,
        severity: 'error',
        message: error || 'No se pudieron guardar los datos.',
      })
    }
  }, [canSave, dispatch, form])

  if (isLoading && !form) {
    return (
      <Stack alignItems="center" py={6}>
        <CircularProgress />
      </Stack>
    )
  }

  if (isError && !form) {
    return (
      <Alert severity="error" variant="outlined" sx={{ borderRadius: 2 }}>
        {message || 'No se pudo cargar la configuración del comercio.'}
      </Alert>
    )
  }

  if (!form) return null

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h5" fontWeight={900} mb={0.5}>
        Configuración del comercio
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        Los datos con los que tu tienda se presenta y por los que te contactan.
      </Typography>

      <Stack spacing={2.5}>
        <SectionCard
          title="Identidad"
          subtitle="El nombre aparece en la tienda y como remitente de tus correos."
          icon={<StorefrontIcon color="primary" />}
        >
          <Grid container spacing={2.5}>
            <Grid xs={12}>
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
            <Grid xs={12}>
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
          icon={<MailOutlineIcon color="primary" />}
        >
          <Grid container spacing={2.5}>
            <Grid xs={12}>
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

            <Grid xs={12}>
              <EmailPreview
                fromName={clean(form.name)}
                fromAddress={emailIdentity?.effectiveFromAddress || ''}
                replyTo={clean(form.contactEmail)}
              />
            </Grid>

            <Grid xs={12}>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle2" fontWeight={700} mb={1}>
                Enviar desde tu propio dominio
              </Typography>
              <SendingDomainSection onIdentityChange={setEmailIdentity} />
            </Grid>

            <Grid xs={12} sm={6}>
              <TextField
                fullWidth
                label="Teléfono"
                value={form.contactPhone}
                onChange={e => setField('contactPhone', e.target.value)}
                inputProps={{ maxLength: 30 }}
              />
            </Grid>
            <Grid xs={12} sm={6}>
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
          icon={<PaletteIcon color="primary" />}
        >
          <Grid container spacing={2.5}>
            <Grid xs={12} sm={6}>
              <TextField
                fullWidth
                label="URL del logo"
                value={form.logoUrl}
                onChange={e => setField('logoUrl', e.target.value)}
                placeholder="https://..."
              />
            </Grid>
            <Grid xs={12} sm={6}>
              <TextField
                fullWidth
                label="URL del favicon"
                value={form.faviconUrl}
                onChange={e => setField('faviconUrl', e.target.value)}
                placeholder="https://..."
              />
            </Grid>
          </Grid>
        </SectionCard>

        <Paper
          variant="outlined"
          sx={{
            p: 2,
            borderRadius: 3,
            position: 'sticky',
            bottom: 16,
            textAlign: 'right',
          }}
        >
          <Button
            variant="contained"
            size="large"
            startIcon={isSaving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
            onClick={handleSave}
            disabled={!canSave}
            sx={{ borderRadius: 2, textTransform: 'none', px: 4 }}
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
