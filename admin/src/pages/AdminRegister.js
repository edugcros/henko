// 📁 AdminRegister.js
import React, { useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useFormik } from 'formik'
import { useDispatch, useSelector } from 'react-redux'
import * as yup from 'yup'

import { ArrowRightOutlined, EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons'

import { createUserAdmin } from '@features/auth/authSlice'
import AuthShell from '../components/AuthShell.js'
import TurnstileWidget from '../components/TurnstileWidget'
import { env } from '../config/env'
import { PLAN_PRESENTATION, SELLABLE_PLANS } from '../constants/plans.js'

// =====================================================
// Helpers
// =====================================================

/**
 * Limpia el identificador dejando lo que el backend acepta.
 *
 * NO recorta los guiones de los extremos, y eso es deliberado: ver
 * normalizeSlugFinal.
 */
const normalizeSlug = value => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
}

/**
 * La forma definitiva, para cuando el identificador deja de editarse.
 *
 * POR QU\u00c9 EL RECORTE VA AC\u00c1 Y NO EN CADA TECLA
 *
 * Quitar los guiones de los extremos corriendo en cada onChange hace imposible
 * escribir un identificador con guiones: se tipea "prueba-", el guion queda al
 * final, se borra, y la letra siguiente se pega \u2014 "pruebaqa2" en vez de
 * "prueba-qa-2".
 *
 * Pas\u00f3 en producci\u00f3n el 18/09/2026: se quiso registrar "prueba-qa-2" y no se
 * pudo escribir. El placeholder del campo dice "mi-tienda", o sea que el
 * formulario sugiere exactamente lo que imped\u00eda tipear.
 *
 * Un guion colgando mientras alguien escribe es un estado intermedio leg\u00edtimo.
 * Lo que no puede salir con guiones sueltos es el valor que se env\u00eda.
 */
const normalizeSlugFinal = value => normalizeSlug(value).replace(/(^-|-$)+/g, '')

const RESERVED_SLUGS = new Set([
  'api',
  'admin',
  'www',
  'mail',
  'smtp',
  'imap',
  'pop',
  'ftp',
  'sftp',
  'ssh',
  'cdn',
  'assets',
  'static',
  'media',
  'ns1',
  'ns2',
  'ns3',
  'dns',
  'mx',
  'autoconfig',
  'autodiscover',
  'webmail',
  'cpanel',
  'whm',
  'cgi',
  'status',
  'health',
  'blog',
  'docs',
  'support',
  'help',
  'app',
  'dashboard',
  'login',
  'signup',
  'register',
  'auth',
  'oauth',
  'sso',
  'graphql',
  'ws',
  'wss',
  'socket',
  'realtime',
  'test',
  'staging',
  'dev',
  'demo',
  'sandbox',
  'preview',
  'null',
  'undefined',
  'root',
  'system',
  'platform',
  'billing',
  'payment',
  'checkout',
  'store',
  'shop',
  'henko',
  'noreply',
  'no-reply',
  'postmaster',
  'abuse',
])

// Distancia de edición simple (Levenshtein) para atrapar typos de slugs
// reservados críticos (ej. "henkoo", "henk0" en vez de "henko") — debe
// coincidir con backend/src/utils/domainUtils.js.
const levenshteinDistance = (a, b) => {
  const rows = a.length + 1
  const cols = b.length + 1
  const matrix = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)])
  matrix[0] = Array.from({ length: cols }, (_, j) => j)

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }

  return matrix[rows - 1][cols - 1]
}

const TYPO_SENSITIVE_SLUGS = ['henko']
const TYPO_DISTANCE_THRESHOLD = 1

const isReservedSlug = slug => {
  const normalized = normalizeSlugFinal(slug)

  if (RESERVED_SLUGS.has(normalized)) return true

  return TYPO_SENSITIVE_SLUGS.some(
    reserved => levenshteinDistance(normalized, reserved) <= TYPO_DISTANCE_THRESHOLD,
  )
}

// Qué planes se pueden contratar sale de constants/plans.js. Acá había una
// cuarta lista con los mismos dos valores: agregar un plan obligaba a acordarse
// de este archivo, y olvidarse significaba que el alta lo rechazara en silencio
// y cayera al starter.
const resolveSignupPlan = (...candidates) => {
  const selectedPlan = candidates.find(candidate =>
    SELLABLE_PLANS.includes(String(candidate || '').toLowerCase()),
  )

  return selectedPlan ? String(selectedPlan).toLowerCase() : SELLABLE_PLANS[0]
}

const ensureUrl = value => {
  if (!value) return null

  const clean = String(value).trim()

  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    return clean
  }

  return `https://${clean}`
}

const appendAdminPath = url => {
  if (!url) return null

  const clean = String(url).replace(/\/+$/, '')

  if (clean.endsWith('/admin')) return clean

  return `${clean}/admin`
}

const getHostnameFromUrl = value => {
  if (!value) return ''

  try {
    return new URL(ensureUrl(value)).hostname
  } catch {
    return String(value)
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split(':')[0]
  }
}

const buildTenantDomainPreview = ({ slug, publicBaseDomain, adminBaseDomain }) => {
  const normalizedSlug = normalizeSlugFinal(slug)
  const publicBase = getHostnameFromUrl(publicBaseDomain)
  const adminBase = getHostnameFromUrl(adminBaseDomain)

  if (!normalizedSlug || !publicBase) {
    return { storefront: null, admin: null }
  }

  const storefront =
    publicBase === normalizedSlug || publicBase.startsWith(`${normalizedSlug}.`)
      ? publicBase
      : `${normalizedSlug}.${publicBase}`

  // EL PANEL ES COMPARTIDO — ESTA VISTA PREVIA PROMETÍA UNA URL INEXISTENTE
  //
  // Acá había una copia de la lógica vieja del backend, que para un adminBase
  // subdominio de la raíz devolvía admin.<slug>.<raíz>. Son DOS niveles, y un
  // certificado comodín cubre uno solo: admin.kiosco.henkart.com.ar falla el
  // handshake TLS.
  //
  // El backend dejó de asignar ese dominio (buildPlatformTenantDomains), pero
  // esta copia quedó atrás y el formulario le seguía mostrando al comerciante
  // la dirección de panel que no iba a poder abrir.
  //
  // Todos los comercios entran por el mismo panel y el comercio sale de la
  // sesión, así que la respuesta es siempre adminBase. Si no hay adminBase
  // configurado no se inventa ninguno: mostrar admin.<tienda> sería volver a
  // prometer los dos niveles.
  return {
    storefront,
    admin: adminBase || null,
  }
}

// =====================================================
// Validation
// =====================================================

const validationSchema = yup.object({
  firstname: yup.string().trim().min(2, 'Mínimo 2 caracteres').required('El nombre es obligatorio'),

  lastname: yup
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .required('El apellido es obligatorio'),

  email: yup.string().trim().email('Correo inválido').required('El correo es obligatorio'),

  mobile: yup
    .string()
    .trim()
    .min(8, 'Celular demasiado corto')
    .required('El celular es obligatorio'),

  storeName: yup
    .string()
    .trim()
    .min(3, 'Mínimo 3 caracteres')
    .max(80, 'Máximo 80 caracteres')
    .required('El nombre de la tienda es obligatorio'),

  storeSlug: yup
    .string()
    .trim()
    .lowercase()
    .min(3, 'Mínimo 3 caracteres')
    .max(60, 'Máximo 60 caracteres')
    .matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Usá solo letras, números y guiones. Ej: mi-tienda')
    .test(
      'not-reserved',
      'Ese identificador está reservado. Elegí otro.',
      value => !value || !isReservedSlug(value),
    )
    .required('El identificador de tienda es obligatorio'),

  password: yup.string().min(8, 'Mínimo 8 caracteres').required('La contraseña es obligatoria'),

  plan: yup
    .string()
    .oneOf([...SELLABLE_PLANS], 'El plan seleccionado no es válido')
    .required('Seleccioná un plan'),
})

// =====================================================
// Component
// =====================================================

const AdminRegister = () => {
  const dispatch = useDispatch()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const { isSuccess, isError, message, loading = {}, user } = useSelector(state => state.user || {})

  const isLoading = loading.createAdmin === true
  const [turnstileToken, setTurnstileToken] = useState('')
  const [captchaError, setCaptchaError] = useState('')
  const [verPassword, setVerPassword] = useState(false)

  // Pendiente solo mientras el desafío TODAVÍA puede resolverse. Si falló, el
  // botón deja de estar bloqueado por él: el visitante no puede hacer nada
  // para conseguir un token, y dejarlo deshabilitado sin explicación es la
  // pantalla muerta que este formulario tenía. Se deja intentar y, si el
  // backend exige el token, contesta un error que al menos se lee.
  const captchaPending = Boolean(env.turnstileSiteKey) && !turnstileToken && !captchaError

  // Si el reintento funciona, el aviso de fallo tiene que irse: dejarlo puesto
  // haría que alguien que YA resolvió el desafío siga leyendo que algo anda mal.
  const setCaptchaToken = React.useCallback(token => {
    setTurnstileToken(token)
    setCaptchaError('')
  }, [])

  const platformDomain = env.publicBaseDomain || env.productionDomain || ''
  const isProduction = env.isProduction
  const selectedPlan = resolveSignupPlan(searchParams.get('plan'), location.state?.planId)

  const formik = useFormik({
    initialValues: {
      firstname: '',
      lastname: '',
      email: '',
      mobile: '',
      storeName: '',
      storeSlug: '',
      password: '',
      plan: selectedPlan,
    },
    validationSchema,
    onSubmit: async values => {
      const payload = {
        firstname: values.firstname.trim(),
        lastname: values.lastname.trim(),
        email: values.email.trim().toLowerCase(),
        mobile: values.mobile.trim(),
        storeName: values.storeName.trim(),
        storeSlug: normalizeSlugFinal(values.storeSlug),
        plan: values.plan || 'starter',
        password: values.password,
        turnstileToken,
      }

      try {
        await dispatch(createUserAdmin(payload)).unwrap()
      } catch (err) {
        console.error('Error en el registro:', err)
      }
    },
  })

  const domainPreview = useMemo(
    () =>
      buildTenantDomainPreview({
        slug: formik.values.storeSlug,
        publicBaseDomain: platformDomain,
        adminBaseDomain: env.adminBaseDomain,
      }),
    [formik.values.storeSlug, platformDomain],
  )

  const storefrontPreview = domainPreview.storefront
  const adminPreview = domainPreview.admin

  const tenantData = user?.tenant || user?.data?.tenant || null

  const shopUrl =
    tenantData?.shopUrl ||
    tenantData?.storefrontUrl ||
    tenantData?.urls?.storefront ||
    tenantData?.primaryDomain ||
    storefrontPreview

  const adminUrl = tenantData?.adminUrl || tenantData?.urls?.admin || adminPreview

  const handleGoToAdmin = () => {
    const finalUrl = appendAdminPath(ensureUrl(adminUrl))

    if (!finalUrl) {
      console.error('No se encontró la URL del administrador.')
      return
    }

    window.location.href = finalUrl
  }

  // POR QUÉ NO ALCANZA CON formik.touched
  //
  // touched se marca en el BLUR, y el campo del identificador escribe con
  // setFieldValue, que tampoco lo marca. O sea que alguien podía tipear su
  // identificador, volver a retocar el nombre de la tienda sin haber salido
  // del campo, y el nombre le pisaba el identificador en silencio.
  //
  // Pasó en producción el 18/09/2026: se pidió "prueba-qa-2" y el comercio
  // quedó como "tienda-de-prueba-qa". No es cosmético — el identificador es la
  // dirección pública de la tienda, y se lo cambiamos sin avisar.
  //
  // Va en una ref y no en estado: no hay que volver a renderizar por esto, y
  // el valor tiene que estar disponible en el mismo tick del onChange.
  const identificadorEscritoAMano = useRef(false)

  const handleStoreNameChange = event => {
    const storeName = event.target.value

    formik.setFieldValue('storeName', storeName)

    // Mientras el identificador siga siendo el sugerido, acompaña al nombre.
    // Apenas alguien lo escribe, deja de tocarse.
    if (!identificadorEscritoAMano.current) {
      formik.setFieldValue('storeSlug', normalizeSlugFinal(storeName))
    }
  }

  const handleStoreSlugChange = event => {
    // Vaciarlo vuelve a delegar en el nombre: es la forma natural de decir
    // "no quiero elegirlo yo".
    identificadorEscritoAMano.current = event.target.value.trim() !== ''

    // Mientras se escribe NO se recortan los guiones de los extremos, o sería
    // imposible tipear "prueba-qa-2". Se recortan al salir del campo.
    formik.setFieldValue('storeSlug', normalizeSlug(event.target.value))
  }

  const handleStoreSlugBlur = event => {
    formik.setFieldValue('storeSlug', normalizeSlugFinal(event.target.value))
    formik.handleBlur(event)
  }

  const planElegido = PLAN_PRESENTATION[formik.values.plan]

  // Cada campo dice por qué está mal o, si está bien, qué se espera de él. El error y la ayuda
  // nunca están a la vez, y el campo apunta al que se vea (aria-describedby).
  const campo = (name, hint) => {
    const error = formik.touched[name] && formik.errors[name]
    const id = `${name}-${error ? 'error' : 'hint'}`

    return {
      error,
      hint,
      describedBy: error || hint ? id : undefined,
      invalid: Boolean(error),
      nota: error ? (
        <p className="hk-auth-field-error" id={id}>
          {error}
        </p>
      ) : hint ? (
        <p className="hk-auth-hint" id={id}>
          {hint}
        </p>
      ) : null,
    }
  }

  const f = {
    firstname: campo('firstname'),
    lastname: campo('lastname'),
    email: campo('email'),
    mobile: campo('mobile', 'Sin 0 y sin 15. Ej: 3585132769'),
    storeName: campo('storeName'),
    storeSlug: campo('storeSlug', 'Se usará para crear la dirección de tu tienda.'),
    password: campo('password', 'Mínimo 8 caracteres.'),
  }

  return (
    <AuthShell variant="alta" wide titleId="register-title">
      {isSuccess && user ? (
        <>
          <h1 id="register-title">¡Tienda creada!</h1>
          <p className="hk-auth-lead" role="status">
            La tienda <strong>{tenantData?.name || formik.values.storeName}</strong> fue creada
            correctamente.
          </p>

          <dl className="hk-auth-addresses">
            <div>
              <dt>Tu tienda</dt>
              <dd>{getHostnameFromUrl(shopUrl)}</dd>
            </div>
            <div>
              <dt>Tu panel</dt>
              <dd>{getHostnameFromUrl(adminUrl)}</dd>
            </div>
          </dl>

          {!isProduction && (
            <p className="hk-auth-alert is-info">
              En desarrollo agregá estos dominios al archivo hosts de Windows.
            </p>
          )}

          <button type="button" className="hk-auth-submit" onClick={handleGoToAdmin}>
            <span>Abrir panel de control</span>
            <ArrowRightOutlined aria-hidden="true" />
          </button>
        </>
      ) : (
        <>
          <h1 id="register-title">Creá tu tienda online</h1>
          <p className="hk-auth-lead">
            Completá tus datos y tu tienda queda lista con su dirección y su panel de control.
          </p>

          {planElegido && (
            <p className="hk-auth-plan">
              <span>
                Plan elegido: <b>{planElegido.name}</b>
              </span>
              <Link className="hk-auth-link is-strong" to="/subscripcion">
                Cambiar
              </Link>
            </p>
          )}

          <form onSubmit={formik.handleSubmit} noValidate>
            <div className="hk-auth-row">
              <div className="hk-auth-field">
                <label htmlFor="firstname">Nombre</label>
                <input
                  id="firstname"
                  type="text"
                  autoComplete="given-name"
                  placeholder="Ej. Juan"
                  aria-invalid={f.firstname.invalid}
                  aria-describedby={f.firstname.describedBy}
                  {...formik.getFieldProps('firstname')}
                />
                {f.firstname.nota}
              </div>

              <div className="hk-auth-field">
                <label htmlFor="lastname">Apellido</label>
                <input
                  id="lastname"
                  type="text"
                  autoComplete="family-name"
                  placeholder="Ej. Pérez"
                  aria-invalid={f.lastname.invalid}
                  aria-describedby={f.lastname.describedBy}
                  {...formik.getFieldProps('lastname')}
                />
                {f.lastname.nota}
              </div>
            </div>

            <div className="hk-auth-field">
              <label htmlFor="email">Correo</label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck="false"
                aria-invalid={f.email.invalid}
                aria-describedby={f.email.describedBy}
                {...formik.getFieldProps('email')}
              />
              {f.email.nota}
            </div>

            <div className="hk-auth-field">
              <label htmlFor="mobile">Celular</label>
              <input
                id="mobile"
                name="mobile"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="3585132769"
                value={formik.values.mobile}
                onChange={event => {
                  const val = event.target.value.replace(/\D/g, '')
                  const cleanedVal = val.startsWith('0') ? val.substring(1) : val
                  formik.setFieldValue('mobile', cleanedVal)
                }}
                onBlur={formik.handleBlur}
                aria-invalid={f.mobile.invalid}
                aria-describedby={f.mobile.describedBy}
              />
              {f.mobile.nota}
            </div>

            <div className="hk-auth-field">
              <label htmlFor="storeName">Nombre de la tienda</label>
              <input
                id="storeName"
                name="storeName"
                type="text"
                autoComplete="organization"
                placeholder="Ej. Repuestos BMW Córdoba"
                value={formik.values.storeName}
                onChange={handleStoreNameChange}
                onBlur={formik.handleBlur}
                aria-invalid={f.storeName.invalid}
                aria-describedby={f.storeName.describedBy}
              />
              {f.storeName.nota}
            </div>

            <div className="hk-auth-field">
              <label htmlFor="storeSlug">Identificador de tienda</label>
              <input
                id="storeSlug"
                name="storeSlug"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck="false"
                placeholder="mi-tienda"
                value={formik.values.storeSlug}
                onChange={handleStoreSlugChange}
                onBlur={handleStoreSlugBlur}
                aria-invalid={f.storeSlug.invalid}
                aria-describedby={f.storeSlug.describedBy}
              />
              {f.storeSlug.nota}

              {storefrontPreview && !formik.errors.storeSlug && (
                <div className="hk-auth-preview">
                  <p>
                    Tienda: <b>{storefrontPreview}</b>
                  </p>
                  {adminPreview && (
                    <p>
                      Panel: <b>{adminPreview}</b>
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="hk-auth-field">
              <label htmlFor="password">Contraseña</label>
              <div className="hk-auth-password">
                <input
                  id="password"
                  type={verPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  aria-invalid={f.password.invalid}
                  aria-describedby={f.password.describedBy}
                  {...formik.getFieldProps('password')}
                />
                <button
                  type="button"
                  className="hk-auth-eye"
                  onClick={() => setVerPassword(v => !v)}
                  aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={verPassword}
                >
                  {verPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                </button>
              </div>
              {f.password.nota}
            </div>

            {env.turnstileSiteKey && (
              <div className="hk-auth-captcha">
                <TurnstileWidget
                  siteKey={env.turnstileSiteKey}
                  onVerify={token => {
                    setCaptchaToken(token)
                  }}
                  onExpire={() => setTurnstileToken('')}
                  onError={setCaptchaError}
                />
              </div>
            )}

            {captchaError && (
              <p className="hk-auth-alert is-info" role="alert">
                No pudimos verificar que no seas un robot. Podés intentar crear la tienda igual; si
                no funciona, recargá la página o probá desde otra red.
              </p>
            )}

            <button type="submit" className="hk-auth-submit" disabled={isLoading || captchaPending}>
              {/*
                Texto envuelto, no desnudo: ver website/src/Pages/Login.js.
                Acá el costo es un comercio que no llega a darse de alta.
              */}
              {isLoading && <span className="hk-auth-spinner" aria-hidden="true" />}
              <span>{isLoading ? 'Creando tienda' : 'Crear tienda'}</span>
            </button>

            {isError && (
              <p className="hk-auth-alert" role="alert">
                {message || 'Error creando la tienda'}
              </p>
            )}
          </form>

          <p className="hk-auth-foot">
            ¿Ya tenés una cuenta?{' '}
            <Link className="hk-auth-link is-strong" to="/login">
              Ingresá
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  )
}

export default AdminRegister
