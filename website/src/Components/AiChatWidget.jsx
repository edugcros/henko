// 📁 website/src/components/AiChatWidget.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Fade,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import CloseIcon from '@mui/icons-material/Close'
import SendIcon from '@mui/icons-material/Send'
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined'
import ShoppingCartOutlinedIcon from '@mui/icons-material/ShoppingCartOutlined'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined'
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import {
  dispatchAiAddToCartEvent,
  getAiCartActionResultEventName,
  savePendingAiCartAction,
} from '@utils/aiCartActionUtils'
import {
  getAiWebchatCustomerProfile,
  normalizeAiWebchatResponse,
  resetAiWebchatSession,
  saveAiWebchatCustomerProfile,
  sendAiWebchatMessage,
  trackAiWebchatEvent,
} from '../services/aiAgentService'

const QUICK_PROMPTS = [
  'Quiero ver productos destacados',
  'Busco algo en oferta',
  '¿Qué promociones hay hoy?',
  'Necesito ayuda para comprar',
]

const PURCHASE_INTENT_KEYWORDS = [
  'comprar',
  'quiero',
  'me interesa',
  'precio',
  'cuanto sale',
  'cuánto sale',
  'stock',
  'disponible',
  'financiacion',
  'financiación',
  'cuotas',
  'envio',
  'envío',
  'retirar',
  'reservar',
  'pagar',
  'promocion',
  'promoción',
  'descuento',
]

const CONTACT_INTENTS = new Set([
  'purchase_intent',
  'checkout_intent',
  'price_check',
  'price_question',
  'stock_question',
  'shipping_question',
  'promotion',
  'human_request',
])

const clean = value => String(value || '').trim()

const isEmailValid = value => {
  const email = clean(value).toLowerCase()
  if (!email) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

const isPhoneValid = value => {
  const phone = clean(value).replace(/[^\d+]/g, '')
  if (!phone) return true
  return phone.replace(/\D/g, '').length >= 8
}

const shouldAskContactFromText = text => {
  const normalized = clean(text).toLowerCase()
  if (!normalized) return false
  return PURCHASE_INTENT_KEYWORDS.some(keyword => normalized.includes(keyword))
}

const shouldAskContactFromAi = ({ intent, leadScore }) => {
  if (CONTACT_INTENTS.has(intent)) return true
  return Number(leadScore || 0) >= 45
}

const getProfileCompletion = profile => {
  const data = profile || {}
  const hasName = Boolean(clean(data.name))
  const hasEmail = Boolean(clean(data.email))
  const hasPhone = Boolean(clean(data.phone))

  return {
    hasName,
    hasEmail,
    hasPhone,
    hasAnyContact: hasEmail || hasPhone,
    isComplete: hasName && (hasEmail || hasPhone),
  }
}

const createMessage = ({ role, content, meta = {} }) => ({
  id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  role,
  content,
  createdAt: new Date().toISOString(),
  meta: {
    intent: meta.intent || '',
    leadScore: meta.leadScore ?? null,
    actions: Array.isArray(meta.actions) ? meta.actions : [],
  },
})

const formatTime = value => {
  try {
    return new Date(value).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

const getActionIcon = type => {
  switch (type) {
    case 'view_product':
      return <VisibilityOutlinedIcon fontSize="small" />
    case 'add_to_cart':
      return <ShoppingCartOutlinedIcon fontSize="small" />
    case 'apply_coupon_hint':
      return <LocalOfferOutlinedIcon fontSize="small" />
    case 'request_human':
      return <SupportAgentOutlinedIcon fontSize="small" />
    default:
      return <AutoAwesomeIcon fontSize="small" />
  }
}

const getIntentLabel = intent => {
  const labels = {
    unknown: 'Sin clasificar',
    support: 'Soporte',
    browse: 'Exploración',
    compare: 'Comparación',
    price_check: 'Consulta precio',
    price_question: 'Consulta precio',
    stock_question: 'Consulta stock',
    shipping_question: 'Consulta envío',
    policy_question: 'Política',
    promotion: 'Promoción',
    purchase_intent: 'Intención de compra',
    checkout_intent: 'Compra avanzada',
    cart_recovery: 'Carrito',
    post_sale: 'Postventa',
    post_purchase: 'Postventa',
    general_question: 'General',
    opt_out: 'Baja',
    human_request: 'Asesor',
  }

  return labels[intent] || intent
}

const resolveEventType = actionType => {
  if (actionType === 'view_product') return 'view_product'
  if (actionType === 'add_to_cart') return 'add_to_cart'
  if (actionType === 'apply_coupon_hint') return 'coupon_copied'
  if (actionType === 'request_human') return 'request_human'

  return 'action_clicked'
}

const AiChatWidget = () => {
  const bottomRef = useRef(null)
  const sendingRef = useRef(false)

  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [actionFeedback, setActionFeedback] = useState('')
  const [showContactForm, setShowContactForm] = useState(false)
  const [contactNoticeDismissed, setContactNoticeDismissed] = useState(false)
  const [customerProfile, setCustomerProfile] = useState(() =>
    getAiWebchatCustomerProfile(),
  )
  const [contactDraft, setContactDraft] = useState(() =>
    getAiWebchatCustomerProfile(),
  )
  const [lastAiContext, setLastAiContext] = useState({
    conversationId: '',
    externalUserId: '',
  })
  const [messages, setMessages] = useState([
    createMessage({
      role: 'assistant',
      content:
        'Hola 👋 Soy el asistente de la tienda. Puedo ayudarte a encontrar productos, promociones y acompañarte en la compra.',
      meta: { actions: [] },
    }),
  ])

  const profileCompletion = useMemo(
    () => getProfileCompletion(customerProfile),
    [customerProfile],
  )

  const contactDraftErrors = useMemo(() => {
    return {
      email: !isEmailValid(contactDraft.email),
      phone: !isPhoneValid(contactDraft.phone),
    }
  }, [contactDraft.email, contactDraft.phone])

  const canSaveContact = useMemo(() => {
    if (contactDraftErrors.email || contactDraftErrors.phone) return false

    const normalized = {
      name: clean(contactDraft.name),
      email: clean(contactDraft.email),
      phone: clean(contactDraft.phone),
    }

    return Boolean(normalized.name || normalized.email || normalized.phone)
  }, [contactDraft, contactDraftErrors])

  const canSend = useMemo(() => {
    return message.trim().length > 0 && !loading && !sendingRef.current
  }, [message, loading])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading, open, showContactForm])

  useEffect(() => {
    if (!actionFeedback) return undefined

    const timeout = window.setTimeout(() => setActionFeedback(''), 2600)

    return () => window.clearTimeout(timeout)
  }, [actionFeedback])

  useEffect(() => {
    const handleCartActionResult = event => {
      const { success, message: resultMessage } = event.detail || {}

      setActionFeedback(
        resultMessage ||
          (success
            ? 'Producto agregado al carrito.'
            : 'No se pudo agregar el producto.'),
      )
    }

    const eventName = getAiCartActionResultEventName()

    window.addEventListener(eventName, handleCartActionResult)

    return () => {
      window.removeEventListener(eventName, handleCartActionResult)
    }
  }, [])

  const syncCustomerProfile = nextProfile => {
    const saved = saveAiWebchatCustomerProfile(nextProfile)
    setCustomerProfile(saved)
    setContactDraft(saved)
    return saved
  }

  const updateContactDraft = field => event => {
    const value = event?.target?.value ?? ''

    setContactDraft(prev => ({
      ...prev,
      [field]: value,
    }))
  }

  const handleSaveContact = () => {
    if (!canSaveContact) return

    const saved = syncCustomerProfile({
      name: clean(contactDraft.name),
      email: clean(contactDraft.email).toLowerCase(),
      phone: clean(contactDraft.phone),
    })

    setShowContactForm(false)
    setContactNoticeDismissed(false)

    setActionFeedback(
      saved.name
        ? `Gracias ${saved.name}, guardé tus datos para esta consulta.`
        : 'Guardé tus datos para esta consulta.',
    )
  }

  const maybeOpenContactForm = ({
    userText = '',
    intent = '',
    leadScore = null,
  } = {}) => {
    if (profileCompletion.isComplete || contactNoticeDismissed) return

    if (
      shouldAskContactFromText(userText) ||
      shouldAskContactFromAi({ intent, leadScore })
    ) {
      setShowContactForm(true)
    }
  }

  const pushUserMessage = content => {
    setMessages(prev => [
      ...prev,
      createMessage({
        role: 'user',
        content,
        meta: { actions: [] },
      }),
    ])
  }

  const pushAssistantMessage = ({ content, intent, leadScore, actions }) => {
    const cleanContent = String(content || '').trim()

    if (!cleanContent) return

    setMessages(prev => [
      ...prev,
      createMessage({
        role: 'assistant',
        content: cleanContent,
        meta: {
          intent,
          leadScore,
          actions: Array.isArray(actions) ? actions : [],
        },
      }),
    ])
  }

  const handleNewConversation = () => {
    if (sendingRef.current) return

    resetAiWebchatSession()

    setLastAiContext({
      conversationId: '',
      externalUserId: '',
    })

    setMessages([
      createMessage({
        role: 'assistant',
        content:
          'Nueva conversación iniciada 👋 ¿Qué estás buscando o en qué puedo ayudarte?',
        meta: { actions: [] },
      }),
    ])

    setMessage('')
    setShowContactForm(false)
    setContactNoticeDismissed(false)
    setActionFeedback('Nueva conversación iniciada')
  }

  const handleActionClick = action => {
    if (!action) return

    if (action.type === 'request_human' && !profileCompletion.isComplete) {
      setShowContactForm(true)
    }

    trackAiWebchatEvent({
      type: resolveEventType(action.type),
      actionType: action.type,
      conversationId: lastAiContext.conversationId,
      externalUserId: lastAiContext.externalUserId,
      productId: action.productId,
      couponCode: action.couponCode,
      label: action.label,
      url: action.url,
      rawAction: action,
    })

    if (action.type === 'view_product' && action.url) {
      window.location.href = action.url
      return
    }

    if (action.type === 'add_to_cart') {
      savePendingAiCartAction(action)

      dispatchAiAddToCartEvent(action)

      setActionFeedback('Agregando producto al carrito...')
      return
    }

    if (action.type === 'apply_coupon_hint' && action.couponCode) {
      window.navigator.clipboard?.writeText(action.couponCode)
      setActionFeedback(`Cupón ${action.couponCode} copiado`)
      return
    }

    if (action.type === 'request_human') {
      setActionFeedback(
        'Tu consulta quedó marcada para ser tomada por un asesor',
      )
    }
  }

  const sendMessage = async rawMessage => {
    const cleanMessage = String(rawMessage || '').trim()

    if (!cleanMessage) return
    if (sendingRef.current) return

    sendingRef.current = true

    const savedProfile = syncCustomerProfile(customerProfile)

    pushUserMessage(cleanMessage)
    setMessage('')
    setLoading(true)

    maybeOpenContactForm({ userText: cleanMessage })

    try {
      const response = await sendAiWebchatMessage({
        message: cleanMessage,
        customerName: savedProfile.name,
        customerEmail: savedProfile.email,
        customerPhone: savedProfile.phone,
      })

      const aiPayload = normalizeAiWebchatResponse(response)

      if (
        aiPayload.customer?.name ||
        aiPayload.customer?.email ||
        aiPayload.customer?.phone
      ) {
        syncCustomerProfile(aiPayload.customer)
      } else {
        setCustomerProfile(getAiWebchatCustomerProfile())
      }

      setLastAiContext({
        conversationId: aiPayload.conversationId || '',
        externalUserId: aiPayload.externalUserId || '',
      })

      maybeOpenContactForm({
        intent: aiPayload.intent,
        leadScore: aiPayload.leadScore,
      })

      if (!aiPayload.reply) {
        console.warn(
          '[AiChatWidget] La IA respondió sin reply utilizable:',
          response,
        )

        pushAssistantMessage({
          content:
            'Recibí tu consulta, pero no pude interpretar la respuesta del asistente. Probá reformularla o pedí ayuda a un asesor.',
          intent: aiPayload.intent,
          leadScore: aiPayload.leadScore,
          actions: aiPayload.actions,
        })

        return
      }

      pushAssistantMessage({
        content: aiPayload.reply,
        intent: aiPayload.intent,
        leadScore: aiPayload.leadScore,
        actions: aiPayload.actions,
      })
    } catch (error) {
      console.error('[AiChatWidget] Error contactando asistente:', {
        status: error?.response?.status,
        data: error?.response?.data,
        message: error?.message,
      })

      const backendMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.response?.data?.details ||
        error?.message

      pushAssistantMessage({
        content: backendMessage
          ? `No pude responder: ${backendMessage}`
          : 'Hubo un problema al contactar al asistente.',
        actions: [],
      })
    } finally {
      sendingRef.current = false
      setLoading(false)
    }
  }

  const handleSend = async () => {
    await sendMessage(message)
  }

  const handleQuickPrompt = async prompt => {
    if (loading || sendingRef.current) return
    await sendMessage(prompt)
  }

  return (
    <>
      {!open && (
        <Fade in={!open}>
          <Box
            sx={{
              position: 'fixed',
              right: { xs: 16, md: 24 },
              bottom: { xs: 16, md: 24 },
              zIndex: 1600,
            }}
          >
            <IconButton
              onClick={() => setOpen(true)}
              sx={{
                width: 68,
                height: 68,
                borderRadius: '22px',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                boxShadow:
                  '0 18px 36px rgba(25,118,210,0.30), 0 8px 18px rgba(0,0,0,0.14)',
                transition: 'all 0.22s ease',
                '&:hover': {
                  bgcolor: 'primary.dark',
                  transform: 'translateY(-3px)',
                },
              }}
            >
              <ChatBubbleOutlineIcon sx={{ fontSize: 30 }} />
            </IconButton>

            <Chip
              label="Asistente IA"
              size="small"
              sx={{
                position: 'absolute',
                right: 0,
                top: -10,
                fontWeight: 800,
                bgcolor: 'background.paper',
                boxShadow: 2,
              }}
            />
          </Box>
        </Fade>
      )}

      {open && (
        <Paper
          elevation={16}
          sx={{
            position: 'fixed',
            right: { xs: 10, md: 24 },
            bottom: { xs: 10, md: 24 },
            zIndex: 1600,
            width: { xs: 'calc(100vw - 20px)', sm: 440 },
            height: { xs: 'calc(100vh - 20px)', sm: 610 },
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: { xs: 4, sm: 3 },
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            backdropFilter: 'blur(10px)',
          }}
        >
          <Box
            sx={{
              px: 2,
              py: 1.5,
              background:
                'linear-gradient(135deg, rgba(25,118,210,1) 0%, rgba(13,71,161,1) 100%)',
              color: 'primary.contrastText',
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1.5}
            >
              <Stack
                direction="row"
                spacing={1.3}
                alignItems="center"
                minWidth={0}
              >
                <Avatar
                  sx={{
                    bgcolor: 'rgba(255,255,255,0.16)',
                    width: 44,
                    height: 44,
                    flexShrink: 0,
                  }}
                >
                  <SmartToyOutlinedIcon />
                </Avatar>

                <Box sx={{ minWidth: 0 }}>
                  <Typography fontWeight={900} lineHeight={1.1} noWrap>
                    Asistente IA
                  </Typography>

                  <Stack
                    direction="row"
                    spacing={0.8}
                    alignItems="center"
                    sx={{ mt: 0.35 }}
                  >
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: '#7CFF8D',
                        boxShadow: '0 0 0 3px rgba(124,255,141,0.18)',
                      }}
                    />

                    <Typography variant="caption" sx={{ opacity: 0.95 }} noWrap>
                      Online
                    </Typography>
                  </Stack>
                </Box>
              </Stack>

              <Stack
                direction="row"
                spacing={0.8}
                alignItems="center"
                flexShrink={0}
              >
                <Tooltip title="Editar datos de contacto">
                  <IconButton
                    onClick={() => setShowContactForm(prev => !prev)}
                    sx={{
                      color: 'inherit',
                      bgcolor: profileCompletion.isComplete
                        ? 'rgba(124,255,141,0.20)'
                        : 'rgba(255,255,255,0.08)',
                      '&:hover': {
                        bgcolor: 'rgba(255,255,255,0.16)',
                      },
                    }}
                  >
                    <BadgeOutlinedIcon />
                  </IconButton>
                </Tooltip>

                <Button
                  size="small"
                  variant="text"
                  startIcon={<RestartAltOutlinedIcon fontSize="small" />}
                  onClick={handleNewConversation}
                  disabled={loading}
                  sx={{
                    color: 'inherit',
                    textTransform: 'none',
                    fontWeight: 800,
                    bgcolor: 'rgba(255,255,255,0.08)',
                    borderRadius: 2,
                    px: 1.2,
                    '&:hover': {
                      bgcolor: 'rgba(255,255,255,0.16)',
                    },
                    '&.Mui-disabled': {
                      color: 'rgba(255,255,255,0.45)',
                    },
                  }}
                >
                  Nueva
                </Button>

                <IconButton
                  onClick={() => setOpen(false)}
                  sx={{
                    color: 'inherit',
                    bgcolor: 'rgba(255,255,255,0.08)',
                    '&:hover': {
                      bgcolor: 'rgba(255,255,255,0.16)',
                    },
                  }}
                >
                  <CloseIcon />
                </IconButton>
              </Stack>
            </Stack>
          </Box>

          <Box
            sx={{
              px: 2,
              py: 1.2,
              bgcolor: 'background.paper',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Typography
                variant="caption"
                color="text.secondary"
                fontWeight={800}
              >
                Consultas rápidas
              </Typography>

              {profileCompletion.isComplete ? (
                <Chip
                  size="small"
                  icon={
                    customerProfile.email ? (
                      <EmailOutlinedIcon />
                    ) : (
                      <WhatsAppIcon />
                    )
                  }
                  label={customerProfile.name || 'Contacto guardado'}
                  color="success"
                  variant="outlined"
                  sx={{ fontWeight: 800, maxWidth: 190 }}
                />
              ) : (
                <Chip
                  size="small"
                  icon={<EditOutlinedIcon />}
                  label="Agregar contacto"
                  clickable
                  onClick={() => setShowContactForm(true)}
                  variant="outlined"
                  sx={{ fontWeight: 800 }}
                />
              )}
            </Stack>

            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              flexWrap="wrap"
              sx={{ mt: 1 }}
            >
              {QUICK_PROMPTS.map(prompt => (
                <Chip
                  key={prompt}
                  label={prompt}
                  onClick={() => handleQuickPrompt(prompt)}
                  clickable={!loading}
                  disabled={loading}
                  variant="outlined"
                  size="small"
                  sx={{
                    borderRadius: 2,
                    fontWeight: 600,
                    bgcolor: 'grey.50',
                    '&:hover': {
                      bgcolor: 'primary.50',
                    },
                  }}
                />
              ))}
            </Stack>
          </Box>

          <Collapse in={showContactForm}>
            <Box
              sx={{
                p: 1.5,
                borderBottom: '1px solid',
                borderColor: 'divider',
                bgcolor: 'grey.50',
              }}
            >
              <Alert
                severity="info"
                icon={<BadgeOutlinedIcon />}
                sx={{ mb: 1.2, borderRadius: 2 }}
              >
                <Typography variant="body2" fontWeight={800}>
                  Datos para seguimiento comercial
                </Typography>
                <Typography variant="caption">
                  Dejá tu nombre y un contacto para que la tienda pueda
                  continuar la atención si hace falta.
                </Typography>
              </Alert>

              <Stack spacing={1}>
                <TextField
                  size="small"
                  label="Nombre"
                  value={contactDraft.name}
                  onChange={updateContactDraft('name')}
                  fullWidth
                />

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    size="small"
                    label="Email"
                    value={contactDraft.email}
                    onChange={updateContactDraft('email')}
                    error={contactDraftErrors.email}
                    helperText={
                      contactDraftErrors.email ? 'Email inválido' : ''
                    }
                    fullWidth
                  />

                  <TextField
                    size="small"
                    label="WhatsApp / Teléfono"
                    value={contactDraft.phone}
                    onChange={updateContactDraft('phone')}
                    error={contactDraftErrors.phone}
                    helperText={
                      contactDraftErrors.phone ? 'Teléfono inválido' : ''
                    }
                    fullWidth
                  />
                </Stack>

                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button
                    size="small"
                    onClick={() => {
                      setShowContactForm(false)
                      setContactNoticeDismissed(true)
                    }}
                    sx={{ textTransform: 'none', fontWeight: 800 }}
                  >
                    Ahora no
                  </Button>

                  <Button
                    size="small"
                    variant="contained"
                    disabled={!canSaveContact}
                    onClick={handleSaveContact}
                    sx={{ textTransform: 'none', fontWeight: 900 }}
                  >
                    Guardar datos
                  </Button>
                </Stack>
              </Stack>
            </Box>
          </Collapse>

          <Stack
            spacing={1.5}
            sx={{
              flex: 1,
              p: 2,
              overflowY: 'auto',
              bgcolor: '#f7f9fc',
            }}
          >
            {messages.map(item => {
              const isUser = item.role === 'user'
              const actions = Array.isArray(item.meta?.actions)
                ? item.meta.actions
                : []

              return (
                <Box
                  key={item.id}
                  sx={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: isUser ? 'flex-end' : 'flex-start',
                  }}
                >
                  <Stack
                    direction={isUser ? 'row-reverse' : 'row'}
                    spacing={1}
                    sx={{
                      maxWidth: '92%',
                      alignItems: 'flex-end',
                    }}
                  >
                    <Avatar
                      sx={{
                        width: 34,
                        height: 34,
                        bgcolor: isUser ? 'primary.main' : 'grey.900',
                        color: 'white',
                        flexShrink: 0,
                      }}
                    >
                      {isUser ? (
                        <PersonOutlineIcon fontSize="small" />
                      ) : (
                        <SmartToyOutlinedIcon fontSize="small" />
                      )}
                    </Avatar>

                    <Box sx={{ minWidth: 0 }}>
                      <Box
                        sx={{
                          px: 1.6,
                          py: 1.2,
                          borderRadius: 3,
                          bgcolor: isUser ? 'primary.main' : 'white',
                          color: isUser
                            ? 'primary.contrastText'
                            : 'text.primary',
                          boxShadow: isUser
                            ? '0 8px 18px rgba(25,118,210,0.18)'
                            : '0 8px 20px rgba(15,23,42,0.06)',
                          border: isUser ? 'none' : '1px solid',
                          borderColor: isUser ? 'transparent' : 'divider',
                        }}
                      >
                        <Typography
                          variant="body2"
                          whiteSpace="pre-line"
                          sx={{
                            lineHeight: 1.58,
                            wordBreak: 'break-word',
                          }}
                        >
                          {item.content}
                        </Typography>
                      </Box>

                      <Stack
                        direction="row"
                        spacing={0.75}
                        alignItems="center"
                        sx={{
                          mt: 0.65,
                          px: 0.4,
                          justifyContent: isUser ? 'flex-end' : 'flex-start',
                          flexWrap: 'wrap',
                        }}
                      >
                        {!!item.meta?.intent && !isUser && (
                          <Chip
                            size="small"
                            label={getIntentLabel(item.meta.intent)}
                            variant="outlined"
                            sx={{
                              height: 22,
                              fontSize: 10,
                              borderRadius: 1.5,
                              fontWeight: 700,
                              bgcolor: 'background.paper',
                            }}
                          />
                        )}

                        {item.meta?.leadScore !== null && !isUser && (
                          <Chip
                            size="small"
                            label={`Score ${item.meta.leadScore}`}
                            variant="outlined"
                            sx={{
                              height: 22,
                              fontSize: 10,
                              borderRadius: 1.5,
                              bgcolor: 'background.paper',
                            }}
                          />
                        )}

                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontSize: 11 }}
                        >
                          {formatTime(item.createdAt)}
                        </Typography>
                      </Stack>

                      {!isUser && actions.length > 0 && (
                        <Stack spacing={0.9} sx={{ mt: 1 }}>
                          {actions.map((action, actionIndex) => (
                            <Button
                              key={`${item.id}-${action.type}-${actionIndex}`}
                              size="small"
                              variant={
                                action.type === 'add_to_cart'
                                  ? 'contained'
                                  : 'outlined'
                              }
                              startIcon={getActionIcon(action.type)}
                              onClick={() => handleActionClick(action)}
                              sx={{
                                alignSelf: 'flex-start',
                                borderRadius: 2,
                                textTransform: 'none',
                                fontWeight: 800,
                                px: 1.5,
                                py: 0.75,
                              }}
                            >
                              {action.label}
                            </Button>
                          ))}
                        </Stack>
                      )}
                    </Box>
                  </Stack>
                </Box>
              )
            })}

            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Avatar
                    sx={{
                      width: 34,
                      height: 34,
                      bgcolor: 'grey.900',
                      color: 'white',
                    }}
                  >
                    <SmartToyOutlinedIcon fontSize="small" />
                  </Avatar>

                  <Paper
                    elevation={0}
                    sx={{
                      px: 1.5,
                      py: 1.1,
                      borderRadius: 3,
                      border: '1px solid',
                      borderColor: 'divider',
                      bgcolor: 'white',
                    }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center">
                      <CircularProgress size={16} />
                      <Typography variant="body2" color="text.secondary">
                        Pensando respuesta...
                      </Typography>
                    </Stack>
                  </Paper>
                </Stack>
              </Box>
            )}

            <div ref={bottomRef} />
          </Stack>

          <Divider />

          <Box sx={{ p: 1.5, bgcolor: 'background.paper' }}>
            {actionFeedback && (
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{
                  mb: 1,
                  px: 1.2,
                  py: 0.9,
                  borderRadius: 2,
                  bgcolor: 'success.50',
                  color: 'success.main',
                }}
              >
                <CheckCircleOutlineIcon fontSize="small" />
                <Typography variant="caption" fontWeight={800}>
                  {actionFeedback}
                </Typography>
              </Stack>
            )}

            {!profileCompletion.isComplete &&
              !showContactForm &&
              !contactNoticeDismissed && (
                <Alert
                  severity="info"
                  sx={{ mb: 1, borderRadius: 2, py: 0.4 }}
                  action={
                    <Button
                      size="small"
                      onClick={() => setShowContactForm(true)}
                      sx={{ textTransform: 'none', fontWeight: 900 }}
                    >
                      Completar
                    </Button>
                  }
                >
                  <Typography variant="caption">
                    Si querés seguimiento, dejá tu nombre y WhatsApp/email.
                  </Typography>
                </Alert>
              )}

            <Stack direction="row" spacing={1} alignItems="flex-end">
              <TextField
                size="small"
                fullWidth
                multiline
                maxRows={4}
                placeholder="Escribí tu consulta..."
                value={message}
                onChange={event => setMessage(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    handleSend()
                  }
                }}
                disabled={loading}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 3,
                    bgcolor: 'grey.50',
                  },
                }}
              />

              <Button
                variant="contained"
                disabled={!canSend}
                onClick={handleSend}
                sx={{
                  minWidth: 52,
                  height: 42,
                  borderRadius: 3,
                  boxShadow: 'none',
                }}
              >
                {loading ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <SendIcon fontSize="small" />
                )}
              </Button>
            </Stack>

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 1, px: 0.5 }}
            >
              Podés consultar productos, stock, promociones y ayuda de compra.
            </Typography>
          </Box>
        </Paper>
      )}
    </>
  )
}

export default AiChatWidget
