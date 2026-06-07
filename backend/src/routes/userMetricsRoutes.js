import express from 'express'

import { trackUserMetricEvent } from '../controller/userMetricsCtrl.js'
import {
  requireTenant,
  resolveTenantByDomain,
} from '../middlewares/tenantMiddleware.js'

const router = express.Router()

router.post('/events', resolveTenantByDomain, requireTenant, trackUserMetricEvent)

export default router
