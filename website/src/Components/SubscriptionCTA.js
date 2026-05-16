// src/components/SubscriptionCTA.js
import React from 'react'

const SubscriptionCTA = () => {
  const handleGoToSubscription = () => {
    const isLocal =
      window.location.hostname.includes('localhost') || window.location.hostname.endsWith('.local')

    // Si estamos en local, apuntamos al puerto 3001 (tu admin),
    // si no, apuntamos al dominio de producción del admin.
    const adminBaseUrl = isLocal
      ? 'http://admin.henko.local:3001'
      : `https://admin.${process.env.REACT_APP_PRODUCTION_DOMAIN}`

    // Redirigimos a la sección de suscripción dentro del Admin
    window.location.href = `${adminBaseUrl}/subscription`
  }

  return (
    <button
      onClick={handleGoToSubscription}
      className="btn-senior-style" // Tu estilo aquí
    >
      Comprar Ecommerce / Crear Tienda
    </button>
  )
}
