import api from '@utils/axiosConfig'

export const permanentlyDeleteAiConversation = async id => {
  const { data } = await api.delete(`/ai-agent/conversations/${id}/permanent`)
  return data
}
