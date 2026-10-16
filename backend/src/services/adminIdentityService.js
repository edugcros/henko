// 📁 src/services/adminIdentityService.js
//
// Qué significa "este email ya es de un administrador" en toda la plataforma.

import User from '../models/userModel.js'

/**
 * ¿Ya hay un ADMINISTRADOR con este email, en cualquier comercio?
 *
 * LA REGLA QUE SE QUIERE PROTEGER
 *
 * Con el panel compartido el comercio se deduce del email
 * (resolveAdminTenantFromRequest busca `{ email, role: 'admin' }`), así que un
 * email solo puede ser admin de UN comercio: dos admins con el mismo email
 * dejarían el login y la recuperación de contraseña sin saber a cuál entrar.
 *
 * POR QUÉ SE FILTRA POR ROL
 *
 * El alta de comercio preguntaba `User.exists({ email })`, sin rol, o sea
 * "¿existe este email en alguna tienda, como lo que sea?". El índice de
 * usuarios es `{ email, tenantId }`: dos COMPRADORES pueden repetir email entre
 * tiendas, y es lo normal — alguien compra en varias. El efecto de la pregunta
 * sin rol era que cualquiera que alguna vez hubiera comprado en una tienda
 * cualquiera de la plataforma ya no podía abrir la suya ("El email ya está
 * registrado"), y de paso el mensaje revelaba que ese email estaba en alguna
 * tienda.
 *
 * Para la regla de arriba alcanza con mirar a los administradores.
 *
 * El cruce entre comercios es a propósito: la pregunta es de plataforma.
 *
 * @param {string} email ya normalizado
 * @param {import('mongoose').ClientSession|null} [session]
 * @returns {Promise<boolean>}
 */
export const adminEmailExists = async (email, session = null) => {
  const found = await User.exists({ email, role: 'admin' })
    .setOptions({ ignoreTenant: true, platformScope: 'auth:usuario-por-identidad' })
    .session(session)

  return Boolean(found)
}
