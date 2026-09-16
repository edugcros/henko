// 📁 src/pages/PlatformAiSpendPage.jsx
//
// Gasto de IA de la plataforma contra el techo del mes.
//
// Hasta acá el ledger se escribía y lo leía una sola cosa: el aviso de
// presupuesto, que termina en una línea de log de Render. La información
// existía y no había forma de mirarla sin entrar a la base.
//
// Sin entrada en el menú lateral, igual que PlatformMarginPage: el gate real es
// server-side (requirePlatformOwner, allowlist de email) y no tiene sentido
// mostrarle a todos los admins un ítem que les va a devolver 403.

import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  getPlatformAiSpend,
  updatePlatformAiBudget,
  updateTenantAiPolicy,
} from '../services/platformService'

const formatUsd = value =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)

const formatTokens = value =>
  new Intl.NumberFormat('es-AR').format(Number(value) || 0)

const formatDate = value =>
  value ? new Date(value).toLocaleString('es-AR') : '—'

// Las etiquetas de las métricas del backend. Se escriben acá y no se derivan
// del nombre: 'agentTokens' no le dice nada a nadie que no haya leído el código.
const METRIC_LABELS = {
  vision: 'Análisis de imágenes',
  agentMessages: 'Mensajes del agente',
  agentTokens: 'Tokens del agente',
  imageEdits: 'Ediciones de imagen',
  marketAnalyses: 'Análisis de mercado',
  marketTokens: 'Tokens de mercado',
}

const metricLabel = metric => METRIC_LABELS[metric] || metric

/** Verde hasta el primer escalón de aviso, ámbar hasta el segundo, rojo después. */
const usageColor = percent => {
  if (percent === null) return 'info'
  if (percent >= 80) return 'error'
  if (percent >= 50) return 'warning'
  return 'success'
}

// De dónde sale el techo vigente. Se muestra porque un override que le gana en
// silencio a la variable de entorno convierte "ya lo cambié en Render y no pasa
// nada" en un misterio que cuesta media hora.
const BUDGET_SOURCE_LABEL = {
  panel: 'techo fijado desde el panel',
  env: 'techo tomado de la variable de entorno',
  none: 'sin techo configurado',
}

/**
 * Cambiar el techo mueve un límite de seguridad, así que no es un campo suelto
 * en la pantalla: es un diálogo que pide el motivo y muestra qué implica.
 */
function BudgetDialog({ open, budget, onClose, onSaved }) {
  const [tokens, setTokens] = useState('')
  const [usd, setUsd] = useState('')
  const [share, setShare] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Los valores vigentes al abrir, para poder comparar y mandar SOLO lo que
  // cambió. Sin esto, abrir el diálogo y guardar reescribiría los tres frenos
  // con el mismo motivo, ensuciando el historial con cambios que no ocurrieron.
  useEffect(() => {
    if (!open) return
    setTokens(budget.tokens === null ? '' : String(budget.tokens))
    setUsd(
      budget.usd === null || budget.usd === undefined ? '' : String(budget.usd),
    )
    setShare(
      budget.perTenantShare === null || budget.perTenantShare === undefined
        ? ''
        : String(budget.perTenantShare),
    )
    setReason('')
    setError('')
  }, [open, budget.tokens, budget.usd, budget.perTenantShare])

  /**
   * Un campo vacío significa "volver a la variable de entorno", no cero.
   *
   * La diferencia importa: un techo en cero apaga la IA, y ninguno la deja
   * gobernada por Render. Son dos decisiones distintas y la pantalla no puede
   * confundirlas.
   */
  const valorDe = texto => (String(texto).trim() === '' ? null : Number(texto))

  const submit = async ({ remove = false } = {}) => {
    setSaving(true)
    setError('')

    try {
      const data = await updatePlatformAiBudget(
        remove
          ? { tokens: null, usd: null, perTenantShare: null, reason }
          : {
              // Solo lo que se movió. Un campo que no cambió no viaja, así que
              // el historial registra el cambio que ocurrió y no tres.
              ...(String(tokens) !== String(budget.tokens ?? '')
                ? { tokens: valorDe(tokens) }
                : {}),
              ...(String(usd) !== String(budget.usd ?? '')
                ? { usd: valorDe(usd) }
                : {}),
              ...(String(share) !== String(budget.perTenantShare ?? '')
                ? { perTenantShare: valorDe(share) }
                : {}),
              reason,
            },
      )
      onSaved(data)
      onClose()
    } catch (err) {
      setError(err?.response?.data?.message || 'No se pudo cambiar el techo.')
    } finally {
      setSaving(false)
    }
  }

  // El motivo es obligatorio del lado del servidor también; acá solo evita el
  // viaje de ida y vuelta.
  //
  // NO se exige además que algo haya cambiado, aunque el submit solo mande lo
  // que se movió. Un botón deshabilitado sin decir por qué es más confuso que
  // el caso que evitaría: si no se cambió nada, el backend contesta «No se
  // indicó ningún freno para cambiar», que dice exactamente qué pasó.
  const canSubmit = reason.trim().length > 0 && !saving

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Cambiar el techo de gasto</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          El valor rige de inmediato y no necesita reiniciar el servicio. Queda
          registrado con tu email y el motivo.
        </Typography>

        <TextField
          label="Techo en tokens"
          type="number"
          fullWidth
          value={tokens}
          onChange={event => setTokens(event.target.value)}
          sx={{ mb: 2 }}
          helperText="Vacío = lo decide la variable de entorno. A tarifa de 2026, 200.000.000 de tokens son unos USD 270."
        />

        {/* El techo en PLATA, que es el que importa de verdad: el mismo tope de
            tokens puede costar veinte dólares o cien según qué modelo esté
            respondiendo, y eso lo decide la cadena de respaldo. Hasta ahora
            solo se podía tocar por variable de entorno en Render, sin motivo
            ni historial. */}
        <TextField
          label="Techo en dólares"
          type="number"
          fullWidth
          value={usd}
          onChange={event => setUsd(event.target.value)}
          sx={{ mb: 2 }}
          helperText="Vacío = lo decide la variable de entorno. Corta cuando el gasto del mes llega acá, aunque sobren tokens."
        />

        {/* El reparto por comercio: qué fracción del techo puede llevarse UNO.
            Es lo único que impide que un solo comercio se coma el presupuesto
            de todos. */}
        <TextField
          label="Reparto por comercio"
          type="number"
          fullWidth
          value={share}
          onChange={event => setShare(event.target.value)}
          sx={{ mb: 2 }}
          inputProps={{ step: 0.05, min: 0.01, max: 1 }}
          helperText={
            share && Number(share) > 0
              ? `Cada comercio puede usar hasta el ${Math.round(Number(share) * 100)}% del techo. Vacío = variable de entorno.`
              : 'Entre 0.01 y 1. Es el tope que impide que un solo comercio se lleve todo el presupuesto.'
          }
        />

        <TextField
          label="Motivo"
          fullWidth
          multiline
          minRows={2}
          value={reason}
          onChange={event => setReason(event.target.value)}
          placeholder="Ej.: cortó a las 3am por un bulk import de 4.000 imágenes"
          helperText="Obligatorio. Dentro de tres meses el número solo no explica nada."
        />

        {budget.source === 'panel' && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Hoy manda un valor fijado desde el panel, así que cambiar la
            variable de entorno en Render no tiene efecto. Podés devolverle el
            mando con «Volver a la variable», que suelta los tres frenos a la
            vez.
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        {budget.source === 'panel' && (
          <Button
            onClick={() => submit({ remove: true })}
            disabled={!canSubmit}
          >
            Volver a la variable
          </Button>
        )}
        <Button
          variant="contained"
          onClick={() => submit()}
          disabled={!canSubmit}
        >
          Guardar
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * Las dos palancas sobre UN comercio: acotarlo o apagarlo.
 *
 * POR QUÉ ES UN DIÁLOGO Y NO UN SWITCH EN LA FILA
 *
 * Apagarle la IA a un comercio es la acción más cara de esta pantalla y la
 * única irreversible desde el lado del comercio: él no puede volver a
 * prenderla. Un switch en la tabla la pone a un click de distancia de cualquier
 * scroll desprolijo, y sin motivo escrito no queda nadie que pueda explicar la
 * decisión dentro de tres meses.
 *
 * LAS DOS JUNTAS, Y NO EN DOS DIÁLOGOS
 *
 * Son la misma decisión sobre el mismo comercio, tomada con la misma
 * información a la vista. Separarlas obligaría a dos viajes para "bajale el
 * tope, y si sigue así apagalo".
 */
function TenantPolicyDialog({ row, budget, onClose, onSaved }) {
  const [share, setShare] = useState('')
  const [suspended, setSuspended] = useState(false)
  const [suspendedReason, setSuspendedReason] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Los valores vigentes al abrir, para poder comparar y mandar SOLO lo que
  // cambió — mismo criterio que el diálogo del techo.
  useEffect(() => {
    if (!row) return
    setShare(
      row.share === null || row.share === undefined ? '' : String(row.share),
    )
    setSuspended(row.suspended === true)
    setSuspendedReason(row.suspendedReason || '')
    setReason('')
    setError('')
  }, [row])

  // La página lo monta solo con comercio elegido; esto cubre cualquier otro
  // llamador. Va DESPUÉS de todos los hooks: un return temprano arriba
  // cambiaría la cantidad de hooks entre renders y rompe el orden.
  if (!row) return null

  // Vacío significa "usá la fracción global", no cero. La diferencia importa:
  // el backend distingue null (volver a la global) de no mandar el campo.
  const shareValue = String(share).trim() === '' ? null : Number(share)
  const shareEfectiva = shareValue ?? budget.perTenantShare ?? null

  // El tope que resulta, en tokens. Una fracción sola no le dice nada a nadie:
  // "0,1" es abstracto y "20.000.000 de tokens" es una decisión que se puede
  // comparar contra lo que el comercio ya consumió, que está en la misma fila.
  const topeResultante =
    budget.tokens && shareEfectiva
      ? Math.floor(budget.tokens * shareEfectiva)
      : null

  const submit = async () => {
    setSaving(true)
    setError('')

    try {
      const data = await updateTenantAiPolicy({
        tenantId: row.tenantId,
        ...(String(share) !== String(row.share ?? '')
          ? { share: shareValue }
          : {}),
        ...(suspended !== row.suspended
          ? { suspended, suspendedReason }
          : // El motivo visible puede cambiar sin que cambie el interruptor.
            suspended && suspendedReason !== (row.suspendedReason || '')
            ? { suspended: true, suspendedReason }
            : {}),
        reason,
      })

      onSaved(data)
      onClose()
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'No se pudo cambiar la política de este comercio.',
      )
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = reason.trim().length > 0 && !saving

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{row.name}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Este comercio lleva {formatTokens(row.tokens)} tokens y{' '}
          {formatUsd(row.platformCostUsd)} a cargo de HENKO en el período. Los
          cambios rigen de inmediato y solo afectan a este comercio.
        </Typography>

        <TextField
          label="Su parte del techo"
          type="number"
          fullWidth
          value={share}
          onChange={event => setShare(event.target.value)}
          sx={{ mb: 2 }}
          inputProps={{ step: 0.05, min: 0.01, max: 1 }}
          helperText={
            topeResultante
              ? `${Math.round(shareEfectiva * 100)}% del techo = ${formatTokens(topeResultante)} tokens para este comercio. Vacío = usa el reparto global.`
              : 'Entre 0.01 y 1. Vacío = usa el reparto global de la plataforma.'
          }
        />

        {/* El interruptor. Se separa visualmente del campo de arriba porque son
            decisiones de peso distinto: una acota, la otra apaga. */}
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={suspended}
                onChange={event => setSuspended(event.target.checked)}
                color="error"
              />
            }
            label="Pausar las funciones de IA de este comercio"
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block' }}
          >
            No se repone el mes que viene ni se levanta solo: lo tenés que
            volver a prender vos. Corta también si el comercio usa su propia
            clave.
          </Typography>

          {suspended && (
            <TextField
              label="Qué va a ver el comercio"
              fullWidth
              value={suspendedReason}
              onChange={event => setSuspendedReason(event.target.value)}
              sx={{ mt: 2 }}
              placeholder="Ej.: factura de agosto impaga"
              helperText="Se le muestra al comercio cuando intente usar la IA. Sin esto abre un ticket para preguntar qué pasó."
            />
          )}
        </Paper>

        <TextField
          label="Motivo"
          fullWidth
          multiline
          minRows={2}
          value={reason}
          onChange={event => setReason(event.target.value)}
          placeholder="Ej.: consumió el 60% del presupuesto del mes en tres días"
          helperText="Obligatorio, y es para adentro: queda con tu email en el registro del cambio."
        />

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={submit} disabled={!canSubmit}>
          Guardar
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function PlatformAiSpendPage() {
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)
  const [editing, setEditing] = useState(false)
  // El comercio cuya política se está editando, o null. Se guarda la fila
  // entera y no el id: el diálogo muestra su consumo para poder decidir con el
  // número a la vista, y volver a buscarlo en el reporte sería reconstruir algo
  // que ya se tenía en la mano.
  const [governing, setGoverning] = useState(null)

  const load = useCallback(async ({ signal } = {}) => {
    setLoading(true)
    setError('')
    setForbidden(false)

    try {
      const data = await getPlatformAiSpend()
      if (!signal?.cancelled) setReport(data)
    } catch (err) {
      if (signal?.cancelled) return

      if (err?.response?.status === 403) {
        setForbidden(true)
      } else {
        setError(
          err?.response?.data?.message || 'No se pudo cargar el gasto de IA.',
        )
      }
    } finally {
      if (!signal?.cancelled) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const signal = { cancelled: false }
    load({ signal })
    return () => {
      signal.cancelled = true
    }
  }, [load])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (forbidden) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 8 }}>
        <Alert severity="warning">No tenés acceso a este reporte.</Alert>
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', mt: 8 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  if (!report) return null

  const {
    budget,
    consumption,
    breaker,
    byMetric,
    byModel,
    quality,
    byTenant,
    forecast,
    degradation,
    anomalies,
    settingHistory,
  } = report
  const percent = consumption.percentUsed

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        Gasto de IA de la plataforma
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Período {report.period} · lo que paga HENKO por los comercios que usan
        la key compartida.
      </Typography>

      {breaker.tripped && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <strong>
            El disyuntor cortó el {formatDate(breaker.trippedAt)}.
          </strong>{' '}
          La IA está detenida para todos los comercios sobre la key de la
          plataforma. Los que tienen key propia siguen funcionando.
        </Alert>
      )}

      {/* EN QUÉ ESCALÓN DE SERVICIO ESTÁ.

          El servicio se degrada solo antes de cortar, y eso tiene que ser
          visible: un asistente que de golpe contesta peor, sin nada en pantalla
          que lo explique, se diagnostica como un bug del agente y se busca
          durante horas en el lugar equivocado.

          Solo aparece cuando hay degradación: en modo normal no hay nada que
          contar. */}
      {degradation && degradation.level !== 'normal' && !breaker.tripped && (
        <Alert
          severity={degradation.level === 'essential' ? 'error' : 'warning'}
          sx={{ mb: 2 }}
        >
          <strong>
            {degradation.level === 'essential'
              ? 'Solo lo esencial.'
              : 'Modo economía.'}
          </strong>{' '}
          El gasto va por el {degradation.percentUsed}% del techo, así que se
          está respondiendo con el modelo más barato de la cadena.
          {degradation.level === 'essential'
            ? ' Además están pospuestos el análisis de mercado y las ediciones de imagen. El asistente de las tiendas sigue contestando.'
            : ` A partir del ${degradation.essentialAt}% se posponen además el análisis de mercado y las ediciones de imagen.`}{' '}
          Se levanta solo cuando baja el consumo o arranca el mes.
        </Alert>
      )}

      {/* HACIA DÓNDE VA EL MES.

          Va arriba de todo —solo debajo del corte, que ya ocurrió— porque es lo
          único de esta pantalla que mira adelante. El resto dice cuánto se
          gastó, y para cuando ese número alarma, ya se gastó.

          Solo se muestra si va a pasarse: un cartel que aparece todos los
          meses diciendo «vas bien» enseña a no leerlo, y el porcentaje de
          consumo que está justo abajo ya cubre el caso tranquilo. */}
      {forecast?.willExhaust && !breaker.tripped && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>
            {forecast.exhaustionDay
              ? `Al ritmo actual, el techo se agota el día ${forecast.exhaustionDay}.`
              : 'Al ritmo actual, el mes cierra por encima del techo.'}
          </strong>{' '}
          Proyección: {formatUsd(forecast.projectedUsd)} sobre un techo de{' '}
          {formatUsd(budget.usd)} ({forecast.projectedPercent}%).{' '}
          {forecast.basis === 'recent'
            ? `Calculado con el ritmo de los últimos ${forecast.recentWindowDays} días (${formatUsd(forecast.recentAvgUsd)} por día), que viene más alto que el promedio del mes (${formatUsd(forecast.dailyAvgUsd)}).`
            : `Calculado con el promedio del mes, ${formatUsd(forecast.dailyAvgUsd)} por día.`}
        </Alert>
      )}

      {/* Sin techo configurado no hay nada que medir, y es una situación
          distinta de "el techo es cero". El backend manda null justamente para
          poder distinguirlas acá. */}
      {!budget.configured && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No hay disyuntor configurado (
          <code>AI_PLATFORM_MONTHLY_TOKEN_BUDGET</code>). El gasto se registra,
          pero <strong>nada lo detiene</strong>.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'baseline' }}
          spacing={1}
        >
          <Typography variant="h4" sx={{ fontWeight: 600 }}>
            {formatUsd(consumption.estimatedCostUsd)}
          </Typography>
          {percent !== null && (
            <Typography variant="body2" color="text.secondary">
              {formatTokens(consumption.tokens)} de{' '}
              {formatTokens(budget.tokens)} tokens
              {' · '}
              quedan {formatTokens(consumption.remainingTokens)}
            </Typography>
          )}
        </Stack>

        {percent !== null && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, percent)}
              color={usageColor(percent)}
              sx={{ height: 10, borderRadius: 5 }}
            />
            <Stack
              direction="row"
              justifyContent="space-between"
              sx={{ mt: 0.75 }}
            >
              <Typography variant="caption" color="text.secondary">
                {percent}% del techo
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Avisos al 50% y al 80%
                {budget.alertedThreshold > 0
                  ? ` · último enviado: ${budget.alertedThreshold}%`
                  : ' · ninguno enviado todavía'}
              </Typography>
            </Stack>
          </Box>
        )}

        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ mt: 2 }}
        >
          <Typography variant="caption" color="text.secondary">
            Última actividad: {formatDate(consumption.lastActivityAt)}
            {' · '}
            {BUDGET_SOURCE_LABEL[budget.source] || budget.source}
            {/* El ritmo diario también cuando NO alarma: es el número contra el
                que se compara cualquier cambio, y verlo solo el día que salta
                la alerta no deja con qué compararlo. */}
            {forecast?.dailyAvgUsd > 0 && (
              <>
                {' · '}
                {formatUsd(forecast.dailyAvgUsd)} por día en{' '}
                {forecast.daysElapsed}{' '}
                {forecast.daysElapsed === 1 ? 'día cerrado' : 'días cerrados'}
                {forecast.projectedUsd !== null &&
                  ` · proyectado al cierre: ${formatUsd(forecast.projectedUsd)}`}
              </>
            )}
          </Typography>
          <Button size="small" onClick={() => setEditing(true)}>
            Cambiar techo
          </Button>
        </Stack>
      </Paper>

      <BudgetDialog
        open={editing}
        budget={budget}
        onClose={() => setEditing(false)}
        onSaved={setReport}
      />

      {/* Se MONTA solo cuando hay comercio elegido, en vez de estar siempre
          montado con un `open`. Así el formulario nace limpio en cada apertura
          y no puede arrastrar lo tipeado para otro comercio — que sería el peor
          error posible acá, porque el cambio se aplicaría sobre el equivocado. */}
      {governing && (
        <TenantPolicyDialog
          row={governing}
          budget={budget}
          onClose={() => setGoverning(null)}
          onSaved={setReport}
        />
      )}

      {/* COMERCIOS FUERA DE SU PROPIA COSTUMBRE.

          Va arriba de la tabla de consumo porque contesta una pregunta que esa
          tabla no puede: la tabla ordena por cuánto gastan, y el desborde
          típico es un comercio CHICO que multiplicó por cincuenta lo suyo y
          sigue en la mitad de abajo de la lista.

          Solo aparece cuando hay algo: una sección vacía que está siempre
          enseña a saltearla. */}
      {anomalies?.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {anomalies.length === 1
              ? 'Un comercio está gastando fuera de lo habitual'
              : `${anomalies.length} comercios están gastando fuera de lo habitual`}
          </Typography>
          <Stack spacing={0.5}>
            {anomalies.map(row => (
              <Typography variant="body2" key={row.tenantId}>
                <strong>{row.name}</strong>: {formatUsd(row.todayUsd)} hoy en{' '}
                {formatTokens(row.todayOperations)}{' '}
                {row.todayOperations === 1 ? 'operación' : 'operaciones'}
                {/* factor null = venía de cero. No hay múltiplo que calcular y
                    decir "infinitas veces más" no ayuda a nadie. */}
                {row.factor === null
                  ? ', cuando no venía consumiendo nada'
                  : `, ${row.factor}× su habitual de ${formatUsd(row.typicalUsd)} por día`}
                .
              </Typography>
            ))}
          </Stack>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 1 }}
          >
            Se compara contra la mediana de sus propios días del mes, no contra
            el techo: un comercio chico puede multiplicar por cincuenta lo suyo
            y seguir lejísimos de su tope. Con «Gobernar», en la tabla de abajo,
            se lo acota o se lo pausa.
          </Typography>
        </Alert>
      )}

      {/* QUIÉN se lo gastó.

          Es la tabla que convierte un total en algo sobre lo que se puede
          actuar. Todo el resto de la pantalla es agregado, y ninguna de esas
          vistas contesta la pregunta que uno se hace cuando el disyuntor
          corta.

          Va ARRIBA de "qué lo consume" a propósito: con un techo compartido,
          saber quién antes que qué es lo que decide si hay que hablar con
          alguien o cambiar de modelo. */}
      {byTenant?.length > 0 && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Quién lo consume
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Comercio</TableCell>
                  <TableCell align="right">Paga HENKO</TableCell>
                  <TableCell align="right">Tokens</TableCell>
                  <TableCell align="right">De su parte</TableCell>
                  <TableCell align="right">Operaciones</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {byTenant.map(row => (
                  <TableRow key={row.tenantId} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {row.name}
                      </Typography>
                      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                        {row.plan && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={row.plan}
                          />
                        )}
                        {/* Con key propia el comercio le paga a Google, no a
                            HENKO: ver un cero en la columna de costo sin esta
                            marca se lee como un error. */}
                        {row.keySources?.includes('tenant') && (
                          <Tooltip title="Usa su propia clave: parte de su consumo no le cuesta a HENKO">
                            <Chip
                              size="small"
                              color="info"
                              variant="outlined"
                              label="key propia"
                            />
                          </Tooltip>
                        )}
                        {/* Un comercio apagado deja de consumir, así que sus
                            números de la fila son ceros y sin esta marca se
                            leería como un comercio que simplemente no usó la
                            IA. La diferencia es que a este lo apagamos
                            nosotros. */}
                        {row.suspended && (
                          <Tooltip
                            title={
                              row.suspendedReason ||
                              'Sin motivo cargado: el comercio ve un mensaje genérico'
                            }
                          >
                            <Chip size="small" color="error" label="pausado" />
                          </Tooltip>
                        )}
                        {/* Solo cuando tiene fracción propia: un comercio con
                            la global no tiene nada que señalar. */}
                        {row.share !== null && row.share !== undefined && (
                          <Tooltip title="Tiene un tope propio, distinto del reparto global">
                            <Chip
                              size="small"
                              color="warning"
                              variant="outlined"
                              label={`acotado ${Math.round(row.share * 100)}%`}
                            />
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {formatUsd(row.platformCostUsd)}
                      </Typography>
                      {/* Lo que el proveedor le cobró a la key usada. Solo se
                          muestra cuando difiere, que es exactamente el caso
                          BYOK: si no, sería el mismo número dos veces. */}
                      {row.tenantProviderCostUsd > row.platformCostUsd && (
                        <Typography variant="caption" color="text.secondary">
                          {formatUsd(row.tenantProviderCostUsd)} con su key
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {formatTokens(row.tokens)}
                    </TableCell>
                    <TableCell align="right">
                      {/* El porcentaje de SU parte, no del total de la
                          plataforma. Es el número que anticipa el corte: un
                          comercio al 90% de su parte se queda sin IA aunque la
                          plataforma vaya al 30%. */}
                      {row.percentOfCap === null ? (
                        <Typography variant="body2" color="text.secondary">
                          sin tope
                        </Typography>
                      ) : (
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: row.percentOfCap >= 80 ? 600 : 400,
                          }}
                          color={
                            row.percentOfCap >= 80
                              ? 'error.main'
                              : row.percentOfCap >= 50
                                ? 'warning.main'
                                : 'text.secondary'
                          }
                        >
                          {row.percentOfCap}%
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {formatTokens(row.operations)}
                    </TableCell>
                    {/* La acción va en la misma fila donde está el número que
                        la justifica. Mandarla a otra pantalla obligaría a
                        recordar qué comercio era y cuánto llevaba. */}
                    <TableCell align="right">
                      <Button size="small" onClick={() => setGoverning(row)}>
                        Gobernar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: 3, mt: -2 }}
          >
            «De su parte» es contra el tope de CADA comercio
            {budget.perTenantShare
              ? ` (${Math.round(budget.perTenantShare * 100)}% del techo salvo a los que tengan uno propio)`
              : ''}
            , no contra el techo total: un comercio puede quedarse sin IA con la
            plataforma al 30%. Con «Gobernar» se le baja el tope a uno solo, o
            se le pausa la IA, sin tocar a los demás.
          </Typography>
        </>
      )}

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        Qué lo consume
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Función</TableCell>
              <TableCell align="right">Costo</TableCell>
              <TableCell align="right">Tokens</TableCell>
              <TableCell align="right">Operaciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {byMetric.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography variant="body2" color="text.secondary">
                    Todavía no hay consumo registrado en este período.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {byMetric.map(row => (
              <TableRow key={row.metric}>
                <TableCell>{metricLabel(row.metric)}</TableCell>
                <TableCell align="right">{formatUsd(row.costUsd)}</TableCell>
                <TableCell align="right">{formatTokens(row.tokens)}</TableCell>
                <TableCell align="right">
                  {formatTokens(row.operations)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        Por modelo
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Si el gasto se concentra en un modelo caro, cambiar de modelo es una
        palanca que no requiere tocar el producto.
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Modelo</TableCell>
              <TableCell align="right">Costo</TableCell>
              <TableCell align="right">Tokens</TableCell>
              <TableCell align="right">Operaciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {byModel.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography variant="body2" color="text.secondary">
                    Sin datos por modelo todavía.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {byModel.map(row => (
              <TableRow key={row.model}>
                <TableCell>
                  {row.model}
                  {row.fallbackRows > 0 && (
                    <Tooltip title="Este modelo no está en el catálogo de precios: se cobró con la tarifa conservadora, así que su costo está inflado. Conviene agregarlo.">
                      <Chip
                        size="small"
                        color="warning"
                        variant="outlined"
                        label={`${row.fallbackRows} sin tarifa`}
                        sx={{ ml: 1 }}
                      />
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell align="right">{formatUsd(row.costUsd)}</TableCell>
                <TableCell align="right">{formatTokens(row.tokens)}</TableCell>
                <TableCell align="right">
                  {formatTokens(row.operations)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Qué tan confiable es el número de arriba. Va en la pantalla y no en
          una nota al pie porque cambia cómo hay que leerlo: un costo repartido
          con una proporción supuesta y uno medido no son el mismo dato. */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          Calidad de la medición
        </Typography>
        {/* El porcentaje primero: es la respuesta a "¿me puedo fiar del
            total?" sin tener que sumar nada mentalmente. */}
        {quality.measuredShare !== null &&
          quality.measuredShare !== undefined && (
            <Typography
              variant="h6"
              sx={{ fontWeight: 600, mb: 1 }}
              color={
                quality.measuredShare >= 95 ? 'success.main' : 'warning.main'
              }
            >
              {quality.measuredShare}% del gasto en tokens está medido
            </Typography>
          )}

        {/* Las cuatro clases son EXCLUYENTES y suman el total, así que la
            columna de plata se puede leer como un reparto y no como cuatro
            números sueltos que se pisan. */}
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <Typography variant="body2" color="text.secondary">
            {formatTokens(quality.measured ?? quality.rows)} medidos
            {quality.measuredCostUsd !== undefined &&
              ` · ${formatUsd(quality.measuredCostUsd)}`}
          </Typography>
          <Typography
            variant="body2"
            color={
              quality.estimatedRows > 0 ? 'warning.main' : 'text.secondary'
            }
          >
            {formatTokens(quality.estimatedRows)} con costo repartido
            {quality.estimatedCostUsd !== undefined &&
              ` · ${formatUsd(quality.estimatedCostUsd)}`}
          </Typography>
          <Typography
            variant="body2"
            color={quality.fallbackRows > 0 ? 'warning.main' : 'text.secondary'}
          >
            {formatTokens(quality.fallbackRows)} con tarifa de respaldo
            {quality.fallbackCostUsd !== undefined &&
              ` · ${formatUsd(quality.fallbackCostUsd)}`}
          </Typography>
          {/* El peor caso va en error y no en warning: no saber la tarifa es
              cobrar de más o de menos; no saber el modelo es no saber nada. */}
          <Typography
            variant="body2"
            color={quality.unknownModel > 0 ? 'error.main' : 'text.secondary'}
          >
            {formatTokens(quality.unknownModel ?? 0)} sin modelo conocido
            {quality.unknownModelCostUsd !== undefined &&
              ` · ${formatUsd(quality.unknownModelCostUsd)}`}
          </Typography>
        </Stack>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 1.5 }}
        >
          Sobre {formatTokens(quality.rows)} movimientos de tokens
          {quality.costUsd !== undefined && ` (${formatUsd(quality.costUsd)})`}.
          {quality.flatRate?.rows > 0 && (
            <>
              {' '}
              Aparte, {formatTokens(quality.flatRate.rows)} movimientos de
              precio por unidad ({formatUsd(quality.flatRate.costUsd)}):
              imágenes y mensajes no se cobran por token, así que no hay
              desglose que medir ni suponer y no entran en el porcentaje.
            </>
          )}{' '}
          Los ocho llamadores informan el desglose real que devuelve el
          proveedor; repartir el total con una proporción supuesta quedó como
          último recurso y sale por log cuando ocurre.
        </Typography>
      </Paper>

      {settingHistory?.length > 0 && (
        <>
          <Typography
            variant="subtitle1"
            sx={{ fontWeight: 600, mt: 3, mb: 1 }}
          >
            Cambios de límites
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Cuándo</TableCell>
                  <TableCell>Quién</TableCell>
                  <TableCell>Cambio</TableCell>
                  <TableCell>Motivo</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {settingHistory.map(row => (
                  <TableRow key={`${row.setting}-${row.createdAt}`}>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                    <TableCell>{row.changedByEmail}</TableCell>
                    <TableCell>
                      {row.previousValue === null
                        ? 'variable de entorno'
                        : formatTokens(row.previousValue)}
                      {' → '}
                      {row.value === null
                        ? 'variable de entorno'
                        : formatTokens(row.value)}
                    </TableCell>
                    <TableCell>{row.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 3 }}
      >
        El techo se cambia desde acá y rige de inmediato. Los límites por plan y
        la fracción por comercio siguen en variables de entorno de Render, que
        requieren reiniciar el servicio — son decisiones de producto, no
        maniobras de urgencia.
      </Typography>
    </Box>
  )
}
