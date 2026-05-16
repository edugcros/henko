// 📄 src/App.js
import React from 'react'
import { ToastContainer } from 'react-toastify'
import RouteRenderer from './routes/RouteRenderer'
import { useAuth } from '@hooks/useAuth' // Hook personalizado para autenticación
import SpinnerCentered from '@components/SpinnerCentered.jsx' // Opcional: o null

function App() {
  const { isAuthenticated, isLoading } = useAuth()

  // 🌀 Esperar validación de token antes de continuar
  if (isLoading) return <SpinnerCentered /> // o null

  return (
    <>
      <ToastContainer position="top-center" autoClose={3001} />
      <RouteRenderer isLoggedIn={isAuthenticated} />
    </>
  )
}

export default App
