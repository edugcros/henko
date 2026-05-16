// 📁 src/Components/PublicLayout.jsx
import React from 'react'
import { Outlet } from 'react-router-dom'
// 🔴 CAMBIO: Usamos el CustomHeader que tiene la lógica de Cloudinary y SaaS
import CustomHeader from '@components/CustomHeader'
import Footer from '@components/Footer'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

const PublicLayout = () => (
  <>
    {/* Renderizamos el Header inteligente */}
    <CustomHeader />

    <main style={{ minHeight: '80vh' }}>
      <Outlet />
    </main>

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

export default PublicLayout
