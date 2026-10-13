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

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
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
  getTenantAiSpendDetail,
  updatePlatformAiBudget,
  updateTenantAiPolicy,
  getUsdRate,
  updateUsdRate,
  getPlatformMarginReport,
  updateTenantStatus,
  deleteTenant,
} from '../services/platformService'

const formatUsd = value =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)

/**
 * Pesos, sin centavos.
 *
 * Los centavos no aportan nada aca: un costo de IA de 4.237,18 pesos se decide
 * igual que uno de 4.237, y la columna con decimales es mas dificil de barrer
 * con la vista. El dolar si los lleva, porque ahi los montos son chicos y 0,04
 * contra 0,00 es la diferencia entre "algo" y "nada".
 */
const formatArs = value =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0)

/**
 * Un costo en dolares, mostrado en pesos.
 *
 * POR QUE PESOS ADELANTE Y NO SOLO DOLARES
 *
 * Esta pantalla estaba entera en dolares, que es la moneda en la que facturan
 * los proveedores de IA pero no la del negocio. Los planes se cobran en pesos,
 * asi que "este comercio me costo USD 3,80" no se puede comparar mentalmente
 * con "me paga 40.000 pesos" sin hacer la cuenta en la cabeza con un dolar que
 * uno cree recordar.
 *
 * POR QUE EL DOLAR NO SE BORRA
 *
 * Porque es lo que el proveedor factura de verdad. El peso es una conversion
 * nuestra, hecha con un tipo de cambio que alguien cargo a mano y puede estar
 * viejo. Sin tipo de cambio no se inventa una conversion: se muestra el dolar.
 */
const formatMoney = (valorUsd, rate) => {
  if (!Number.isFinite(rate) || rate <= 0) return formatUsd(valorUsd)

  return formatArs((Number(valorUsd) || 0) * rate)
}

/**
 * El tipo de cambio vigente, para todo lo que esta pantalla muestra.
 *
 * Va en un contexto y no en props porque los montos aparecen en media docena de
 * lugares anidados —el dialogo de politica, las tablas, el pronostico— y hacer
 * bajar el mismo numero por cada nivel es la clase de cableado que despues nadie
 * mantiene: alcanza con que un componente nuevo se olvide de recibirlo para que
 * muestre dolares donde todo lo demas muestra pesos.
 */
const TipoDeCambioContext = createContext(null)

/** `dinero(x)` da pesos cuando hay cambio cargado y dólares cuando no. */
const useDinero = () => {
  const rate = useContext(TipoDeCambioContext)

  return useMemo(() => ({ dinero: valorUsd => formatMoney(valorUsd, rate), rate }), [rate])
}

const formatTokens = value => new Intl.NumberFormat('es-AR').format(Number(value) || 0)

const formatDate = value => (value ? new Date(value).toLocaleString('es-AR') : '—')

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
    setUsd(budget.usd === null || budget.usd === undefined ? '' : String(budget.usd))
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
              ...(String(usd) !== String(budget.usd ?? '') ? { usd: valorDe(usd) } : {}),
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
          El valor rige de inmediato y no necesita reiniciar el servicio. Queda registrado con tu
          email y el motivo.
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
            Hoy manda un valor fijado desde el panel, así que cambiar la variable de entorno en
            Render no tiene efecto. Podés devolverle el mando con «Volver a la variable», que suelta
            los tres frenos a la vez.
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
          <Button onClick={() => submit({ remove: true })} disabled={!canSubmit}>
            Volver a la variable
          </Button>
        )}
        <Button variant="contained" onClick={() => submit()} disabled={!canSubmit}>
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
/**
 * El margen de un comercio, en pesos y en porcentaje.
 *
 * POR QUÉ LOS DOS NÚMEROS Y NO UNO
 *
 * Un comercio que deja $8.000 sobre un plan de $10.000 y otro que deja $8.000
 * sobre uno de $40.000 son negocios completamente distintos, y en la columna de
 * pesos se ven idénticos. El porcentaje es lo que permite ordenarlos y decidir
 * si un plan está mal puesto.
 *
 * `null` no es cero: quiere decir que el plan no tiene precio cargado, así que
 * no hay ingreso contra el que restar. Mostrar un cero ahí se leería como "no
 * deja nada", que es una afirmación sobre el negocio que nadie hizo.
 */
function MargenDelComercio({ margen }) {
  if (!margen) {
    return (
      <Tooltip title="Este comercio no aparece en el reporte de margen">
        <Typography variant="body2" color="text.disabled">
          —
        </Typography>
      </Tooltip>
    )
  }

  if (margen.estimatedMarginArs === null) {
    return (
      <Tooltip title="El plan de este comercio no tiene precio cargado, así que no hay ingreso contra el que restar el costo">
        <Typography variant="body2" color="text.disabled">
          sin precio
        </Typography>
      </Tooltip>
    )
  }

  return (
    <>
      <Typography
        variant="body2"
        sx={{ fontWeight: 600 }}
        color={margen.unprofitable ? 'error.main' : 'success.main'}
      >
        {formatArs(margen.estimatedMarginArs)}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {margen.marginPercent === null ? 'sobre plan sin precio' : `${margen.marginPercent}%`}
        {/* Cuesta más de lo que paga: la única fila sobre la que hay que hacer
            algo, y sin marcarla se pierde entre las demás. */}
        {margen.unprofitable && ' · pierde plata'}
      </Typography>
    </>
  )
}

/**
 * Cuánto subió o bajó este comercio contra el mes anterior.
 *
 * POR QUÉ ESTA COLUMNA Y NO MÁS PORCENTAJES DE TECHO
 *
 * Todas las demás comparan contra un TOPE, y eso deja ciego al caso que más
 * plata cuesta: el comercio que se desliza. Duplica su consumo todos los meses
 * y sigue lejos de su techo, así que no enciende ninguna alarma hasta que ya se
 * comió el presupuesto. Acá se lo compara contra SÍ MISMO.
 *
 * Es distinto del detector de anomalías, que mira un día contra los días del
 * mismo mes y sirve para el salto brusco. Esto ve la pendiente.
 */
const TRIPLICO = 100
const SUBIO_FUERTE = 25

function TendenciaDelComercio({ row, comparison }) {
  const { dinero } = useDinero()

  // Sin días cerrados —el día 1 del mes— o sin gasto el mes pasado no hay
  // porcentaje que calcular. Son dos situaciones distintas y se dicen distinto:
  // la primera es "todavía no se puede saber", la segunda es "antes no gastaba".
  if (row.comparableUsd === null || row.comparableUsd === undefined) {
    return (
      <Tooltip title="Recién empieza el mes: todavía no hay ningún día cerrado contra el cual comparar">
        <Typography variant="body2" color="text.disabled">
          —
        </Typography>
      </Tooltip>
    )
  }

  const dias = comparison?.days
  const ventana = dias
    ? `los primeros ${dias} ${dias === 1 ? 'día' : 'días'} de cada mes`
    : 'el mismo tramo de cada mes'

  if (row.changePercent === null || row.changePercent === undefined) {
    // Gasta ahora y no gastaba antes. No hay múltiplo —dividir por cero daría
    // infinito— pero el caso es real y es justo el que hay que mirar.
    if (row.comparableUsd > 0) {
      return (
        <Tooltip title={`No tenía consumo en ${ventana} del mes anterior`}>
          <Chip size="small" color="warning" variant="outlined" label="nuevo" />
        </Tooltip>
      )
    }

    return (
      <Typography variant="body2" color="text.disabled">
        —
      </Typography>
    )
  }

  const subio = row.changePercent > 0
  const color =
    row.changePercent >= TRIPLICO
      ? 'error.main'
      : row.changePercent >= SUBIO_FUERTE
        ? 'warning.main'
        : row.changePercent <= -SUBIO_FUERTE
          ? 'success.main'
          : 'text.secondary'

  return (
    <Tooltip
      title={`${dinero(row.comparableUsd)} contra ${dinero(row.previousComparableUsd)} en ${ventana}. El mes anterior completo fueron ${dinero(row.previousUsd)}.`}
    >
      <Typography
        variant="body2"
        color={color}
        sx={{ fontWeight: Math.abs(row.changePercent) >= SUBIO_FUERTE ? 600 : 400 }}
      >
        {/* El signo se escribe a mano: un "+" adelante es lo que hace que la
            columna se barra con la vista sin leer el número. */}
        {subio ? '+' : ''}
        {row.changePercent}%
      </Typography>
    </Tooltip>
  )
}

/**
 * Suspender el comercio entero, o reactivarlo.
 *
 * QUÉ HACE Y QUÉ NO
 *
 * Mueve el estado del comercio. NO borra nada: productos, órdenes, clientes e
 * historial de facturación quedan intactos, y se puede volver atrás en un clic.
 *
 * El corte ya estaba implementado: tenantMiddleware resuelve únicamente
 * comercios activos, así que un suspendido deja de responder tanto en su tienda
 * como en su panel.
 *
 * POR QUÉ SUSPENDER Y NO BORRAR
 *
 * El caso que motiva esta pantalla es un comercio que cuesta más de lo que
 * paga, y para eso frenarlo alcanza. Borrarlo sería irreversible justo con los
 * datos que harían falta si después discute un cobro o reclama. Es la decisión
 * que se puede deshacer, y para algo que le corta el servicio a alguien que
 * paga, poder deshacerla vale más que ahorrar espacio.
 */
function SuspensionDelComercio({ row, onSaved, onClose }) {
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  // El reporte de gasto no trae el estado del comercio, así que lo que se sabe
  // acá es lo que el margen informó. Sin ese dato se asume activo: ofrecer
  // "suspender" sobre un comercio ya suspendido es un error recuperable, y el
  // backend lo deja en el mismo estado.
  const estaSuspendido = row?.tenantStatus === 'suspended'

  const aplicar = async () => {
    if (!estaSuspendido && !motivo.trim()) {
      setError('Indicá por qué se suspende. Queda con tu email, por si el comercio reclama.')
      return
    }

    setGuardando(true)
    setError('')

    try {
      await updateTenantStatus({
        tenantId: row.tenantId,
        suspended: !estaSuspendido,
        reason: motivo.trim(),
      })
      setAbierto(false)
      await onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err?.response?.data?.message || 'No se pudo cambiar el estado del comercio.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, mt: 2, borderColor: 'error.light' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {estaSuspendido ? 'Comercio suspendido' : 'Suspender el comercio entero'}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {estaSuspendido
            ? 'Hoy no puede vender ni entrar a su panel. Sus datos están intactos y se reactiva en un clic.'
            : 'Deja de vender y de entrar a su panel. No se borra nada: productos, órdenes, clientes e historial quedan intactos, y se puede volver atrás.'}
        </Typography>

        <Button
          variant="outlined"
          color={estaSuspendido ? 'success' : 'error'}
          onClick={() => {
            setMotivo('')
            setError('')
            setAbierto(true)
          }}
        >
          {estaSuspendido ? 'Reactivar el comercio' : 'Suspender el comercio'}
        </Button>
      </Paper>

      <Dialog open={abierto} onClose={() => setAbierto(false)} fullWidth maxWidth="xs">
        <DialogTitle>
          {estaSuspendido ? '¿Reactivar el comercio?' : '¿Suspender el comercio?'}
        </DialogTitle>
        <DialogContent>
          <Alert severity={estaSuspendido ? 'success' : 'warning'} sx={{ mb: 2 }}>
            {estaSuspendido ? (
              <>
                <strong>{row?.name}</strong> vuelve a vender y a poder entrar a su panel.
              </>
            ) : (
              <>
                <strong>{row?.name}</strong> deja de vender y de poder entrar a su panel, desde
                ahora. No se borra nada y se puede revertir.
              </>
            )}
          </Alert>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {/* Sólo al suspender: volver a habilitar a alguien no hay que
              defenderlo ante nadie. */}
          {!estaSuspendido && (
            <TextField
              label="Por qué se suspende"
              fullWidth
              multiline
              minRows={2}
              value={motivo}
              onChange={event => setMotivo(event.target.value)}
              placeholder="Ej.: cuesta más de lo que paga desde junio y no respondió los avisos"
              helperText="Queda con tu email y la fecha. Es lo que te va a permitir responder si el comercio reclama."
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAbierto(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            color={estaSuspendido ? 'success' : 'error'}
            onClick={aplicar}
            disabled={guardando}
          >
            {guardando ? (
              <CircularProgress size={22} />
            ) : (
              <span>{estaSuspendido ? 'Reactivar' : 'Suspender'}</span>
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

/**
 * Dar de baja un comercio.
 *
 * SEPARADO DE LA SUSPENSIÓN, Y NO POR ORDEN VISUAL
 *
 * Suspender se deshace con un clic; esto no. Compartir botón, o incluso
 * compartir bloque sin una frontera clara, invita a confundir una operación
 * reversible con una que no lo es.
 *
 * QUÉ BORRA Y QUÉ NO
 *
 * Saca al comercio de toda operación y del reporte de margen. NO borra el libro
 * de consumo de IA: esas filas registran lo que HENKO PAGÓ, y sin ellas el
 * gasto mensual de la plataforma dejaría de cuadrar con lo que facturó el
 * proveedor. Tampoco borra órdenes ni facturación, que es documentación que hay
 * que poder mostrar si alguien discute un cobro.
 *
 * El comercio va a seguir apareciendo en la tabla de gasto, marcado como dado
 * de baja. Eso no es un defecto: el gasto ocurrió.
 *
 * POR QUÉ PIDE EL NOMBRE ESCRITO
 *
 * Un botón de confirmación se aprieta por inercia. Escribir el nombre obliga a
 * mirar cuál comercio es.
 */
function BajaDelComercio({ row, onSaved, onClose }) {
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [motivo, setMotivo] = useState('')
  const [borrando, setBorrando] = useState(false)
  const [error, setError] = useState('')

  const nombreCoincide = nombre.trim() === row?.name

  const aplicar = async () => {
    setBorrando(true)
    setError('')

    try {
      await deleteTenant({
        tenantId: row.tenantId,
        confirmName: nombre.trim(),
        reason: motivo.trim(),
      })
      setAbierto(false)
      await onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err?.response?.data?.message || 'No se pudo dar de baja el comercio.')
    } finally {
      setBorrando(false)
    }
  }

  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, mt: 2, borderColor: 'error.main' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'error.main' }}>
          Dar de baja el comercio
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Lo saca de toda operación y del reporte de margen. No se deshace desde esta pantalla. Su
          gasto de IA sigue en la tabla, marcado: ese dinero ya se pagó.
        </Typography>

        <Button
          variant="contained"
          color="error"
          onClick={() => {
            setNombre('')
            setMotivo('')
            setError('')
            setAbierto(true)
          }}
        >
          Dar de baja
        </Button>
      </Paper>

      <Dialog open={abierto} onClose={() => setAbierto(false)} fullWidth maxWidth="xs">
        <DialogTitle>¿Dar de baja {row?.name}?</DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>
            <strong>Esto no se deshace desde acá.</strong> El comercio deja de operar, sus dominios
            dejan de resolver y sale del reporte de margen.
          </Alert>

          <Alert severity="info" sx={{ mb: 2 }}>
            Lo que <strong>no</strong> se borra: su gasto de IA, sus órdenes y su facturación. Son
            el registro de lo que se pagó y de lo que él pagó — hacen falta si después discute un
            cobro.
          </Alert>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <TextField
            label="Por qué se da de baja"
            fullWidth
            multiline
            minRows={2}
            value={motivo}
            onChange={event => setMotivo(event.target.value)}
            placeholder="Ej.: pidió la baja por mail el 11/10"
            helperText="Queda con tu email y la fecha."
          />

          <TextField
            label={`Escribí "${row?.name}" para confirmar`}
            fullWidth
            value={nombre}
            onChange={event => setNombre(event.target.value)}
            sx={{ mt: 2 }}
            helperText="Un botón se aprieta por inercia; escribir el nombre obliga a mirar cuál comercio es."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAbierto(false)} disabled={borrando}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={aplicar}
            // El nombre tiene que coincidir Y tiene que haber motivo. El backend
            // valida los dos igual; esto es para no hacer ir y volver.
            disabled={borrando || !nombreCoincide || !motivo.trim()}
          >
            {borrando ? <CircularProgress size={22} /> : <span>Dar de baja</span>}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

/** A partir de cuántos días un tipo de cambio deja de ser confiable. */
const DIAS_PARA_AVISAR = 15

/**
 * El tipo de cambio: mostrarlo, decir hace cuanto se cargo y poder corregirlo.
 *
 * POR QUE LA ANTIGUEDAD ES TAN IMPORTANTE COMO EL NUMERO
 *
 * Un 1530 cargado hoy y un 1530 que quedo de hace tres meses se leen identicos
 * en la pantalla y significan cosas opuestas. El segundo quiere decir que el
 * margen de todos los comercios esta mal medido, y siempre para el mismo lado:
 * el peso se devalua, el costo real en pesos sube, y el margen se sigue
 * informando como si no hubiera pasado nada. Es el modo de falla silencioso
 * tipico: nada se rompe, los numeros simplemente mienten.
 *
 * POR QUE NO SE TRAE SOLO DE UNA API
 *
 * Porque cual dolar usar —oficial, MEP, blue— es una decision del dueno y
 * cambia la rentabilidad informada. Una cotizacion automatica equivocada es peor
 * que una manual puesta a conciencia, y sumaria una dependencia externa que se
 * puede caer justo cuando hay que decidir algo.
 */
function TipoDeCambioCard({ fx, onSaved }) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const rate = fx?.rate ?? null
  const dias = fx?.ageDays ?? null
  const viejo = Number.isFinite(dias) && dias >= DIAS_PARA_AVISAR
  const sinCargar = fx?.source !== 'panel'

  const abrir = () => {
    setValor(rate ? String(rate) : '')
    setMotivo('')
    setError('')
    setEditando(true)
  }

  const guardar = async () => {
    const numero = Number(valor)

    if (!Number.isFinite(numero) || numero <= 0) {
      setError('Poné cuántos pesos vale un dólar hoy.')
      return
    }

    if (!motivo.trim()) {
      setError('Indicá de dónde sacaste el valor, para que dentro de tres meses se entienda.')
      return
    }

    setGuardando(true)
    setError('')

    try {
      await updateUsdRate({ rate: Math.round(numero), reason: motivo.trim() })
      setEditando(false)
      await onSaved?.()
    } catch (err) {
      setError(err?.response?.data?.message || 'No se pudo guardar el tipo de cambio.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 2,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary">
              Tipo de cambio para expresar los costos en pesos
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {rate ? `$${formatTokens(rate)} por dólar` : 'sin cargar'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {sinCargar
                ? 'Viene del valor por defecto del servidor, no lo cargó nadie.'
                : `Cargado ${dias === 0 ? 'hoy' : `hace ${dias} ${dias === 1 ? 'día' : 'días'}`}${
                    fx?.updatedByEmail ? ` por ${fx.updatedByEmail}` : ''
                  }.`}
            </Typography>
          </Box>

          <Button variant="contained" onClick={abrir}>
            {sinCargar ? 'Cargar el dólar' : 'Actualizar'}
          </Button>
        </Box>

        {(viejo || sinCargar) && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {sinCargar ? (
              <>
                <strong>Nadie cargó el tipo de cambio.</strong> Los pesos de esta pantalla salen de
                un valor por defecto del servidor, así que el margen de cada comercio puede estar
                lejos de la realidad.
              </>
            ) : (
              <>
                <strong>Este valor tiene {dias} días.</strong> Si el dólar se movió, cada peso de
                esta pantalla está mal — y hacia el mismo lado: el costo real es más alto y el
                margen se ve mejor de lo que es.
              </>
            )}
          </Alert>
        )}
      </Paper>

      <Dialog open={editando} onClose={() => setEditando(false)} fullWidth maxWidth="xs">
        <DialogTitle>Tipo de cambio</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Cuántos pesos vale un dólar hoy. Se usa para mostrar en pesos los costos que los
            proveedores de IA facturan en dólares, y para el margen de cada comercio. No toca los
            precios de los planes, que ya están en pesos.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <TextField
            label="Pesos por dólar"
            value={valor}
            onChange={event => setValor(event.target.value)}
            fullWidth
            margin="normal"
            type="number"
            inputProps={{ min: 1 }}
          />

          <TextField
            label="De dónde sale"
            placeholder="Dólar MEP del 11/10, pantalla de Ámbito"
            value={motivo}
            onChange={event => setMotivo(event.target.value)}
            fullWidth
            margin="normal"
            multiline
            minRows={2}
            helperText="Queda guardado con tu nombre y la fecha."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditando(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={guardar} disabled={guardando}>
            {guardando ? <CircularProgress size={22} /> : <span>Guardar</span>}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

/**
 * El mes de UN comercio, día por día.
 *
 * QUÉ CONTESTA QUE LA TABLA NO
 *
 * La tabla dice que un comercio triplicó. Eso no alcanza para decidir: un
 * negocio que creció de a poco se cobra, y un salto de un día es un bug o un
 * abuso. Las dos cosas suman el mismo total y se resuelven distinto.
 *
 * POR QUÉ LA LÍNEA PUNTEADA
 *
 * Es el promedio diario del mes anterior. Sin una referencia, una serie de
 * barras es un dibujo: todas las series de gasto tienen picos. Con la línea, un
 * pico es "tres veces lo que gastaba por día el mes pasado", que ya es una
 * afirmación. Es el mismo criterio que usa el detector de anomalías —comparar
 * al comercio contra sí mismo— pero sobre el mes y no sobre el día.
 *
 * SE PIDE AL ABRIR ESTE DIÁLOGO Y NO CON EL REPORTE: son treinta y un valores
 * por comercio, y la pantalla general se abre para mirar el total.
 */
function EvolucionDelComercio({ tenantId, period }) {
  const { dinero } = useDinero()
  const [estado, setEstado] = useState({ cargando: true, error: '', detalle: null })

  useEffect(() => {
    const signal = { cancelled: false }

    setEstado({ cargando: true, error: '', detalle: null })

    getTenantAiSpendDetail(tenantId, period)
      .then(detalle => {
        if (signal.cancelled) return

        // Una respuesta vacía se trata como una falla y no como un detalle en
        // blanco: destructurar `undefined` tumbaría el diálogo entero, y lo
        // que se viene a hacer acá —acotar, pausar— no depende del gráfico.
        setEstado({
          cargando: false,
          error: detalle ? '' : 'No se pudo cargar la evolución de este comercio.',
          detalle: detalle || null,
        })
      })
      .catch(err => {
        if (signal.cancelled) return

        setEstado({
          cargando: false,
          error: err?.response?.data?.message || 'No se pudo cargar la evolución de este comercio.',
          detalle: null,
        })
      })

    return () => {
      signal.cancelled = true
    }
  }, [tenantId, period])

  if (estado.cargando) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  // Que falle la evolución no puede dejar sin usar el diálogo: lo que se viene
  // a hacer acá es acotar o pausar, y eso no depende de este gráfico.
  if (estado.error) {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        {estado.error}
      </Alert>
    )
  }

  // Con los valores por defecto puestos acá y no en cada uso: un backend más
  // viejo que esta pantalla puede no mandar alguna de las listas, y que falte
  // una no puede dejar el diálogo sin abrir.
  const {
    daily = [],
    previousDaily = [],
    previousTotals = { costUsd: 0 },
    comparison = {},
    byMetric = [],
  } = estado.detalle

  const maximo = Math.max(...daily.map(d => d.costUsd), 0)

  if (maximo <= 0) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        Sin consumo registrado en el período.
        {previousTotals.costUsd > 0 &&
          ` El mes anterior gastó ${dinero(previousTotals.costUsd)}: dejó de consumir.`}
      </Alert>
    )
  }

  const promedioAnterior = previousDaily.length ? previousTotals.costUsd / previousDaily.length : 0
  const peorDia = daily.reduce((peor, d) => (d.costUsd > peor.costUsd ? d : peor), daily[0])

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
        Cómo gastó el mes
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        {comparison.days > 0 && comparison.previousCostUsd !== null
          ? `${dinero(comparison.costUsd)} en los primeros ${comparison.days} días, contra ${dinero(comparison.previousCostUsd)} en los mismos días de ${estado.detalle.previousPeriod}.`
          : 'Todavía no hay días cerrados para comparar contra el mes anterior.'}{' '}
        Día más caro: el {peorDia.day}, {dinero(peorDia.costUsd)}.
      </Typography>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '2px',
          height: 96,
          mb: 0.5,
          position: 'relative',
        }}
      >
        {/* El promedio diario del mes anterior, para que cada barra se lea
            contra algo. Solo se dibuja si entra en el gráfico: con un pico que
            la deja muy abajo, la línea pegada al piso no dice nada, y arriba
            del máximo quedaría fuera del recuadro. */}
        {promedioAnterior > 0 && promedioAnterior <= maximo && (
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: `${(promedioAnterior / maximo) * 100}%`,
              borderTop: '1px dashed',
              borderColor: 'warning.main',
              pointerEvents: 'none',
            }}
          />
        )}
        {daily.map(dia => (
          <Tooltip
            key={dia.day}
            title={`Día ${dia.day}: ${dinero(dia.costUsd)} · ${formatTokens(dia.operations)} operaciones`}
          >
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                alignSelf: 'flex-end',
                // Los días en cero dejan una marca de 2px en vez de nada: una
                // barra ausente y una barra de valor chico se tienen que poder
                // distinguir, o el eje no se puede leer.
                height: dia.costUsd > 0 ? `${Math.max(4, (dia.costUsd / maximo) * 100)}%` : '2px',
                bgcolor: dia.costUsd > 0 ? 'primary.main' : 'divider',
                borderRadius: '2px 2px 0 0',
              }}
            />
          </Tooltip>
        ))}
      </Box>

      {/* La referencia va en texto y no solo como línea: una línea punteada sin
          leyenda es decoración. */}
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">
          Día 1
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {promedioAnterior > 0
            ? `Promedio diario de ${estado.detalle.previousPeriod}: ${dinero(promedioAnterior)}`
            : `Sin consumo en ${estado.detalle.previousPeriod}`}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Día {daily.length}
        </Typography>
      </Stack>

      {/* EN QUÉ se le fue. El mismo total repartido en análisis de mercado o en
          mensajes del agente lleva a palancas distintas: una se apaga, la otra
          se cambia de modelo. */}
      {byMetric.length > 0 && (
        <Stack spacing={0.25} sx={{ mt: 1.5 }}>
          {byMetric.slice(0, 4).map(fila => (
            <Stack key={fila.metric} direction="row" justifyContent="space-between">
              <Typography variant="caption" color="text.secondary">
                {metricLabel(fila.metric)}
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 500 }}>
                {dinero(fila.costUsd)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </Paper>
  )
}

function TenantPolicyDialog({ row, budget, period, onClose, onSaved }) {
  const { dinero } = useDinero()
  const [share, setShare] = useState('')
  const [usdCap, setUsdCap] = useState('')
  const [suspended, setSuspended] = useState(false)
  const [suspendedReason, setSuspendedReason] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Los valores vigentes al abrir, para poder comparar y mandar SOLO lo que
  // cambió — mismo criterio que el diálogo del techo.
  useEffect(() => {
    if (!row) return
    setShare(row.share === null || row.share === undefined ? '' : String(row.share))
    setUsdCap(
      row.usdCapOverride === null || row.usdCapOverride === undefined
        ? ''
        : String(row.usdCapOverride),
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
    budget.tokens && shareEfectiva ? Math.floor(budget.tokens * shareEfectiva) : null

  // Vacio = usa su fraccion. Igual que el share, el backend distingue null
  // (volver a la fraccion) de no mandar el campo.
  const usdCapValue = String(usdCap).trim() === '' ? null : Number(usdCap)

  const submit = async () => {
    setSaving(true)
    setError('')

    try {
      const data = await updateTenantAiPolicy({
        tenantId: row.tenantId,
        ...(String(share) !== String(row.share ?? '') ? { share: shareValue } : {}),
        ...(String(usdCap) !== String(row.usdCapOverride ?? '') ? { usdCap: usdCapValue } : {}),
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
      setError(err?.response?.data?.message || 'No se pudo cambiar la política de este comercio.')
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
          Este comercio lleva {formatTokens(row.tokens)} tokens y {dinero(row.platformCostUsd)} a
          cargo de HENKO en el período. Los cambios rigen de inmediato y solo afectan a este
          comercio.
        </Typography>

        {/* ARRIBA DE LAS PALANCAS, A PROPÓSITO.
            Lo que se decide acá —acotarlo, pausarlo— depende de si el comercio
            creció de a poco o se desbocó un día, y ese es justo el dato que la
            tabla no tiene. Con el gráfico debajo de los campos, la decisión se
            toma antes de verlo. */}
        <EvolucionDelComercio tenantId={row.tenantId} period={period} />

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

        {/* EL TECHO EN PLATA, al lado del de tokens y no en su lugar.

            El de arriba reparte TOKENS, y el catálogo de precios explica por qué
            eso no controla el gasto: entre un modelo y otro de la cadena hay 5x
            de diferencia de tarifa, así que el mismo tope de tokens puede costar
            veinte dólares o cien según quién conteste — y eso lo decide la
            cadena de respaldo, no una política.

            Van los dos porque miden cosas distintas y las dos sirven: la
            fracción reparte proporcionalmente, esto pone un número. */}
        <TextField
          label="Su techo en dólares del mes"
          type="number"
          fullWidth
          value={usdCap}
          onChange={event => setUsdCap(event.target.value)}
          sx={{ mb: 2 }}
          inputProps={{ step: 1, min: 0.01 }}
          helperText={
            usdCapValue
              ? `Este comercio no va a costar más de USD ${usdCapValue} este mes. Gana sobre la fracción de arriba.`
              : `Vacío = usa su fracción, hoy ${row.usdCap === null ? 'sin techo' : `USD ${row.usdCap}`}. Poné un número para acotar el gasto directamente.`
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
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            No se repone el mes que viene ni se levanta solo: lo tenés que volver a prender vos.
            Corta también si el comercio usa su propia clave.
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

        {/* SUSPENDER EL COMERCIO ENTERO: aparte de todo lo de arriba.

            Va en su propio bloque, abajo, y con su propio botón, porque es una
            decisión de otra naturaleza. Lo de arriba acota o apaga la IA y el
            comercio sigue vendiendo; esto lo deja sin tienda y sin panel.

            Si compartiera el botón "Guardar" con el resto, alguien que vino a
            ajustar una fracción podría cortarle el servicio a un comercio que
            paga sin haberlo decidido. */}
        {/* Un comercio que ya no existe no se suspende ni se da de baja: no hay
            nada que hacerle. Su fila sigue en la tabla porque el gasto ocurrió,
            pero ofrecerle acciones sería prometer algo que no se puede. */}
        {row?.tenantGone || row?.tenantStatus === 'deleted' ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            {row.tenantGone
              ? 'Este comercio no existe en la base: alguien lo borró a mano. Su gasto sigue acá porque esa plata se pagó, pero no hay nada que gobernar.'
              : 'Este comercio está dado de baja. Su gasto sigue acá porque esa plata se pagó.'}
          </Alert>
        ) : (
          <>
            <SuspensionDelComercio row={row} onSaved={onSaved} onClose={onClose} />
            <BajaDelComercio row={row} onSaved={onSaved} onClose={onClose} />
          </>
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

function ContenidoDelGasto({ fx, onFxSaved }) {
  const { dinero } = useDinero()
  const [loading, setLoading] = useState(true)
  // El margen por comercio. Es el MISMO reporte que la pantalla de margen, no
  // un calculo nuevo: dos calculos del mismo numero terminarian dando cifras
  // distintas para el mismo comercio en dos pantallas del mismo panel.
  const [margen, setMargen] = useState([])
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
      const [gasto, reporteMargen] = await Promise.allSettled([
        getPlatformAiSpend(),
        getPlatformMarginReport(),
      ])

      if (signal?.cancelled) return

      if (gasto.status === 'rejected') throw gasto.reason

      setReport(gasto.value)
      // Si falla el margen, la columna queda en guiones y el resto de la
      // pantalla sirve igual. Al reves no: sin gasto no hay nada que mirar.
      setMargen(reporteMargen.status === 'fulfilled' ? reporteMargen.value?.tenants || [] : [])
    } catch (err) {
      if (signal?.cancelled) return

      if (err?.response?.status === 403) {
        setForbidden(true)
      } else {
        setError(err?.response?.data?.message || 'No se pudo cargar el gasto de IA.')
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
    // Contra qué se comparó cada comercio. Sin esto, el porcentaje de la
    // columna «vs anterior» no se puede leer: «+180%» significa una cosa si
    // son doce días contra doce y otra si es un mes entero contra otro.
    comparison,
    settingHistory,
  } = report
  const percent = consumption.percentUsed

  // Indexado por comercio: recorrer el array del margen por cada fila de la
  // tabla seria cuadratico, y con cientos de comercios eso se nota.
  const margenPorComercio = new Map(margen.map(fila => [String(fila.tenantId), fila]))

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        Gasto de IA de la plataforma
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Período {report.period} · lo que paga HENKO por los comercios que usan la key compartida.
        {fx?.rate
          ? ` Los montos están en pesos, a $${formatTokens(fx.rate)} por dólar.`
          : ' Los montos están en dólares: no hay tipo de cambio cargado.'}
      </Typography>

      {/* Arriba de todo porque es el número del que depende el resto: si está
          viejo, cada peso de esta pantalla está mal. */}
      <TipoDeCambioCard fx={fx} onSaved={onFxSaved} />

      {breaker.tripped && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <strong>El disyuntor cortó el {formatDate(breaker.trippedAt)}.</strong> La IA está
          detenida para todos los comercios sobre la key de la plataforma. Los que tienen key propia
          siguen funcionando.
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
        <Alert severity={degradation.level === 'essential' ? 'error' : 'warning'} sx={{ mb: 2 }}>
          <strong>
            {degradation.level === 'essential' ? 'Solo lo esencial.' : 'Modo economía.'}
          </strong>{' '}
          El gasto va por el {degradation.percentUsed}% del techo, así que se está respondiendo con
          el modelo más barato de la cadena.
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
          Proyección: {dinero(forecast.projectedUsd)} sobre un techo de {dinero(budget.usd)} (
          {forecast.projectedPercent}%).{' '}
          {forecast.basis === 'recent'
            ? `Calculado con el ritmo de los últimos ${forecast.recentWindowDays} días (${dinero(forecast.recentAvgUsd)} por día), que viene más alto que el promedio del mes (${dinero(forecast.dailyAvgUsd)}).`
            : `Calculado con el promedio del mes, ${dinero(forecast.dailyAvgUsd)} por día.`}
        </Alert>
      )}

      {/* Sin techo configurado no hay nada que medir, y es una situación
          distinta de "el techo es cero". El backend manda null justamente para
          poder distinguirlas acá. */}
      {!budget.configured && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No hay disyuntor configurado (<code>AI_PLATFORM_MONTHLY_TOKEN_BUDGET</code>). El gasto se
          registra, pero <strong>nada lo detiene</strong>.
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
            {dinero(consumption.estimatedCostUsd)}
          </Typography>
          {percent !== null && (
            <Typography variant="body2" color="text.secondary">
              {formatTokens(consumption.tokens)} de {formatTokens(budget.tokens)} tokens
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
            <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.75 }}>
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
                {dinero(forecast.dailyAvgUsd)} por día en {forecast.daysElapsed}{' '}
                {forecast.daysElapsed === 1 ? 'día cerrado' : 'días cerrados'}
                {forecast.projectedUsd !== null &&
                  ` · proyectado al cierre: ${dinero(forecast.projectedUsd)}`}
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
          // El estado del comercio lo manda la fila de GASTO, que ahora lo
          // trae, y el margen queda como respaldo.
          //
          // El orden importa y estaba al revés: la clave explícita gana sobre
          // el spread, así que el margen sobrescribía el estado de la fila. Y
          // el reporte de margen EXCLUYE los comercios dados de baja
          // (platformMarginService:95), o sea que para uno de ésos devolvía
          // undefined y el fallback lo dejaba en 'active'. Resultado: la guarda
          // de abajo no se activaba y el diálogo ofrecía suspender y dar de
          // baja a un comercio que ya estaba dado de baja.
          row={{
            ...governing,
            tenantStatus:
              governing.tenantStatus || margenPorComercio.get(governing.tenantId)?.status || null,
          }}
          budget={budget}
          // El período que se está mirando, para que la evolución del comercio
          // sea la del mismo mes que la tabla y no la del mes actual.
          period={report.period}
          onClose={() => setGoverning(null)}
          // Al suspender hay que recargar las dos cosas: el gasto por el
          // cambio de política, y el margen porque de ahí sale el estado.
          onSaved={load}
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
                <strong>{row.name}</strong>: {dinero(row.todayUsd)} hoy en{' '}
                {formatTokens(row.todayOperations)}{' '}
                {row.todayOperations === 1 ? 'operación' : 'operaciones'}
                {/* factor null = venía de cero. No hay múltiplo que calcular y
                    decir "infinitas veces más" no ayuda a nadie. */}
                {row.factor === null
                  ? ', cuando no venía consumiendo nada'
                  : `, ${row.factor}× su habitual de ${dinero(row.typicalUsd)} por día`}
                .
              </Typography>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Se compara contra la mediana de sus propios días del mes, no contra el techo: un
            comercio chico puede multiplicar por cincuenta lo suyo y seguir lejísimos de su tope.
            Con «Gobernar», en la tabla de abajo, se lo acota o se lo pausa.
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
                  {/* Cuánto lleva de SU techo en plata. El de tokens, más a la
                      derecha, no contesta lo mismo: entre modelos de la cadena
                      hay 5x de tarifa. */}
                  <TableCell align="right">De su techo</TableCell>
                  {/* CONTRA SÍ MISMO, no contra un techo.

                      Las demás columnas comparan contra un tope, y eso deja
                      ciego al comercio que se desliza: duplica su consumo
                      todos los meses y sigue lejos del suyo, así que no
                      enciende ninguna alarma hasta que ya se comió el
                      presupuesto. */}
                  <TableCell align="right">
                    <Tooltip
                      title={
                        comparison?.partial
                          ? `Contra los mismos ${comparison?.days ?? 0} días de ${comparison?.previousPeriod}: el mes en curso va por la mitad y compararlo entero mostraría a todos cayendo.`
                          : `Contra ${comparison?.previousPeriod || 'el mes anterior'}, mes completo.`
                      }
                    >
                      <span>vs anterior</span>
                    </Tooltip>
                  </TableCell>
                  {/* EL MARGEN, AL LADO DEL COSTO.

                      Vivía en otra pantalla, y ésa es la razón por la que no
                      servía: la decisión que esta tabla habilita —acotar,
                      pausar, suspender— se toma comparando lo que un comercio
                      cuesta contra lo que paga, y con los dos números en
                      pantallas distintas hay que recordar uno mientras se mira
                      el otro.

                      No se recalcula nada: es el mismo reporte de margen de
                      siempre, unido por tenantId. Dos cálculos del mismo número
                      terminarían dando cifras distintas para el mismo
                      comercio. */}
                  <TableCell align="right">Margen</TableCell>
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
                        {row.plan && <Chip size="small" variant="outlined" label={row.plan} />}
                        {/* Con key propia el comercio le paga a Google, no a
                            HENKO: ver un cero en la columna de costo sin esta
                            marca se lee como un error. */}
                        {row.keySources?.includes('tenant') && (
                          <Tooltip title="Usa su propia clave: parte de su consumo no le cuesta a HENKO">
                            <Chip size="small" color="info" variant="outlined" label="key propia" />
                          </Tooltip>
                        )}
                        {/* COMERCIO QUE YA NO ESTÁ.

                            Esta tabla se arma desde el LIBRO, no desde la lista
                            de comercios, así que un comercio borrado sigue
                            apareciendo: esa plata HENKO ya la pagó y si la fila
                            desapareciera el total del mes dejaría de cuadrar
                            con lo que facturó el proveedor.

                            Pero sin marcarla se lee como una fila viva, y la
                            tabla le ofrecía "Gobernar" a algo que no existe.
                            Esto es historia, no algo sobre lo que actuar. */}
                        {(row.tenantGone || row.tenantStatus === 'deleted') && (
                          <Tooltip
                            title={
                              row.tenantGone
                                ? 'No existe en la base: lo borraron a mano. Su gasto queda porque esa plata se pagó.'
                                : 'Dado de baja. Su gasto queda porque esa plata se pagó.'
                            }
                          >
                            <Chip
                              size="small"
                              variant="outlined"
                              label={row.tenantGone ? 'no existe' : 'dado de baja'}
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
                        {dinero(row.platformCostUsd)}
                      </Typography>
                      {/* Lo que el proveedor le cobró a la key usada. Solo se
                          muestra cuando difiere, que es exactamente el caso
                          BYOK: si no, sería el mismo número dos veces. */}
                      {row.tenantProviderCostUsd > row.platformCostUsd && (
                        <Typography variant="caption" color="text.secondary">
                          {dinero(row.tenantProviderCostUsd)} con su key
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {/* CUÁNTO LLEVA DE SU TECHO EN PLATA.

                          Va al lado del costo porque es lo que convierte el
                          monto en una decisión: USD 4 no dice nada solo, "USD 4
                          de un techo de USD 5" dice que a este comercio le
                          quedan horas.

                          El porcentaje de tokens, que está más a la derecha, no
                          contesta esto: entre modelos de la cadena hay 5x de
                          tarifa, así que un comercio puede ir al 40% de sus
                          tokens y al 95% de su plata. */}
                      {row.percentOfUsdCap === null || row.percentOfUsdCap === undefined ? (
                        <Typography variant="caption" color="text.disabled">
                          sin techo
                        </Typography>
                      ) : (
                        <Tooltip
                          title={`${dinero(row.platformCostUsd)} de un techo de ${dinero(row.usdCap)}${
                            row.usdCapOverride ? ' (puesto a mano)' : ' (su fracción)'
                          }`}
                        >
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: row.percentOfUsdCap >= 80 ? 600 : 400 }}
                            color={usageColor(row.percentOfUsdCap)}
                          >
                            {row.percentOfUsdCap}%
                          </Typography>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <TendenciaDelComercio row={row} comparison={comparison} />
                    </TableCell>
                    <TableCell align="right">
                      <MargenDelComercio margen={margenPorComercio.get(row.tenantId)} />
                    </TableCell>
                    <TableCell align="right">{formatTokens(row.tokens)}</TableCell>
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
                    <TableCell align="right">{formatTokens(row.operations)}</TableCell>
                    {/* La acción va en la misma fila donde está el número que
                        la justifica. Mandarla a otra pantalla obligaría a
                        recordar qué comercio era y cuánto llevaba. */}
                    <TableCell align="right">
                      <Button size="small" onClick={() => setGoverning(row)}>
                        {/* Un comercio que ya no esta no se gobierna: se
                            consulta. El dialogo no le ofrece acciones. */}
                        {row.tenantGone || row.tenantStatus === 'deleted' ? 'Ver' : 'Gobernar'}
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
            , no contra el techo total: un comercio puede quedarse sin IA con la plataforma al 30%.
            Con «Gobernar» se le baja el tope a uno solo, o se le pausa la IA, sin tocar a los
            demás.
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
                <TableCell align="right">{dinero(row.costUsd)}</TableCell>
                <TableCell align="right">{formatTokens(row.tokens)}</TableCell>
                <TableCell align="right">{formatTokens(row.operations)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        Por modelo
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Si el gasto se concentra en un modelo caro, cambiar de modelo es una palanca que no requiere
        tocar el producto.
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
                <TableCell align="right">{dinero(row.costUsd)}</TableCell>
                <TableCell align="right">{formatTokens(row.tokens)}</TableCell>
                <TableCell align="right">{formatTokens(row.operations)}</TableCell>
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
        {quality.measuredShare !== null && quality.measuredShare !== undefined && (
          <Typography
            variant="h6"
            sx={{ fontWeight: 600, mb: 1 }}
            color={quality.measuredShare >= 95 ? 'success.main' : 'warning.main'}
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
            {quality.measuredCostUsd !== undefined && ` · ${dinero(quality.measuredCostUsd)}`}
          </Typography>
          <Typography
            variant="body2"
            color={quality.estimatedRows > 0 ? 'warning.main' : 'text.secondary'}
          >
            {formatTokens(quality.estimatedRows)} con costo repartido
            {quality.estimatedCostUsd !== undefined && ` · ${dinero(quality.estimatedCostUsd)}`}
          </Typography>
          <Typography
            variant="body2"
            color={quality.fallbackRows > 0 ? 'warning.main' : 'text.secondary'}
          >
            {formatTokens(quality.fallbackRows)} con tarifa de respaldo
            {quality.fallbackCostUsd !== undefined && ` · ${dinero(quality.fallbackCostUsd)}`}
          </Typography>
          {/* El peor caso va en error y no en warning: no saber la tarifa es
              cobrar de más o de menos; no saber el modelo es no saber nada. */}
          <Typography
            variant="body2"
            color={quality.unknownModel > 0 ? 'error.main' : 'text.secondary'}
          >
            {formatTokens(quality.unknownModel ?? 0)} sin modelo conocido
            {quality.unknownModelCostUsd !== undefined &&
              ` · ${dinero(quality.unknownModelCostUsd)}`}
          </Typography>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Sobre {formatTokens(quality.rows)} movimientos de tokens
          {quality.costUsd !== undefined && ` (${dinero(quality.costUsd)})`}.
          {quality.flatRate?.rows > 0 && (
            <>
              {' '}
              Aparte, {formatTokens(quality.flatRate.rows)} movimientos de precio por unidad (
              {dinero(quality.flatRate.costUsd)}): imágenes y mensajes no se cobran por token, así
              que no hay desglose que medir ni suponer y no entran en el porcentaje.
            </>
          )}{' '}
          Los ocho llamadores informan el desglose real que devuelve el proveedor; repartir el total
          con una proporción supuesta quedó como último recurso y sale por log cuando ocurre.
        </Typography>
      </Paper>

      {settingHistory?.length > 0 && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 3, mb: 1 }}>
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
                      {row.value === null ? 'variable de entorno' : formatTokens(row.value)}
                    </TableCell>
                    <TableCell>{row.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
        El techo se cambia desde acá y rige de inmediato. Los límites por plan y la fracción por
        comercio siguen en variables de entorno de Render, que requieren reiniciar el servicio — son
        decisiones de producto, no maniobras de urgencia.
      </Typography>
    </Box>
  )
}

/**
 * El tipo de cambio es contexto de toda la pantalla, así que se trae y se provee
 * acá afuera.
 *
 * Esta envoltura existe por una razón concreta y no por gusto arquitectónico:
 * poner el Provider dentro de ContenidoDelGasto obligaba a envolver su JSX
 * entero, y eso corría la indentación de las 400 líneas de abajo. El diff pasaba
 * de un cambio chico y legible a 1232 líneas con 485 borrados que eran puro
 * espacio en blanco — imposible de revisar, y justo en una pantalla donde lo que
 * se revisa es si los números están bien.
 *
 * De paso queda mejor repartido: el cambio es de la página, el gasto es del
 * contenido, y cada uno se recarga por su cuenta.
 */
export default function PlatformAiSpendPage() {
  const [fx, setFx] = useState(null)

  const cargarCambio = useCallback(async ({ signal } = {}) => {
    try {
      const data = await getUsdRate()
      if (!signal?.cancelled) setFx(data)
    } catch {
      // Que falle el cambio no puede dejar la pantalla sin el gasto, que es lo
      // que se vino a ver. Sin cambio los montos se muestran en dólares: es
      // peor, pero no es nada.
      if (!signal?.cancelled) setFx(null)
    }
  }, [])

  useEffect(() => {
    const signal = { cancelled: false }
    cargarCambio({ signal })
    return () => {
      signal.cancelled = true
    }
  }, [cargarCambio])

  const rate = Number.isFinite(fx?.rate) && fx.rate > 0 ? fx.rate : null

  return (
    <TipoDeCambioContext.Provider value={rate}>
      <ContenidoDelGasto fx={fx} onFxSaved={cargarCambio} />
    </TipoDeCambioContext.Provider>
  )
}
