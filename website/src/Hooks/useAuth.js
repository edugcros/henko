// 📁 src/hooks/useAuth.js
import { useEffect, useState, useMemo } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { jwtDecode } from 'jwt-decode'
import { loginUser, logoutUser } from '@features/user/userSlice'

/**
 * Hook para manejar la sesión del usuario en el Frontend.
 * Nota: No busca el JWT en cookies porque es httpOnly (invisible para JS).
 * Se basa en el objeto 'user' de Redux y sessionStorage.
 */
export const useAuth = () => {
  const dispatch = useDispatch()
  const userFromRedux = useSelector(state => state.user?.user)
  const [isLoading, setIsLoading] = useState(true)

  // Utilidad para persistencia manual del usuario (No sensible)
  const safeStorage = useMemo(
    () => ({
      getUser: () => {
        try {
          const item = sessionStorage.getItem('user')
          return item && item !== 'undefined' ? JSON.parse(item) : null
        } catch (e) {
          return null
        }
      },
      removeUser: () => sessionStorage.removeItem('user'),
    }),
    [],
  )

  useEffect(() => {
    const hydrateAuth = () => {
      const userStorage = safeStorage.getUser()

      // Si tenemos usuario en storage pero no en Redux, hidratamos el estado
      if (userStorage && !userFromRedux) {
        dispatch(loginUser(userStorage))
      }

      setIsLoading(false)
    }

    hydrateAuth()
  }, [dispatch, userFromRedux, safeStorage])

  /**
   * isAuthenticated:
   * Ahora se basa en la existencia del objeto user en Redux.
   * El Backend es quien realmente valida la sesión vía cookies.
   */
  const isAuthenticated = !!userFromRedux
  const userRole = userFromRedux?.role || 'user'
  const isBlocked = !!userFromRedux?.isBlocked

  return {
    isAuthenticated,
    userRole,
    user: userFromRedux,
    isLoading,
    isBlocked,
    // El token no se expone aquí porque JS no debe manipularlo (Seguridad)
  }
}
