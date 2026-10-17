// 📁 src/components/AuthShell.js
//
// El marco común de las pantallas de acceso (ingresar, recuperar contraseña, crear tienda):
// panel de marca a la izquierda y, a la derecha, lo que cada pantalla pone adentro. Antes
// cada una tenía su propio fondo y su propia tarjeta, y no se parecían entre sí.
//
// Lo que dice el panel de marca sale de lo que el producto hace hoy y repite lo que ya dice
// la pantalla de planes: no hay promesas nuevas, y no se anuncia la prueba gratis.
import React from 'react'
import { CreditCardOutlined, GlobalOutlined, RobotOutlined, ShopOutlined } from '@ant-design/icons'
import { env } from '../config/env.js'
import logoHenkart from '../assets/images/logo-henkart.png'
import './AuthShell.css'

const PITCHES = {
  // Para quien ya tiene tienda y entra a trabajar.
  panel: {
    eyebrow: 'PANEL DE ADMINISTRACIÓN',
    title: 'Tu tienda, ',
    accent: 'lista para vender.',
    items: [
      {
        icon: ShopOutlined,
        title: 'Pedidos, clientes y stock',
        text: 'Todo lo de tu tienda en un solo panel, en español.',
      },
      {
        icon: CreditCardOutlined,
        title: 'Cobros con Mercado Pago',
        text: 'Cobrás desde tu tienda, en tu propia cuenta.',
      },
      {
        icon: RobotOutlined,
        title: 'IA para vender',
        text: 'Fichas de producto y asistente de ventas, con cupos según tu plan.',
      },
    ],
  },
  // Para quien todavía no tiene tienda.
  alta: {
    eyebrow: 'CREÁ TU TIENDA',
    title: 'Tu marca, ',
    accent: 'tu tienda online.',
    items: [
      {
        icon: GlobalOutlined,
        title: 'Tu propia dirección',
        text: 'Subdominio de Henkart incluido, y podés conectar tu dominio.',
      },
      {
        icon: CreditCardOutlined,
        title: 'Cobros con Mercado Pago',
        text: 'Conectás tu cuenta y cobrás desde tu tienda.',
      },
      {
        icon: RobotOutlined,
        title: 'IA para cargar productos',
        text: 'Subís una foto y la IA completa la ficha del producto.',
      },
    ],
  },
}

const urlDelSitio = () => {
  const dominio = String(env?.publicBaseDomain || '').trim()

  if (!dominio) return null
  if (/^https?:\/\//i.test(dominio)) return dominio

  return `${window.location.protocol}//${dominio}`
}

/**
 * @param {'panel'|'alta'} [variant] qué le dice el panel de marca a quien llega.
 * @param {string} titleId id del h1 de la pantalla, para nombrar la región principal.
 * @param {boolean} [wide] tarjeta más ancha, para formularios largos.
 */
const AuthShell = ({ variant = 'panel', titleId, wide = false, children }) => {
  const pitch = PITCHES[variant] || PITCHES.panel
  const sitio = urlDelSitio()
  const logo = (
    <img className="hk-auth-logo" src={logoHenkart} alt="Henkart" width="156" height="35" />
  )

  return (
    <main className="hk-auth">
      <aside className="hk-auth-brand">
        <div className="hk-auth-brand-inner">
          {sitio ? (
            <a href={sitio} aria-label="Henkart, volver al sitio">
              {logo}
            </a>
          ) : (
            logo
          )}

          <div className="hk-auth-pitch">
            <span className="hk-auth-eyebrow">{pitch.eyebrow}</span>
            <p className="hk-auth-tagline">
              {pitch.title}
              <span className="hk-auth-gradient">{pitch.accent}</span>
            </p>

            <ul className="hk-auth-benefits">
              {pitch.items.map(item => {
                const Icon = item.icon

                return (
                  <li key={item.title}>
                    <span className="hk-auth-benefit-icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <span>
                      <b>{item.title}</b>
                      <small>{item.text}</small>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </aside>

      <section className="hk-auth-main" aria-labelledby={titleId}>
        <div className={`hk-auth-card${wide ? ' is-wide' : ''}`}>{children}</div>
      </section>
    </main>
  )
}

export default AuthShell
