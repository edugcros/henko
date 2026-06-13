// 📁 src/utils/baseUrl.js
import { env } from '@config/env'

export const base_url = `${env.apiBaseUrl.replace(/\/+$/, '')}/`
export default base_url
