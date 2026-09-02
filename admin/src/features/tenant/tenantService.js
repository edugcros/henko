import api, { fetchCsrfToken } from '@utils/axiosConfig'

const handleApiError = (error, fallback = 'Error inesperado') => {
  const msg = error?.response?.data?.message || error?.message || fallback
  return { success: false, message: msg }
}

const authedRequest = async (method, endpoint, data) => {
  try {
    await fetchCsrfToken()

    const config = {
      method,
      url: `/tenants${endpoint}`,
      headers: { Accept: 'application/json' },
      withCredentials: true,
      ...(data !== undefined && { data }),
    }

    const response = await api(config)
    return {
      success: true,
      data: response.data?.data,
      message: response.data?.message || 'OK',
    }
  } catch (error) {
    return handleApiError(error)
  }
}

const getTenantSettings = () => authedRequest('get', '/me/settings')

const updateTenantSettings = settings => authedRequest('put', '/me/settings', settings)

const updateOnboardingStep = step => authedRequest('put', '/me/onboarding', { step })

const tenantService = {
  getTenantSettings,
  updateTenantSettings,
  updateOnboardingStep,
}

export default tenantService
