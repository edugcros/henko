import React, { useState, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate, Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { requestPasswordReset, clearState } from '@features/user/userSlice'
import Container from '@components/Container'
import CustomInput from '@components/CustomInput'

const ForgotPassword = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')

  const { isLoading, isError, isSuccess, message } = useSelector(
    state => state.user,
  )

  useEffect(() => {
    if (isError) {
      toast.error(message || 'Error al enviar el correo. Intenta de nuevo.')
      dispatch(clearState())
      return
    }

    if (isSuccess) {
      toast.success(
        message || 'Te enviamos un correo para restablecer tu contraseña.',
      )

      setEmail('')

      const redirectTimer = window.setTimeout(() => {
        dispatch(clearState())
        navigate('/login')
      }, 5000)

      return () => {
        window.clearTimeout(redirectTimer)
      }
    }

    return undefined
  }, [isError, isSuccess, message, dispatch, navigate])

  const validateEmail = value => {
    const cleanEmail = String(value || '')
      .trim()
      .toLowerCase()
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    return regex.test(cleanEmail)
  }

  const handleSubmit = e => {
    e.preventDefault()

    const cleanEmail = email.trim().toLowerCase()

    if (!validateEmail(cleanEmail)) {
      toast.error('Por favor, ingresa un correo electrónico válido.')
      return
    }

    dispatch(requestPasswordReset(cleanEmail))
  }

  return (
    <Container class1="login-wrapper py-5 home-wrapper-2">
      <div className="row">
        <div className="col-12">
          <div className="auth-card">
            <h3 className="text-center mb-3">Restablecer Contraseña</h3>

            <p className="text-center mt-2 mb-3">
              Ingresa tu correo electrónico para enviarte un enlace de
              recuperación.
            </p>

            <form onSubmit={handleSubmit} className="d-flex flex-column gap-15">
              <CustomInput
                type="email"
                name="email"
                placeholder="Correo electrónico"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                disabled={isLoading}
              />

              <div className="mt-3 d-flex justify-content-center flex-column gap-15 align-items-center">
                <button
                  className="button border-0"
                  type="submit"
                  disabled={isLoading}
                >
                  {isLoading ? 'Enviando...' : 'Enviar'}
                </button>

                <Link to="/login">Cancelar</Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </Container>
  )
}

export default ForgotPassword
