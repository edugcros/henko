// 📁 src/pages/Forgotpassword.js
import React, { useState } from 'react'
import { useFormik } from 'formik'
import { Link } from 'react-router-dom'
import * as yup from 'yup'
import { MailOutlined } from '@ant-design/icons'
import authService from '@features/auth/authServices'
import AuthShell from '../components/AuthShell.js'

const validationSchema = yup.object({
  email: yup.string().email('Debe ser un correo válido').required('El correo es obligatorio'),
})

const Forgotpassword = () => {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState({ sent: false, error: '' })

  const formik = useFormik({
    initialValues: { email: '' },
    validationSchema,
    onSubmit: async values => {
      setIsSubmitting(true)
      setResult({ sent: false, error: '' })

      try {
        await authService.forgotPassword(values.email.trim().toLowerCase())
        // El backend siempre responde éxito exista o no la cuenta (evita
        // que este formulario sirva para confirmar qué emails están
        // registrados) — el mensaje refleja eso, no "listo, te llegó".
        setResult({ sent: true, error: '' })
      } catch (error) {
        setResult({
          sent: false,
          error:
            error?.message || 'No pudimos procesar la solicitud. Probá de nuevo en unos minutos.',
        })
      } finally {
        setIsSubmitting(false)
      }
    },
  })

  const errorEmail = formik.touched.email && formik.errors.email

  return (
    <AuthShell titleId="forgot-title">
      <h1 id="forgot-title">Recuperá tu contraseña</h1>
      <p className="hk-auth-lead">
        Ingresá el correo de tu cuenta y te enviamos un enlace para restablecerla.
      </p>

      {result.sent ? (
        <>
          <div className="hk-auth-notice" role="status">
            <span className="hk-auth-notice-icon" aria-hidden="true">
              <MailOutlined />
            </span>
            <div>
              <b>Revisá tu correo</b>
              <p>
                Si el correo existe en nuestro sistema, vas a recibir un enlace para restablecer tu
                contraseña en unos minutos.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="hk-auth-ghost"
            onClick={() => setResult({ sent: false, error: '' })}
          >
            Usar otro correo
          </button>
        </>
      ) : (
        <form onSubmit={formik.handleSubmit} noValidate>
          <div className="hk-auth-field">
            <label htmlFor="email">Correo electrónico</label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
              aria-invalid={Boolean(errorEmail)}
              aria-describedby={errorEmail ? 'email-error' : undefined}
              {...formik.getFieldProps('email')}
            />
            {errorEmail && (
              <p className="hk-auth-field-error" id="email-error">
                {formik.errors.email}
              </p>
            )}
          </div>

          <button type="submit" className="hk-auth-submit" disabled={isSubmitting}>
            {/* Texto envuelto, no desnudo: ver website/src/Pages/Login.js. */}
            {isSubmitting && <span className="hk-auth-spinner" aria-hidden="true" />}
            <span>{isSubmitting ? 'Enviando' : 'Enviar enlace'}</span>
          </button>

          {result.error && (
            <p className="hk-auth-alert" role="alert">
              {result.error}
            </p>
          )}
        </form>
      )}

      <p className="hk-auth-foot">
        <Link className="hk-auth-link is-strong" to="/login">
          Volver a iniciar sesión
        </Link>
      </p>
    </AuthShell>
  )
}

export default Forgotpassword
