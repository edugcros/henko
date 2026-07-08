// 📄 src/App.js
import React from 'react'
import { ToastContainer } from 'react-toastify'
import RouteRenderer from './routes/RouteRenderer'
import { useAuth } from '@hooks/useAuth'
import SpinnerCentered from '@components/SpinnerCentered.jsx'

function App() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return <SpinnerCentered />
  }

  return (
    <>
      <ToastContainer position="top-center" autoClose={3000} />
      <RouteRenderer isLoggedIn={isAuthenticated} />
    </>
  )
}

export default App
