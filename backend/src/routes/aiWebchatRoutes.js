import express from 'express'
import { sendWebchatMessage } from '../controller/aiWebchatCtrl.js'
import { aiWebchatLimiter } from '../middlewares/aiWebchatLimiter.js'
import { trackAiAgentEvent } from '../controller/aiAgentEventCtrl.js'


const router = express.Router()

router.post('/message', aiWebchatLimiter, sendWebchatMessage)

router.post('/event', aiWebchatLimiter, trackAiAgentEvent)

export default router