// 📁 src/Components/PrivateLayout.jsx
import React from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '@hooks/useAuth'
import SpinnerCentered from '@components/SpinnerCentered/SpinnerCentered'
import CustomHeader from '@components/CustomHeader'
import Footer from '@components/Footer'
import { ToastContainer, toast } from 'react-toastify'

const PrivateLayout = () => {
  const { isAuthenticated, isBlocked, isLoading } = useAuth()

  if (isLoading) return <SpinnerCentered />

  if (!isAuthenticated || isBlocked) {
    if (isBlocked) {
      toast.error('Tu cuenta ha sido bloqueada.')
    }
    return <Navigate to="/login" replace />
  }

  return (
    <>
      <CustomHeader />
      <Outlet />
      <Footer />
      <ToastContainer
        position="top-right"
        autoClose={4000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
    </>
  )
}

export default PrivateLayout
