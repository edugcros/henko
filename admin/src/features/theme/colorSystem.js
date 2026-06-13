export const DEFAULT_THEME_COLORS = {
  primary: '#1976d2',
  secondary: '#dc004e',
  accent: '#ff9800',
  background: '#ffffff',
  surface: '#f5f5f5',
  headerBackground: '#ffffff',
  headerText: '#1a1a1a',
  headerLink: '#1976d2',
  headerIcon: '#666666',
  cardBackground: '#f5f5f5',
  cardText: '#1a1a1a',
  cardMutedText: '#666666',
  cardBorder: '#e0e0e0',
  cardPrice: '#1976d2',
  text: '#1a1a1a',
  mutedText: '#666666',
  border: '#e0e0e0',
  actionPrimary: '#1976d2',
  actionPrimaryText: '#ffffff',
  actionSecondary: '#dc004e',
  actionSecondaryText: '#ffffff',
  link: '#1976d2',
  price: '#1976d2',
  salePrice: '#d32f2f',
  badgeBackground: '#dc004e',
  badgeText: '#ffffff',
  success: '#2e7d32',
  error: '#d32f2f',
  info: '#0288d1',
  warning: '#ed6c02',
}

export const COLOR_ROLE_GROUPS = [
  {
    id: 'brand',
    title: 'Marca',
    description:
      'Identidad visual de la tienda. No debe controlar botones, cards ni header por sí sola.',
    fields: [
      {
        key: 'primary',
        label: 'Marca primaria',
        appliesTo:
          'Acentos de marca, recursos editoriales y detalles de identidad.',
      },
      {
        key: 'secondary',
        label: 'Marca secundaria',
        appliesTo: 'Segunda familia de marca para soportes visuales.',
      },
      {
        key: 'accent',
        label: 'Acento',
        appliesTo:
          'Énfasis puntual, destacados visuales e iconografía editorial.',
      },
    ],
  },
  {
    id: 'layout',
    title: 'Layout base',
    description:
      'Base estructural del sitio. No debe modificar header, card ni botones especializados.',
    fields: [
      {
        key: 'background',
        label: 'Fondo de página',
        appliesTo: 'Canvas general, secciones amplias y fondo del storefront.',
      },
      {
        key: 'surface',
        label: 'Superficie base',
        appliesTo:
          'Bloques genéricos del layout, modales y superficies no especializadas.',
      },
      {
        key: 'text',
        label: 'Texto principal',
        appliesTo: 'Títulos y contenido principal fuera de header y cards.',
      },
      {
        key: 'mutedText',
        label: 'Texto secundario',
        appliesTo: 'Descripciones, metadatos y texto auxiliar fuera de cards.',
      },
      {
        key: 'border',
        label: 'Borde base',
        appliesTo: 'Separadores e inputs genéricos del layout.',
      },
    ],
  },
  {
    id: 'header',
    title: 'Header',
    description:
      'Control exclusivo del encabezado. Estos cambios no deben mover colores de cards ni CTAs.',
    fields: [
      {
        key: 'headerBackground',
        label: 'Header fondo',
        appliesTo: 'Barra superior y contenedor principal del encabezado.',
      },
      {
        key: 'headerText',
        label: 'Header texto',
        appliesTo: 'Marca, títulos y texto informativo dentro del header.',
      },
      {
        key: 'headerLink',
        label: 'Header links',
        appliesTo: 'Navegación textual y links dentro del header.',
      },
      {
        key: 'headerIcon',
        label: 'Header iconos',
        appliesTo: 'Iconos, contadores y acciones visuales del header.',
      },
    ],
  },
  {
    id: 'card',
    title: 'Cards y paneles',
    description:
      'Control exclusivo de tarjetas, paneles y bloques de producto. No debe mover header ni fondo general.',
    fields: [
      {
        key: 'cardBackground',
        label: 'Card fondo',
        appliesTo:
          'Fondo de cards de producto, paneles laterales y bloques elevados.',
      },
      {
        key: 'cardText',
        label: 'Card texto',
        appliesTo: 'Texto principal dentro de cards y paneles.',
      },
      {
        key: 'cardMutedText',
        label: 'Card texto secundario',
        appliesTo: 'Metadatos y descripciones secundarias dentro de cards.',
      },
      {
        key: 'cardBorder',
        label: 'Card borde',
        appliesTo: 'Bordes y contornos de cards, fichas y paneles.',
      },
      {
        key: 'cardPrice',
        label: 'Card precio',
        appliesTo: 'Precio destacado dentro de cards de producto.',
      },
    ],
  },
  {
    id: 'action',
    title: 'Acciones y navegación',
    description:
      'Sistema de CTA y enlaces. Debe controlar interacción, no la identidad global del layout.',
    fields: [
      {
        key: 'actionPrimary',
        label: 'Botón primario',
        appliesTo: 'Relleno de CTAs principales: comprar, guardar, continuar.',
      },
      {
        key: 'actionPrimaryText',
        label: 'Texto botón primario',
        appliesTo: 'Texto e iconos dentro del botón primario.',
      },
      {
        key: 'actionSecondary',
        label: 'Botón secundario',
        appliesTo: 'Relleno o borde de acciones secundarias.',
      },
      {
        key: 'actionSecondaryText',
        label: 'Texto botón secundario',
        appliesTo: 'Texto e iconos dentro del botón secundario.',
      },
      {
        key: 'link',
        label: 'Links generales',
        appliesTo: 'Links fuera del header y fuera de botones.',
      },
    ],
  },
  {
    id: 'commerce',
    title: 'Ecommerce',
    description:
      'Señales comerciales del catálogo. Deben quedar separadas de acciones y layout.',
    fields: [
      {
        key: 'price',
        label: 'Precio general',
        appliesTo: 'Precio fuera de cards, resúmenes y vistas de detalle.',
      },
      {
        key: 'salePrice',
        label: 'Precio oferta',
        appliesTo: 'Ahorro, rebajas y precio promocional.',
      },
      {
        key: 'badgeBackground',
        label: 'Badge fondo',
        appliesTo: 'Etiquetas comerciales como oferta, nuevo o destacado.',
      },
      {
        key: 'badgeText',
        label: 'Badge texto',
        appliesTo: 'Texto dentro de badges y etiquetas comerciales.',
      },
    ],
  },
  {
    id: 'feedback',
    title: 'Estados',
    description:
      'Feedback del sistema: validación, éxito, error, advertencia e información.',
    fields: [
      {
        key: 'success',
        label: 'Éxito',
        appliesTo: 'Mensajes exitosos, confirmaciones y check visual.',
      },
      {
        key: 'error',
        label: 'Error',
        appliesTo: 'Errores, fallos y validaciones negativas.',
      },
      {
        key: 'warning',
        label: 'Advertencia',
        appliesTo: 'Alertas preventivas y avisos de atención.',
      },
      {
        key: 'info',
        label: 'Info',
        appliesTo: 'Estados neutrales, tips y mensajes informativos.',
      },
    ],
  },
]

export const COLOR_PRESETS = [
  {
    name: 'Azul Corporativo',
    primary: '#1565c0',
    secondary: '#ff6f00',
    accent: '#00b8d4',
  },
  {
    name: 'Verde Natural',
    primary: '#2e7d32',
    secondary: '#558b2f',
    accent: '#fbc02d',
  },
  {
    name: 'Rosa Moderno',
    primary: '#c2185b',
    secondary: '#7b1fa2',
    accent: '#ffd54f',
  },
  {
    name: 'Oscuro Premium',
    primary: '#90caf9',
    secondary: '#f48fb1',
    accent: '#ffe082',
    background: '#121212',
    surface: '#1e1e1e',
    text: '#ffffff',
    mutedText: '#b0b0b0',
    headerBackground: '#181818',
    headerText: '#ffffff',
    cardBackground: '#1f1f1f',
    cardText: '#ffffff',
    cardMutedText: '#b0b0b0',
    cardBorder: '#2f2f2f',
  },
]
