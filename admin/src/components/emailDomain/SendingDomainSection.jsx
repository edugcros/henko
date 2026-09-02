// 📁 admin/src/components/emailDomain/SendingDomainSection.jsx
//
// Dominio de envío propio del comercio.
//
// Sin esto, todos los comercios mandan desde la dirección de la plataforma y
// el comprador ve "Tienda X <no-reply@plataforma.com>". Acá el comercio
// declara su dirección, copia los registros DNS y pide verificar.
//
// La pantalla nunca dice que el remitente cambió antes de tiempo: mientras el
// dominio esté pendiente, muestra explícitamente que los correos siguen
// saliendo por la plataforma. Un dominio sin SPF/DKIM publicados no autoriza
// a nadie a enviar en su nombre, así que "casi verificado" es, en la práctica,
// no verificado.
import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'

import {
  deleteEmailDomain,
  getEmailDomain,
  saveEmailDomain,
  verifyEmailDomain,
} from '../../services/emailDomainService'

const clean = value => String(value ?? '').trim()
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Mismo criterio que backend/src/services/email/tenantEmailDomainService.js
// (no se puede compartir código entre paquetes acá) — feedback instantáneo
// antes de pegarle al servidor, pero el guard real (el que no se puede
// evitar) vive en el backend.
const FREE_EMAIL_PROVIDER_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.com.ar',
  'hotmail.es',
  'outlook.com',
  'outlook.com.ar',
  'outlook.es',
  'live.com',
  'live.com.ar',
  'msn.com',
  'yahoo.com',
  'yahoo.com.ar',
  'yahoo.es',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'zoho.com',
])

const isFreeEmailProviderAddress = address => {
  const domain = clean(address).toLowerCase().split('@')[1] || ''
  return FREE_EMAIL_PROVIDER_DOMAINS.has(domain)
}

const STATUS_META = {
  verified: {
    label: 'Verificado',
    color: 'success',
    Icon: CheckCircleIcon,
  },
  pending: {
    label: 'Esperando DNS',
    color: 'warning',
    Icon: HourglassEmptyIcon,
  },
  failed: {
    label: 'Falló la verificación',
    color: 'error',
    Icon: ErrorOutlineIcon,
  },
}

/**
 * Los valores de DNS son largos y no se pueden tipear a mano sin equivocarse
 * (una clave DKIM son cientos de caracteres). Copiar es la única forma real
 * de cargarlos.
 */
const CopyableValue = ({ value }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Sin permiso de portapapeles el valor sigue visible y seleccionable.
    }
  }

  return (
    <Stack direction="row" spacing={0.5} alignItems="flex-start">
      <Typography
        variant="caption"
        sx={{
          fontFamily: 'monospace',
          wordBreak: 'break-all',
          flex: 1,
        }}
      >
        {value}
      </Typography>
      <Tooltip title={copied ? 'Copiado' : 'Copiar'}>
        <IconButton size="small" onClick={handleCopy}>
          <ContentCopyIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}

/**
 * @param onIdentityChange Notifica al padre cada vez que se resuelve o
 *   cambia la identidad de envío — StoreSettingsPage la usa para el preview
 *   "así lo ve tu cliente", que necesita el mismo `effectiveFromAddress`
 *   real, no una copia de la regla que pueda desincronizarse.
 */
const SendingDomainSection = ({ onIdentityChange } = {}) => {
  const [identity, setIdentity] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [draft, setDraft] = useState('')
  const [feedback, setFeedback] = useState(null)

  const applyIdentity = data => {
    setIdentity(data)
    onIdentityChange?.(data)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getEmailDomain()
      applyIdentity(data)
      setDraft(data?.requested?.fromAddress || '')
    } catch (error) {
      setFeedback({
        severity: 'error',
        message: error?.response?.data?.message || 'No se pudo cargar el dominio de envío.',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const run = async (action, fn) => {
    setBusy(action)
    setFeedback(null)

    try {
      const data = await fn()
      applyIdentity(data)
      setDraft(data?.requested?.fromAddress || '')

      if (action === 'verify') {
        setFeedback(
          data?.usingOwnDomain
            ? {
                severity: 'success',
                message: 'Dominio verificado. Tus correos ya salen desde tu dirección.',
              }
            : {
                severity: 'info',
                message:
                  'Todavía no está verificado. Los cambios de DNS pueden tardar hasta 48 horas en propagarse.',
              },
        )
      }
    } catch (error) {
      setFeedback({
        severity: 'error',
        message: error?.response?.data?.message || 'No se pudo completar la acción.',
      })
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return (
      <Stack alignItems="center" py={3}>
        <CircularProgress size={22} />
      </Stack>
    )
  }

  if (!identity) {
    return (
      <Alert severity="error" variant="outlined" sx={{ borderRadius: 2 }}>
        {feedback?.message || 'No se pudo cargar el dominio de envío.'}
      </Alert>
    )
  }

  const requested = identity.requested || {}
  const status = requested.status || 'none'
  const meta = STATUS_META[status]
  const draftIsFreeProvider = isFreeEmailProviderAddress(draft)
  const draftIsValid = EMAIL_RE.test(clean(draft)) && !draftIsFreeProvider
  const records = requested.dnsRecords || []

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2" color="text.secondary">
          Enviando como:
        </Typography>
        <Chip
          size="small"
          label={identity.effectiveFromAddress}
          color={identity.usingOwnDomain ? 'success' : 'default'}
          variant="outlined"
        />
        {meta && (
          <Chip
            size="small"
            color={meta.color}
            variant="outlined"
            icon={<meta.Icon />}
            label={meta.label}
          />
        )}
      </Stack>

      {feedback && (
        <Alert severity={feedback.severity} variant="outlined" sx={{ borderRadius: 2 }}>
          {feedback.message}
        </Alert>
      )}

      {requested.lastError && status !== 'verified' && (
        <Alert severity="warning" variant="outlined" sx={{ borderRadius: 2 }}>
          {requested.lastError}
        </Alert>
      )}

      {status === 'verified' ? (
        <Stack spacing={1.5} alignItems="flex-start">
          <Typography variant="body2" color="text.primary">
            Tus correos salen desde <strong>{requested.fromAddress}</strong>, con la reputación de
            tu propio dominio.
          </Typography>

          <Button
            size="small"
            variant="outlined"
            color="inherit"
            disabled={busy === 'delete'}
            onClick={() => run('delete', deleteEmailDomain)}
            sx={{ borderRadius: 2, textTransform: 'none' }}
          >
            {busy === 'delete' ? 'Quitando...' : 'Volver a la dirección de la plataforma'}
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Para enviar desde tu propia dirección, tu dominio tiene que autorizarlo por DNS. Hasta
            que eso esté listo, los correos siguen saliendo por la plataforma.
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              fullWidth
              size="small"
              type="email"
              label="Dirección de envío"
              placeholder="no-reply@tudominio.com"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              error={Boolean(clean(draft)) && !draftIsValid}
              helperText={
                clean(draft) && draftIsFreeProvider
                  ? 'Gmail, Hotmail, Outlook y similares no se pueden verificar como dominio propio — necesitás un dominio propio (ej: tumarca.com).'
                  : clean(draft) && !draftIsValid
                    ? 'Revisá el formato'
                    : ''
              }
            />
            <Button
              variant="contained"
              disabled={!draftIsValid || busy === 'save'}
              onClick={() => run('save', () => saveEmailDomain(clean(draft)))}
              sx={{
                borderRadius: 2,
                textTransform: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {busy === 'save' ? 'Registrando...' : 'Conectar dominio'}
            </Button>
          </Stack>

          {records.length > 0 && (
            <Box>
              <Typography variant="body2" fontWeight={700} mb={1}>
                Cargá estos registros en el DNS de {requested.domain}
              </Typography>

              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Tipo</TableCell>
                      <TableCell>Nombre</TableCell>
                      <TableCell>Valor</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {records.map((record, index) => (
                      <TableRow key={`${record.type}-${record.name}-${index}`}>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{record.type}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          <CopyableValue value={record.name} />
                        </TableCell>
                        <TableCell sx={{ maxWidth: 320 }}>
                          <CopyableValue value={record.value} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>

              <Stack direction="row" spacing={1.5} mt={2} alignItems="center">
                <Button
                  variant="contained"
                  disabled={busy === 'verify'}
                  onClick={() => run('verify', verifyEmailDomain)}
                  sx={{ borderRadius: 2, textTransform: 'none' }}
                >
                  {busy === 'verify' ? 'Verificando...' : 'Ya los cargué, verificar'}
                </Button>

                <Button
                  size="small"
                  color="inherit"
                  disabled={busy === 'delete'}
                  onClick={() => run('delete', deleteEmailDomain)}
                  sx={{ textTransform: 'none' }}
                >
                  Cancelar
                </Button>
              </Stack>
            </Box>
          )}

          {!identity.canManageDomains && status !== 'none' && (
            <Alert severity="info" variant="outlined" sx={{ borderRadius: 2 }}>
              La verificación automática no está habilitada en esta instalación. Un administrador
              tiene que completar el alta del dominio desde el proveedor de correo.
            </Alert>
          )}
        </Stack>
      )}
    </Stack>
  )
}

export default SendingDomainSection
