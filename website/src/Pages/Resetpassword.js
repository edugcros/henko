import React, { useState, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { resetPassword, clearState } from '@features/user/userSlice'
import Container from '@components/Container'
import CustomInput from '@components/CustomInput'

const ResetPassword = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { token } = useParams() // ✅ Captura el token de la URL
  console.log(token)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const { isLoading, isError, isSuccess, message } = useSelector(state => state.user)

  const handleSubmit = e => {
    e.preventDefault()
    if (!password || !confirmPassword) {
      toast.error('Todos los campos son obligatorios.')
      return
    }
    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden.')
      return
    }

    // ✅ Envía el token y la nueva contraseña al backend
    dispatch(resetPassword({ token, password, confirmPassword }))
  }

  useEffect(() => {
    if (isError) {
      toast.error(message || 'Error al restablecer la contraseña.')
      dispatch(clearState())
    }
    if (isSuccess) {
      toast.success(message || 'Contraseña restablecida con éxito.')
      setTimeout(() => {
        navigate('/login')
        dispatch(clearState())
      }, 35000)
    }
  }, [isError, isSuccess, message, dispatch, navigate])

  return (
    <Container class1="login-wrapper py-5 home-wrapper-2">
      <div className="row">
        <div className="col-12">
          <div className="auth-card">
            <h3 className="text-center mb-3">Restablecer Contraseña</h3>
            <form onSubmit={handleSubmit} className="d-flex flex-column gap-15">
              <CustomInput
                type="password"
                name="password"
                placeholder="Nueva Contraseña"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              <CustomInput
                type="password"
                name="confirmPassword"
                placeholder="Confirmar Contraseña"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
              />
              <div className="mt-3 d-flex justify-content-center flex-column gap-15 align-items-center">
                <button className="button border-0" type="submit" disabled={isLoading}>
                  {isLoading ? 'Restableciendo...' : 'Restablecer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </Container>
  )
}

export default ResetPassword
