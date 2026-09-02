// 📁 admin/src/components/aiBudget/AiBudgetPanel.jsx
//
// Consumo de IA del mes y alta de API key propia.
//
// Reemplaza a los dos campos de "cuota" que esta pantalla mostraba antes.
// Aquellos números eran editables pero ya no son el tope real (el tope lo fija
// el plan, ver backend/docs/AI_COST_CONTAINMENT.md): mostrarlos como si lo
// fueran hacía que un comercio creyera que se ampliaba el cupo escribiendo un
// número más grande.
//
// Forma elegida: un MEDIDOR por métrica, no un gráfico. Cada dato es una sola
// razón contra un tope — la relación se lee de un vistazo en una barra y se
// pierde en cualquier gráfico de torta o de barras.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Link,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined'
import {
  deleteAiCredentials,
  getAiBudget,
  saveAiCredentials,
} from '../../services/aiBudgetService.js'

const PLAN_LABELS = {
  free: 'Gratis',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

// Orden fijo: el más caro y el más consultado primero. No se reordena por
// valor — un medidor que cambia de lugar según cuánto se usó obliga a
// releer la pantalla entera cada vez.
const METRIC_ORDER = ['agentMessages', 'agentTokens', 'vision', 'imageEdits']

const METRIC_TITLES = {
  agentMessages: 'Mensajes del asistente',
  agentTokens: 'Tokens del asistente',
  vision: 'Análisis de imágenes',
  imageEdits: 'Fondos generados con IA',
}

const formatNumber = value => {
  const number = Number(value || 0)
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`
  if (number >= 10_000) return `${Math.round(number / 1000)}K`
  return number.toLocaleString('es-AR')
}

/**
 * La severidad la decide el porcentaje, y siempre viaja con texto propio:
 * el color solo nunca alcanza (daltonismo, impresión, modo alto contraste).
 */
const getSeverity = (used, limit) => {
  if (!limit) return { level: 'ok', color: 'primary', label: 'Sin límite' }

  const ratio = used / limit

  if (ratio >= 1) {
    return {
      level: 'critical',
      color: 'error',
      label: 'Sin cupo',
      Icon: ErrorOutlineIcon,
    }
  }

  if (ratio >= 0.85) {
    return {
      level: 'warning',
      color: 'warning',
      label: 'Por agotarse',
      Icon: WarningAmberIcon,
    }
  }

  return { level: 'ok', color: 'primary', label: 'En rango' }
}

const MetricMeter = ({ metric, data }) => {
  const used = Number(data?.used || 0)
  const limit = Number(data?.limit || 0)
  const severity = getSeverity(used, limit)
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="baseline"
        spacing={1}
        mb={0.75}
      >
        <Typography variant="body2" color="text.primary" fontWeight={600}>
          {METRIC_TITLES[metric] || data?.label || metric}
        </Typography>

        {/* El número usa tinta de texto, no el color del medidor: el color es
            del dato, la tipografía es de la interfaz. */}
        <Typography variant="body2" color="text.secondary">
          {data?.unlimited
            ? `${formatNumber(used)} · sin límite`
            : `${formatNumber(used)} / ${formatNumber(limit)}`}
        </Typography>
      </Stack>

      {/* Sin tope no hay razón que medir, y una barra vacía se leería como
          "0% usado" contra un límite invisible. En ese caso el dato es el
          número solo, sin medidor. */}
      {!data?.unlimited && (
        <LinearProgress
          variant="determinate"
          value={percent}
          color={severity.color}
          sx={{
            height: 8,
            borderRadius: 4,
            // La pista es un paso más claro del mismo color, para que el
            // estado se lea en toda la barra y no solo en la parte llena.
            '& .MuiLinearProgress-bar': { borderRadius: 4 },
          }}
        />
      )}

      {severity.Icon && (
        <Stack direction="row" spacing={0.5} alignItems="center" mt={0.75}>
          <severity.Icon fontSize="small" color={severity.color} sx={{ fontSize: 16 }} />
          <Typography variant="caption" color="text.secondary">
            {severity.label}
            {severity.level === 'critical' &&
              ' — se renueva el mes que viene, o podés subir de plan.'}
          </Typography>
        </Stack>
      )}
    </Box>
  )
}

const ByokSection = ({ credentials, onSaved, onCleared }) => {
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setBusy(true)
    setError('')

    try {
      const budget = await saveAiCredentials(apiKey.trim())
      setApiKey('')
      onSaved(budget)
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'No se pudo guardar la API key.')
    } finally {
      setBusy(false)
    }
  }

  const handleClear = async () => {
    setBusy(true)
    setError('')

    try {
      const budget = await deleteAiCredentials()
      onCleared(budget)
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'No se pudo desactivar la API key.')
    } finally {
      setBusy(false)
    }
  }

  if (!credentials?.byokAllowed) {
    return (
      <Alert severity="info" variant="outlined" sx={{ borderRadius: 2 }}>
        Con el plan Pro podés conectar tu propia cuenta de Google: el consumo de IA deja de contar
        contra estos límites y se factura directamente en tu cuenta.
      </Alert>
    )
  }

  if (credentials?.hasTenantKey) {
    return (
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <CheckCircleOutlineIcon color="success" fontSize="small" />
          <Typography variant="body2" color="text.primary">
            Estás usando tu propia API key. El consumo de IA se factura en tu cuenta de Google y no
            consume los límites del plan.
          </Typography>
        </Stack>

        {error && (
          <Alert severity="error" variant="outlined" sx={{ borderRadius: 2 }}>
            {error}
          </Alert>
        )}

        <Box>
          <Button
            variant="outlined"
            color="inherit"
            size="small"
            onClick={handleClear}
            disabled={busy}
            sx={{ borderRadius: 2, textTransform: 'none' }}
          >
            {busy ? 'Desactivando...' : 'Volver a los límites del plan'}
          </Button>
        </Box>
      </Stack>
    )
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        Conectá tu propia cuenta de Google para que el consumo de IA se facture ahí y deje de contar
        contra los límites del plan. La key se guarda cifrada y no se vuelve a mostrar.{' '}
        <Link href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
          Obtener una API key
        </Link>
      </Typography>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ borderRadius: 2 }}>
          {error}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          fullWidth
          size="small"
          type="password"
          label="API key de Google AI"
          placeholder="AIza..."
          value={apiKey}
          onChange={event => setApiKey(event.target.value)}
          autoComplete="off"
        />
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={busy || !apiKey.trim()}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <KeyOutlinedIcon />}
          sx={{ borderRadius: 2, textTransform: 'none', whiteSpace: 'nowrap' }}
        >
          {busy ? 'Verificando...' : 'Conectar'}
        </Button>
      </Stack>
    </Stack>
  )
}

const AiBudgetPanel = () => {
  const [budget, setBudget] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      setBudget(await getAiBudget())
    } catch (err) {
      console.error('[AI_BUDGET_LOAD_ERROR]', err)
      setError(
        err?.response?.data?.message || err?.message || 'No se pudo cargar el consumo de IA.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const metrics = useMemo(() => {
    if (!budget?.metrics) return []

    return METRIC_ORDER.filter(metric => budget.metrics[metric]).map(metric => ({
      metric,
      data: budget.metrics[metric],
    }))
  }, [budget])

  if (loading) {
    return (
      <Stack alignItems="center" py={3}>
        <CircularProgress size={24} />
      </Stack>
    )
  }

  if (error) {
    return (
      <Alert severity="error" variant="outlined" sx={{ borderRadius: 2 }}>
        {error}
      </Alert>
    )
  }

  if (!budget) return null

  const usingOwnKey = budget.credentials?.source === 'tenant'

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip
          size="small"
          label={`Plan ${PLAN_LABELS[budget.plan] || budget.plan}`}
          color="primary"
          variant="outlined"
        />
        <Chip size="small" label={`Período ${budget.period}`} variant="outlined" />
        {usingOwnKey && (
          <Chip
            size="small"
            color="success"
            variant="outlined"
            icon={<KeyOutlinedIcon />}
            label="API key propia"
          />
        )}
        {budget.estimatedCostUsd > 0 && (
          <Tooltip title="Estimación sobre los tokens consumidos. Sirve para dimensionar el uso, no es una factura.">
            <Chip
              size="small"
              variant="outlined"
              label={`≈ USD ${budget.estimatedCostUsd.toFixed(2)}`}
            />
          </Tooltip>
        )}
      </Stack>

      {!budget.subscription?.entitled && (
        <Alert severity="warning" variant="outlined" sx={{ borderRadius: 2 }}>
          Las funciones de IA están pausadas porque la suscripción no está al día. El resto de la
          tienda sigue funcionando con normalidad.
        </Alert>
      )}

      {usingOwnKey ? (
        <Alert severity="success" variant="outlined" sx={{ borderRadius: 2 }}>
          El consumo de este mes corre por tu propia cuenta de Google. Se sigue registrando abajo
          para que puedas dimensionarlo, pero no tiene tope.
        </Alert>
      ) : null}

      <Stack spacing={2.25}>
        {metrics.map(({ metric, data }) => (
          <MetricMeter key={metric} metric={metric} data={data} />
        ))}
      </Stack>

      <Divider />

      <ByokSection credentials={budget.credentials} onSaved={setBudget} onCleared={setBudget} />
    </Stack>
  )
}

export default AiBudgetPanel
