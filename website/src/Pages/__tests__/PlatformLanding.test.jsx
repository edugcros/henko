/* eslint-env jest */
import React from 'react'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlatformLanding, { normalizeHostname, shouldRenderPlatformLanding } from '../PlatformLanding'

jest.mock('@components/Meta', () => () => null)
jest.mock('@utils/adminUrl', () => ({
  buildAdminUrl: p => 'https://admin.example.test' + p,
  SUBSCRIPTION_PATH: '/subscripcion',
}))
jest.mock('../../config/env', () => ({ env: { apiBaseUrl: '/api' } }))

// La forma real de GET /subscriptions/plans.
const CATALOGO = {
  success: true,
  data: {
    currency: 'ARS',
    plans: [
      {
        plan: 'starter',
        monthlyPriceArs: 15000,
        currency: 'ARS',
        limits: { vision: 300, agentMessages: 2000, imageEdits: 100, marketAnalyses: 50 },
      },
      {
        plan: 'pro',
        monthlyPriceArs: 42000,
        currency: 'ARS',
        limits: { vision: 1500, agentMessages: 10000, imageEdits: 500, marketAnalyses: 250 },
      },
    ],
  },
}

const respuesta = body => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

// Solo la sección de planes: las maquetas ilustrativas de más arriba también tienen
// importes de ejemplo («$ 0.000») y no tienen nada que ver con el catálogo.
const planes = () => within(document.getElementById('planes'))

beforeEach(() => {
  // Por defecto el catálogo responde bien; cada prueba de precios lo pisa si necesita
  // otra cosa. Sin esto, las demás pruebas dependerían de un fetch que no existe en jsdom.
  global.fetch = jest.fn(() => respuesta(CATALOGO))
})

afterEach(() => {
  delete global.fetch
})

describe('PlatformLanding · íconos', () => {
  it('todos los íconos que importa existen en react-icons/fi', () => {
    // El 16/10/2026 la landing importaba FiPalette, que NO existe en Feather. El
    // import daba undefined, React lanzaba el error #130 al renderizarlo y se caía
    // la página entera en producción —solo ahí, y con un mensaje que no nombra el
    // ícono—. Este test lo atrapa con el nombre del que falta.
    const fuente = fs.readFileSync(path.resolve(__dirname, '../PlatformLanding.js'), 'utf8')
    const bloque = fuente.match(/import \{([^}]+)\} from 'react-icons\/fi'/)

    expect(bloque).not.toBeNull()

    const importados = bloque[1]
      .split(',')
      .map(n => n.trim())
      .filter(Boolean)
    const feather = jest.requireActual('react-icons/fi')
    const faltantes = importados.filter(nombre => typeof feather[nombre] !== 'function')

    expect(importados.length).toBeGreaterThan(20)
    expect(faltantes).toEqual([])
  })
})

describe('Cuándo se muestra la landing', () => {
  const RAIZ = 'henkart.com.ar'
  const ver = (hostname, pathname = '/', platformDomain = RAIZ) =>
    shouldRenderPlatformLanding({ hostname, pathname, platformDomain })

  it('se muestra en el dominio raíz', () => {
    expect(ver(RAIZ, '/')).toBe(true)
    expect(ver('www.henkart.com.ar', '/')).toBe(true)
    expect(ver('HENKART.com.ar', '/')).toBe(true)
  })

  it('NO tapa la vista previa del diseñador de tienda', () => {
    // El incidente del 16/10/2026. El iframe del diseñador del admin carga
    // <dominio raíz>/theme-preview; la landing se montaba igual y el comerciante veía
    // la página de marketing en lugar de la tienda que estaba diseñando.
    expect(ver(RAIZ, '/theme-preview')).toBe(false)
    expect(ver('www.henkart.com.ar', '/theme-preview')).toBe(false)
  })

  it('el resto de las rutas del dominio raíz siguen siendo la landing', () => {
    // Una URL con campaña, un enlace roto o una ruta desconocida muestran la landing:
    // en el dominio raíz no hay otra cosa que mostrar.
    expect(ver(RAIZ, '/')).toBe(true)
    expect(ver(RAIZ, '/inexistente')).toBe(true)
    expect(ver(RAIZ, '/theme-preview-otra-cosa')).toBe(true)
  })

  it('nunca se muestra en una tienda ni en el panel', () => {
    expect(ver('mitienda.henkart.com.ar')).toBe(false)
    expect(ver('admin.henkart.com.ar')).toBe(false)
    expect(ver('tienda-propia.com')).toBe(false)
    expect(ver('localhost')).toBe(false)
  })

  it('sin dominio configurado no se muestra: es lo seguro', () => {
    // Si falta REACT_APP_PUBLIC_BASE_DOMAIN, mostrar la landing en todos lados
    // taparía cualquier tienda.
    expect(ver(RAIZ, '/', '')).toBe(false)
    // Directo y no por `ver`: con undefined el valor por defecto del helper lo pisaría.
    expect(shouldRenderPlatformLanding({ hostname: RAIZ, pathname: '/' })).toBe(false)
    expect(ver('', '/', RAIZ)).toBe(false)
    expect(shouldRenderPlatformLanding()).toBe(false)
  })

  it('tolera cómo se escribe el dominio en la configuración', () => {
    expect(ver(RAIZ, '/', 'https://henkart.com.ar/')).toBe(true)
    expect(ver(RAIZ, '/', 'www.henkart.com.ar')).toBe(true)
    expect(ver('henkart.com.ar:3002', '/', 'henkart.com.ar:3002')).toBe(true)
    expect(normalizeHostname(' HTTPS://WWW.Henkart.com.ar:443/x ')).toBe('henkart.com.ar')
  })

  it('index.js decide con esta función y no solo por hostname', () => {
    // El bug estaba en el cableado, no en la lógica: index.js comparaba el hostname por
    // su cuenta. Si alguien vuelve a escribir esa comparación ahí, este test avisa.
    const fuente = fs.readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8')

    expect(fuente).toContain('shouldRenderPlatformLanding')
    expect(fuente).toContain('pathname: window.location.pathname')
    expect(fuente).not.toMatch(/const normalizeHostname/)
  })
})

describe('PlatformLanding · propuesta y enlaces', () => {
  it('tiene un solo h1 con la propuesta de valor', () => {
    render(<PlatformLanding />)

    const h1 = screen.getAllByRole('heading', { level: 1 })

    expect(h1).toHaveLength(1)
    expect(h1[0]).toHaveTextContent(/tu tienda online/i)
    expect(h1[0]).toHaveTextContent(/sin límites/i)
  })

  it('manda a los planes y al alta del panel, no a rutas internas', () => {
    render(<PlatformLanding />)

    const crear = screen.getAllByRole('link', { name: /crear mi tienda/i })
    const hrefs = crear.map(link => link.getAttribute('href'))

    expect(crear.length).toBeGreaterThan(1)
    expect(hrefs).toContain('https://admin.example.test/subscripcion')
    expect(hrefs).toContain('https://admin.example.test/signup')
    expect(
      screen
        .getAllByRole('link', { name: /ingresar/i })
        .some(link => link.getAttribute('href') === 'https://admin.example.test/login'),
    ).toBe(true)
  })

  it('tiene salto al contenido y anclas que existen', () => {
    const { container } = render(<PlatformLanding />)

    expect(screen.getByRole('link', { name: /saltar al contenido/i })).toHaveAttribute(
      'href',
      '#contenido',
    )

    const anclas = new Set(
      [...container.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href').slice(1)),
    )

    for (const id of anclas) {
      expect(container.querySelector(`#${id}`)).not.toBeNull()
    }
  })
})

describe('PlatformLanding · marca', () => {
  it('usa el logo original en el header y en el footer, no texto dibujado', () => {
    render(<PlatformLanding />)

    const logos = screen.getAllByAltText('Henkart')

    expect(logos).toHaveLength(2)
    for (const logo of logos) {
      expect(logo).toHaveAttribute('src', '/logo-henkart.png')
      // Con ancho y alto declarados la página no salta cuando carga la imagen.
      expect(logo).toHaveAttribute('width')
      expect(logo).toHaveAttribute('height')
    }
  })

  it('el logo del header es el enlace al inicio', () => {
    render(<PlatformLanding />)

    expect(screen.getByRole('link', { name: 'Henkart, inicio' })).toHaveAttribute('href', '#inicio')
  })
})

describe('PlatformLanding · carga de productos con IA', () => {
  const seccion = () => within(document.getElementById('productos-ia'))

  it('destaca la carga de productos con IA con su propia sección y su enlace en el menú', () => {
    render(<PlatformLanding />)

    expect(document.getElementById('productos-ia')).not.toBeNull()
    expect(screen.getByRole('heading', { name: /subí una foto/i })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /la ia arma la ficha completa/i }),
    ).toBeInTheDocument()
    expect(
      screen
        .getAllByRole('link', { name: 'Productos con IA' })
        .some(link => link.getAttribute('href') === '#productos-ia'),
    ).toBe(true)
  })

  it('lista los campos que la IA completa, los mismos que devuelve el análisis', () => {
    // Salen de sanitizeAnalysis (productAnalysisController): título, categoría,
    // subcategoría, marca, material, color, atributos, etiquetas, descripción, título y
    // descripción SEO y precio sugerido. Si el backend deja de devolver alguno, hay que
    // sacarlo de acá: la landing no puede prometer un campo que no se completa.
    render(<PlatformLanding />)

    for (const campo of [
      'Título',
      'Descripción',
      'Categoría y subcategoría',
      'Marca',
      'Material y color',
      'Atributos',
      'Etiquetas',
      'Título y descripción para buscadores',
      'Precio sugerido',
    ]) {
      expect(seccion().getByText(campo, { selector: 'li' })).toBeInTheDocument()
    }
  })

  it('explica el recorrido: varias fotos, la IA completa la ficha y se revisa antes de publicar', () => {
    render(<PlatformLanding />)

    expect(seccion().getByText(/una o varias a la vez/i)).toBeInTheDocument()
    expect(seccion().getByText('La IA completa la ficha')).toBeInTheDocument()
    expect(seccion().getByText(/queda como borrador/i)).toBeInTheDocument()
  })

  it('aclara que queda como borrador y que los cupos dependen del plan', () => {
    render(<PlatformLanding />)

    expect(
      seccion().getByText(/quedan como borrador hasta que los publicás.*dependen del plan/i),
    ).toBeInTheDocument()
  })

  it('NO promete que la IA publique sola', () => {
    // El producto que sale del análisis nace en 'draft'. Publicar sin revisión existe
    // como opción del servidor, pero depende de su configuración: no se ofrece.
    render(<PlatformLanding />)

    const texto = document.getElementById('productos-ia').textContent

    expect(texto).not.toMatch(
      /publica (solo|sola|automática)|sin revisión|sin revisar|automáticamente/i,
    )
    expect(texto).not.toMatch(/en segundos|al instante|100 ?%/i)
  })

  it('la maqueta del formulario se declara ilustrativa y sus montos son de ejemplo', () => {
    render(<PlatformLanding />)

    expect(
      seccion().getByText(/vista ilustrativa.*datos del producto son de ejemplo/i),
    ).toBeInTheDocument()
    // Ningún precio inventado: el rango sugerido va con ceros, como el carrito de ejemplo.
    expect(seccion().getByText(/0\.000 – 0\.000/)).toBeInTheDocument()
  })

  it('el CTA lleva a la pantalla de planes', () => {
    render(<PlatformLanding />)

    expect(seccion().getByRole('link', { name: /probarlo con mis productos/i })).toHaveAttribute(
      'href',
      'https://admin.example.test/subscripcion',
    )
  })

  it('la pregunta frecuente coincide con la sección: borrador y cupos por plan', async () => {
    const user = userEvent.setup()
    render(<PlatformLanding />)

    await user.click(screen.getByText('¿Cómo funciona la carga de productos con IA?'))

    expect(screen.getByText(/el producto queda como borrador/i)).toBeVisible()
    expect(screen.getByText(/cupos de análisis de imágenes dependen del plan/i)).toBeVisible()
  })

  it('el hero menciona que la IA completa la ficha de los productos', () => {
    render(<PlatformLanding />)

    expect(screen.getByText(/cargá tus productos con una foto/i)).toBeInTheDocument()
    expect(screen.getByText(/la ia completa la ficha de tus productos/i)).toBeInTheDocument()
  })
})

describe('PlatformLanding · funciones por pestañas', () => {
  it('abre en «Creá» y deja ocultas las otras tres', () => {
    render(<PlatformLanding />)

    const tabs = screen.getAllByRole('tab')

    expect(tabs.map(t => t.textContent)).toEqual(['Creá', 'Vendé', 'Gestioná', 'Crecé'])
    expect(screen.getByRole('tab', { name: 'Creá' })).toHaveAttribute('aria-selected', 'true')
    expect(
      screen.getByRole('heading', { name: /una tienda que se ve como tu marca/i }),
    ).toBeInTheDocument()
    // Los paneles ocultos no están en el árbol de accesibilidad.
    expect(
      screen.queryByRole('heading', { name: /todo para cobrar y convertir/i }),
    ).not.toBeInTheDocument()
  })

  it('cambia de panel al hacer clic', async () => {
    const user = userEvent.setup()
    render(<PlatformLanding />)

    await user.click(screen.getByRole('tab', { name: 'Vendé' }))

    expect(screen.getByRole('tab', { name: 'Vendé' })).toHaveAttribute('aria-selected', 'true')
    expect(
      screen.getByRole('heading', { name: /todo para cobrar y convertir/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /una tienda que se ve como tu marca/i }),
    ).not.toBeInTheDocument()
  })

  it('se maneja con el teclado: flechas, inicio y fin', async () => {
    const user = userEvent.setup()
    render(<PlatformLanding />)

    screen.getByRole('tab', { name: 'Creá' }).focus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Vendé' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Vendé' })).toHaveFocus()

    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Crecé' })).toHaveAttribute('aria-selected', 'true')

    // Da la vuelta: de la última pasa a la primera.
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Creá' })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Crecé' })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Creá' })).toHaveAttribute('aria-selected', 'true')
  })

  it('solo la pestaña activa entra en el orden de tabulación', () => {
    render(<PlatformLanding />)

    const tabs = screen.getAllByRole('tab')

    expect(tabs.filter(t => t.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(tabs.filter(t => t.getAttribute('tabindex') === '-1')).toHaveLength(3)
  })

  it('cada pestaña controla un panel que la nombra', () => {
    render(<PlatformLanding />)

    for (const tab of screen.getAllByRole('tab')) {
      const panel = document.getElementById(tab.getAttribute('aria-controls'))

      expect(panel).not.toBeNull()
      expect(panel).toHaveAttribute('role', 'tabpanel')
      expect(panel).toHaveAttribute('aria-labelledby', tab.id)
    }
  })

  it('los verbos del hero seleccionan la pestaña correspondiente', async () => {
    const user = userEvent.setup()
    render(<PlatformLanding />)

    const verbos = screen.getByLabelText(/las cuatro etapas de tu tienda/i)

    await user.click(within(verbos).getByRole('link', { name: 'Gestioná' }))

    expect(screen.getByRole('tab', { name: 'Gestioná' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: /tu operación, bajo control/i })).toBeInTheDocument()
  })

  it('marca como «Profesional» solo lo que es de ese plan', () => {
    render(<PlatformLanding />)

    // Reportes avanzados y varios administradores: son los dos ítems que el catálogo
    // de planes (admin/src/constants/plans.js) reserva al plan Profesional.
    const etiquetas = [...document.querySelectorAll('.hk-plan-tag')]

    expect(etiquetas).toHaveLength(2)
    expect(etiquetas.map(e => e.closest('b').textContent)).toEqual([
      expect.stringContaining('Reportes avanzados'),
      expect.stringContaining('Varios administradores'),
    ])
  })
})

describe('PlatformLanding · planes con precios en vivo', () => {
  it('lee el catálogo público, sin sesión', async () => {
    render(<PlatformLanding />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))

    const [url, opciones] = global.fetch.mock.calls[0]

    expect(url).toBe('/api/subscriptions/plans')
    // Es una vidriera: no manda cookies ni nada de la sesión.
    expect(opciones.credentials).toBe('omit')
  })

  it('muestra el precio y los cupos de cada plan tal como los devuelve el backend', async () => {
    render(<PlatformLanding />)

    // \s y no un espacio: Intl separa el signo del número con un espacio duro.
    expect(await screen.findByText(/\$\s*15\.000/)).toBeInTheDocument()
    expect(screen.getByText(/\$\s*42\.000/)).toBeInTheDocument()

    expect(screen.getByText(/300 análisis de imágenes con IA por mes/)).toBeInTheDocument()
    expect(screen.getByText(/2\.000 mensajes del asistente de ventas por mes/)).toBeInTheDocument()
    expect(screen.getByText(/10\.000 mensajes del asistente de ventas por mes/)).toBeInTheDocument()
  })

  it('mientras el backend responde muestra un esqueleto y no un número', () => {
    // Render Free duerme el servicio: la primera respuesta puede tardar. La página
    // no puede quedar esperando ni mostrar un precio inventado mientras tanto.
    global.fetch = jest.fn(() => new Promise(() => {}))

    render(<PlatformLanding />)

    expect(screen.getAllByLabelText('Cargando precio')).toHaveLength(2)
    expect(planes().queryByText(/\$\s*\d/)).not.toBeInTheDocument()
    // Los botones y las funciones del plan están desde el primer momento.
    expect(screen.getByRole('link', { name: /elegir emprendedor/i })).toBeInTheDocument()
    expect(screen.getByText('Hasta 100 productos')).toBeInTheDocument()
  })

  it('si el catálogo falla, manda a la pantalla de planes en vez de inventar un precio', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('sin red')))

    render(<PlatformLanding />)

    expect(await screen.findAllByText('Consultá el precio vigente')).toHaveLength(2)
    expect(planes().queryByText(/\$\s*\d/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /elegir profesional/i })).toHaveAttribute(
      'href',
      'https://admin.example.test/subscripcion',
    )
  })

  it('un precio en cero o ausente cuenta como «sin precio»', async () => {
    global.fetch = jest.fn(() =>
      respuesta({
        data: {
          plans: [
            { plan: 'starter', monthlyPriceArs: 0, limits: {} },
            { plan: 'pro', monthlyPriceArs: null, limits: {} },
          ],
        },
      }),
    )

    render(<PlatformLanding />)

    // Un plan «gratis» por un dato faltante sería peor que no mostrar nada.
    expect(await screen.findAllByText('Consultá el precio vigente')).toHaveLength(2)
  })

  it('una respuesta con otra forma no rompe la página', async () => {
    global.fetch = jest.fn(() => respuesta({ success: false }))

    render(<PlatformLanding />)

    expect(await screen.findAllByText('Consultá el precio vigente')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: /elegí el plan/i })).toBeInTheDocument()
  })

  it('responde con error HTTP: lo trata como falla y sigue mostrando los planes', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 503, json: () => ({}) }))

    render(<PlatformLanding />)

    expect(await screen.findAllByText('Consultá el precio vigente')).toHaveLength(2)
  })
})

describe('PlatformLanding · preguntas frecuentes', () => {
  it('lista las preguntas y cada una abre su respuesta', async () => {
    const user = userEvent.setup()
    const { container } = render(<PlatformLanding />)

    const items = container.querySelectorAll('details.hk-faq-item')

    expect(items).toHaveLength(8)
    expect(items[0]).not.toHaveAttribute('open')

    await user.click(screen.getByText(/¿cómo gestiono los envíos\?/i))

    expect(screen.getByText(/lo coordinás vos con el servicio que prefieras/i)).toBeVisible()
  })
})

describe('PlatformLanding · no promete lo que el producto no tiene', () => {
  it('no nombra integraciones, medios de pago ni competidores que no existen', () => {
    const { container } = render(<PlatformLanding />)
    const texto = container.textContent

    // El seguimiento de envíos es un campo manual (transportista y número), no una
    // integración. Mercado Pago es el único medio de cobro. Y la marca no se
    // compara con otras.
    expect(texto).not.toMatch(/andreani|correo argentino|\boca\b|paypal|stripe|uala|modo\b/i)
    expect(texto).not.toMatch(/shopify|tienda ?nube|mercado ?shops/i)
  })

  it('no incluye testimonios ni cifras de clientes que no existen', () => {
    const { container } = render(<PlatformLanding />)
    const texto = container.textContent

    expect(texto).not.toMatch(/testimonio|clientes felices|miles de (tiendas|comercios)/i)
    expect(texto).not.toMatch(/\+?\d[\d.]*\s*(tiendas|comercios|emprendedores) (ya|confían)/i)
  })

  it('las maquetas dicen que son ilustrativas', () => {
    render(<PlatformLanding />)

    // Cuatro maquetas por pestaña + el panel del hero + el chat + el formulario de producto.
    expect(screen.getAllByText(/ilustrativ/i).length).toBeGreaterThanOrEqual(7)
  })
})

describe('Activos de marca (website/public)', () => {
  const pub = file => path.resolve(__dirname, '../../../public', file)
  const leer = file => fs.readFileSync(pub(file))
  const md5 = buffer => crypto.createHash('md5').update(buffer).digest('hex')

  // Alto y ancho de un PNG: están en el chunk IHDR, bytes 16 a 23.
  const dimensiones = buffer => ({ w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) })
  const esPng = buffer =>
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

  it('no vuelven los logos de plantilla (Redux) que había en lugar de los de Henkart', () => {
    // Hasta el 16/10/2026 favicon.ico, logo192.png y logo512.png eran el logo de
    // Redux, sobrante del proyecto base. Estos son sus hashes.
    const deRedux = [
      '6604f1b97a99363e21fd9047106a43bd', // logo512.png
      '5a60411726275fc4f53901dc0e0a8799', // logo192.png
      '33f82a8624804deb12b8bff4e774fb71', // favicon.ico
    ]

    for (const file of ['logo512.png', 'logo192.png', 'favicon.ico']) {
      expect(deRedux).not.toContain(md5(leer(file)))
    }
  })

  it('favicon.ico es un ICO de verdad con 16, 32 y 48 px', () => {
    const ico = leer('favicon.ico')

    // Antes era un PNG con extensión .ico: andaba, pero no era lo que decía ser.
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(3)
    expect([0, 1, 2].map(i => ico[6 + i * 16])).toEqual([16, 32, 48])
  })

  it('los íconos de la app y el lockup tienen el tamaño que declaran', () => {
    for (const [file, w, h] of [
      ['logo192.png', 192, 192],
      ['logo512.png', 512, 512],
      ['logo-henkart.png', 443, 132],
      ['og-image.png', 1200, 630],
    ]) {
      const png = leer(file)

      expect(esPng(png)).toBe(true)
      expect(dimensiones(png)).toEqual({ w, h })
    }
  })

  it('el lockup del header respeta la proporción de los atributos width/height', () => {
    const { w, h } = dimensiones(leer('logo-henkart.png'))

    render(<PlatformLanding />)

    const [logo] = screen.getAllByAltText('Henkart')
    const proporcion = Number(logo.getAttribute('width')) / Number(logo.getAttribute('height'))

    expect(proporcion).toBeCloseTo(w / h, 1)
  })

  it('el logo es transparente: se apoya sobre cualquier superficie oscura', () => {
    const png = leer('logo-henkart.png')

    // Tipo de color 6 (RGBA) o paleta con chunk tRNS. Con el fondo azul noche
    // horneado del original se vería un rectángulo sobre el degradé del hero.
    const tieneAlfa = png[25] === 6 || png.includes(Buffer.from('tRNS'))

    expect(tieneAlfa).toBe(true)
  })

  it('el logo se sirve optimizado: el original de 1,4 MB no va en public/', () => {
    // El archivo fuente (2172×724, fondo opaco) pesa 1,4 MB. En el header carga en
    // cada visita, así que se publica la versión recortada y con alfa.
    expect(leer('logo-henkart.png').length).toBeLessThan(150 * 1024)
    expect(leer('og-image.png').length).toBeLessThan(200 * 1024)
  })

  it('el manifest se llama Henkart y apunta a íconos que existen', () => {
    const manifest = JSON.parse(leer('manifest.json').toString('utf8'))

    expect(manifest.name).toMatch(/henkart/i)
    expect(manifest.short_name).toBe('Henkart')
    expect(`${manifest.name}${manifest.short_name}`).not.toMatch(/henko/i)

    for (const icon of manifest.icons) {
      expect(fs.existsSync(pub(icon.src.replace(/^\//, '')))).toBe(true)
    }
  })

  it('index.html declara la imagen para compartir, el ícono de iOS y el color de marca', () => {
    const html = leer('index.html').toString('utf8')

    expect(html).toContain('og:image" content="https://henkart.com.ar/og-image.png')
    expect(html).toContain('twitter:card" content="summary_large_image')
    expect(html).toContain('rel="apple-touch-icon" href="/logo192.png"')
    expect(html).toContain('name="theme-color" content="#050b1f"')
    // Montserrat es la tipografía de los títulos: si no se pide, cae a Rubik sin avisar.
    expect(html).toContain('family=Montserrat')
  })
})
