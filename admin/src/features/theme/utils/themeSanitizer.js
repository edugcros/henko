const IMAGE_FIELDS = new Set(['backgroundImage', 'logo', 'favicon'])

const isPlainObject = value => {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(typeof globalThis !== 'undefined' && value instanceof globalThis.Blob),
  )
}

export const isImageField = key => IMAGE_FIELDS.has(key)

export const normalizeImageAsset = value => {
  const image =
    value?.image ||
    value?.data?.image ||
    value?.data ||
    value?.payload?.image ||
    value?.payload?.data ||
    value?.payload ||
    value

  if (!image) return null

  if (typeof image === 'string') {
    const url = image.trim()
    return url ? { url, public_id: '' } : null
  }

  if (!isPlainObject(image)) return null

  const url = typeof image.url === 'string' ? image.url.trim() : ''
  if (!url) return null

  return {
    url,
    public_id: image.public_id || image.publicId || '',
  }
}

const sanitize = (value, key = '') => {
  if (isImageField(key)) return normalizeImageAsset(value)

  if (!value || typeof value !== 'object') return value
  if (typeof File !== 'undefined' && value instanceof File) return undefined
  if (typeof Blob !== 'undefined' && value instanceof Blob) return undefined

  if (Array.isArray(value)) {
    return value.map(item => sanitize(item)).filter(item => item !== undefined)
  }

  return Object.entries(value).reduce((acc, [childKey, childValue]) => {
    // Strips stray 'meta'/'error' props that leak in from unwrapped API/Redux
    // response shapes (e.g. { success, data, error, meta }) at the object's
    // OWN level — but 'error' is a legitimate schema field under colors
    // (theme.colors.error), so it must survive when we're already inside colors.
    if (childKey === 'meta') return acc
    if (childKey === 'error' && key !== 'colors') return acc
    const sanitized = sanitize(childValue, childKey)

    if (sanitized !== undefined) {
      acc[childKey] = sanitized
    }

    return acc
  }, {})
}

export const sanitizeThemeValue = (value, key = '') => sanitize(value, key)

export const sanitizePayload = sanitize
