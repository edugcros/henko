import api from '@utils/axiosConfig'

export const getAiConversations = async params => {
  const { data } = await api.get('/ai-agent/conversations', {
    params,
  })

  return data
}

export const getAiConversationById = async id => {
  const { data } = await api.get(`/ai-agent/conversations/${id}`)

  return data
}

export const updateAiConversationStatus = async ({ id, status }) => {
  const { data } = await api.patch(`/ai-agent/conversations/${id}/status`, {
    status,
  })

  return data
}

export const deleteAiConversation = async id => {
  const { data } = await api.delete(`/ai-agent/conversations/${id}`)
  return data
}

export const permanentlyDeleteAiConversation = async id => {
  const { data } = await api.delete(`/ai-agent/conversations/${id}/permanent`)
  return data
}
