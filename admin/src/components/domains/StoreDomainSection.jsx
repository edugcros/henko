// 📁 admin/src/components/domains/StoreDomainSection.jsx
//
// El dominio propio del comercio: la dirección desde la que entran sus
// clientes a la tienda y él mismo al panel.
//
// Sin esto, todos los comercios viven en un subdominio de la plataforma
// (mitienda.henkart.com.ar). Acá el comercio carga el suyo, copia el registro
// TXT y pide verificar.
//
// LA PANTALLA NO ADELANTA NADA
//
// Mientras el dominio esté pendiente dice explícitamente que todavía no
// funciona y que hay que seguir usando el subdominio. No es prudencia: el
// backend deja el dominio en `status: 'pending'` y el resolvedor exige
// 'active', así que un dominio sin verificar literalmente no resuelve. Decir
// "casi listo" sería describir mal lo que está pasando.
//
// Y el subdominio de la plataforma no se puede quitar — es la dirección que
// siempre funciona, y el momento en que el dominio propio falla es justo
// cuando el comercio necesita entrar.

import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
  addDomain,
  deleteDomain,
  getDomains,
  verifyDomain,
} from '../../services/tenantDomainService'

const clean = value => String(value ?? '').trim()

// Mismo criterio que backend/src/services/tenant/tenantDomainService.js (no se
// puede compartir código entre paquetes acá): feedback inmediato antes de
// pegarle al servidor. La validación que no se puede evitar vive en el backend.
const HOSTNAME_RE =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/

/** Lo que la gente pega: la URL del navegador, con protocolo y barra. */
const normalizar = value =>
  clean(value)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/\.$/, '')

const STATUS_META = {
  active: { label: 'Funcionando', color: 'success', Icon: CheckCircleIcon },
  pending: {
    label: 'Esperando DNS',
    color: 'warning',
    Icon: HourglassEmptyIcon,
  },
  failed: { label: 'Falló', color: 'error', Icon: ErrorOutlineIcon },
  disabled: { label: 'Desactivado', color: 'default', Icon: ErrorOutlineIcon },
}

/**
 * Los valores de DNS no se tipean a mano sin equivocarse. Copiar es la única
 * forma real de cargarlos.
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
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'flex-start' }}>
      <Typography
        variant="caption"
        sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1 }}
      >
        {value}
      </Typography>
      <Tooltip title={copied ? 'Copiado' : 'Copiar'}>
        <Box
          component="button"
          type="button"
          onClick={handleCopy}
          aria-label={`Copiar ${value}`}
          sx={{
            border: 0,
            background: 'none',
            cursor: 'pointer',
            p: 0.25,
            lineHeight: 0,
            color: copied ? 'success.main' : 'text.secondary',
          }}
        >
          {copied ? (
            <CheckCircleIcon fontSize="inherit" />
          ) : (
            <ContentCopyIcon fontSize="inherit" />
          )}
        </Box>
      </Tooltip>
    </Stack>
  )
}

const StatusChip = ({ status }) => {
  const meta = STATUS_META[status] || STATUS_META.pending

  return (
    <Chip
      size="small"
      color={meta.color}
      variant="outlined"
      icon={<meta.Icon fontSize="small" />}
      label={meta.label}
    />
  )
}

export default function StoreDomainSection() {
  const [loading, setLoading] = useState(true)
  const [domains, setDomains] = useState([])
  const [instructions, setInstructions] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(null)
  const [feedback, setFeedback] = useState(null)

  const cargar = useCallback(async ({ signal } = {}) => {
    try {
      const data = await getDomains()
      if (!signal?.cancelled) setDomains(Array.isArray(data) ? data : [])
    } catch (error) {
      if (!signal?.cancelled) {
        setFeedback({
          severity: 'error',
          message:
            error?.response?.data?.message ||
            'No se pudieron cargar los dominios.',
        })
      }
    } finally {
      if (!signal?.cancelled) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const signal = { cancelled: false }
    cargar({ signal })
    return () => {
      signal.cancelled = true
    }
  }, [cargar])

  const propio = domains.find(d => d.type === 'custom_domain') || null
  const plataforma = domains.find(d => d.type === 'platform_subdomain') || null

  const hostnameDraft = normalizar(draft)
  const draftValido = HOSTNAME_RE.test(hostnameDraft)

  const ejecutar = async (accion, fn) => {
    setBusy(accion)
    setFeedback(null)

    try {
      const data = await fn()

      // El alta y la verificación devuelven las instrucciones; la baja no.
      if (data?.instructions !== undefined) setInstructions(data.instructions)
      if (data?.verified === false) {
        setFeedback({
          severity: 'info',
          message:
            'Todavía no vemos el registro TXT. Los cambios de DNS pueden tardar hasta unas horas en propagarse.',
        })
      }
      if (data?.verified === true) {
        setFeedback({
          severity: 'success',
          message: '¡Listo! Tu dominio ya funciona.',
        })
        setInstructions(null)
      }
      if (accion === 'add') setDraft('')
      if (accion === 'delete') setInstructions(null)

      await cargar()
    } catch (error) {
      setFeedback({
        severity: 'error',
        message:
          error?.response?.data?.message ||
          'No se pudo completar la operación.',
      })
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Tu dominio
        </Typography>
        {propio && <StatusChip status={propio.status} />}
      </Stack>

      {/* La dirección que siempre funciona. Se muestra primero y sin acciones:
          es el respaldo, y saber cuál es importa justo cuando el dominio propio
          no anda. */}
      {plataforma && (
        <Typography variant="body2" color="text.secondary">
          Tu tienda siempre está disponible en{' '}
          <Box component="strong" sx={{ fontFamily: 'monospace' }}>
            {plataforma.hostname}
          </Box>
          . Esa dirección no se puede quitar.
        </Typography>
      )}

      {feedback && (
        <Alert
          severity={feedback.severity}
          variant="outlined"
          sx={{ borderRadius: 2 }}
        >
          {feedback.message}
        </Alert>
      )}

      {!propio && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Si ya tenés un dominio propio, podés usarlo para tu tienda y para
            entrar a este panel. Necesitás poder editar su DNS.
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              fullWidth
              size="small"
              label="Tu dominio"
              placeholder="mitienda.com.ar"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              error={Boolean(hostnameDraft) && !draftValido}
              helperText={
                hostnameDraft && !draftValido
                  ? 'Va solo el nombre, sin https:// ni barras (ej: mitienda.com.ar).'
                  : ' '
              }
            />
            <Button
              variant="contained"
              disabled={!draftValido || busy === 'add'}
              onClick={() => ejecutar('add', () => addDomain(hostnameDraft))}
              sx={{
                borderRadius: 2,
                textTransform: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {busy === 'add' ? 'Agregando...' : 'Agregar'}
            </Button>
          </Stack>
        </Stack>
      )}

      {propio && propio.status !== 'active' && (
        <Stack spacing={2}>
          {/* Dice qué pasa AHORA, no qué va a pasar. Mientras esté pendiente el
              dominio no resuelve: el backend exige 'active'. */}
          <Alert severity="warning" variant="outlined" sx={{ borderRadius: 2 }}>
            <strong>{propio.hostname}</strong> todavía no funciona. Falta que
            crees el registro de abajo en el DNS de tu dominio y después
            verifiques. Mientras tanto, seguí usando{' '}
            {plataforma
              ? plataforma.hostname
              : 'el subdominio de la plataforma'}
            .
          </Alert>

          {instructions && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Tipo</TableCell>
                  <TableCell>Nombre</TableCell>
                  <TableCell>Valor</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell>{instructions.verification.type}</TableCell>
                  <TableCell>
                    <CopyableValue value={instructions.verification.name} />
                  </TableCell>
                  <TableCell>
                    <CopyableValue value={instructions.verification.value} />
                  </TableCell>
                </TableRow>
                {instructions.pointing?.value && (
                  <TableRow>
                    <TableCell>{instructions.pointing.type}</TableCell>
                    <TableCell>
                      <CopyableValue value={instructions.pointing.name} />
                    </TableCell>
                    <TableCell>
                      <CopyableValue value={instructions.pointing.value} />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          <Stack
            direction="row"
            spacing={1.5}
            sx={{ flexWrap: 'wrap', gap: 1 }}
          >
            <Button
              variant="contained"
              disabled={busy === 'verify'}
              onClick={() =>
                ejecutar('verify', () => verifyDomain(propio.hostname))
              }
              sx={{ borderRadius: 2, textTransform: 'none' }}
            >
              {busy === 'verify' ? 'Verificando...' : 'Verificar'}
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              disabled={busy === 'delete'}
              onClick={() =>
                ejecutar('delete', () => deleteDomain(propio.hostname))
              }
              sx={{ borderRadius: 2, textTransform: 'none' }}
            >
              {busy === 'delete' ? 'Quitando...' : 'Quitar dominio'}
            </Button>
          </Stack>

          {propio.lastCheckedAt && (
            <Typography variant="caption" color="text.secondary">
              Última comprobación:{' '}
              {new Date(propio.lastCheckedAt).toLocaleString('es-AR')}
            </Typography>
          )}
        </Stack>
      )}

      {propio && propio.status === 'active' && (
        <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="body2">
            Tu tienda y tu panel están disponibles en{' '}
            <Box component="strong" sx={{ fontFamily: 'monospace' }}>
              {propio.hostname}
            </Box>
            .
          </Typography>

          {/* El certificado lo emite el borde y puede tardar unos minutos
              después de verificar. Decirlo evita el ticket de "verifiqué y me
              da error de seguridad". */}
          {propio.sslStatus === 'pending' && (
            <Alert severity="info" variant="outlined" sx={{ borderRadius: 2 }}>
              Estamos emitiendo el certificado de seguridad. Puede tardar unos
              minutos; hasta entonces el navegador puede mostrar una
              advertencia.
            </Alert>
          )}

          <Button
            size="small"
            variant="outlined"
            color="inherit"
            disabled={busy === 'delete'}
            onClick={() =>
              ejecutar('delete', () => deleteDomain(propio.hostname))
            }
            sx={{ borderRadius: 2, textTransform: 'none' }}
          >
            {busy === 'delete' ? 'Quitando...' : 'Quitar dominio'}
          </Button>
        </Stack>
      )}
    </Stack>
  )
}
