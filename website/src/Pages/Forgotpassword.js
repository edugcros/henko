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

  const { isLoading, isError, isSuccess, message } = useSelector(state => state.user)

  useEffect(() => {
    // Este useEffect solo se activa cuando isError o isSuccess cambian,
    // NO cuando el componente se renderiza inicialmente.
    if (isError) {
      toast.error(message || 'Error al enviar el correo. Intenta de nuevo.')
      dispatch(clearState())
    }

    if (isSuccess) {
      setEmail('')
      const redirectTimer = setTimeout(() => {
        navigate('/login')
        dispatch(clearState())
      }, 50000)

      return () => clearTimeout(redirectTimer)
    }
  }, [isError, isSuccess, message, dispatch, navigate])

  const validateEmail = email => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return re.test(String(email).toLowerCase())
  }

  const handleSubmit = e => {
    e.preventDefault()
    if (!email || !validateEmail(email)) {
      toast.error('Por favor, ingresa un correo electrónico válido.')
      return
    }
    // La acción de Redux se dispara SOLO al enviar el formulario
    dispatch(requestPasswordReset(email))
  }

  return (
    <Container class1="login-wrapper py-5 home-wrapper-2">
      <div className="row">
        <div className="col-12">
          <div className="auth-card">
            <h3 className="text-center mb-3">Restablecer Contraseña</h3>
            <p className="text-center mt-2 mb-3">
              Ingresa tu correo electrónico para enviarte un enlace de recuperación.
            </p>
            <form onSubmit={handleSubmit} className="d-flex flex-column gap-15">
              <CustomInput
                type="email"
                name="email"
                placeholder="Correo electrónico"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />

              <div className="mt-3 d-flex justify-content-center flex-column gap-15 align-items-center">
                <button className="button border-0" type="submit" disabled={isLoading}>
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
