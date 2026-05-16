// config/storage.js
import { Storage } from '@google-cloud/storage'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const storage = new Storage({
  keyFilename: path.join(__dirname, '../your-service-account-file.json'),
  projectId: 'your-project-id',
})

export const bucket = storage.bucket('your-unique-bucket-name')
