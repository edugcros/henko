import User from '../models/userModel.js'

const safeDate = value => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const escapeRegex = value => {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const buildAdminOrdersQuery = async ({
  tenantObjectId,
  queryParams,
  money,
}) => {
  const {
    status,
    paymentStatus,
    fulfillmentStatus,
    from,
    to,
    q,
    minTotal,
    maxTotal,
    sortBy = 'createdAt',
    sortDir = 'desc',
  } = queryParams

  const query = {
    tenantId: tenantObjectId,
    isDeleted: false,
  }

  if (status) query.orderStatus = String(status).toLowerCase()
  if (paymentStatus) query.paymentStatus = String(paymentStatus).toLowerCase()
  if (fulfillmentStatus) {
    query.fulfillmentStatus = String(fulfillmentStatus).toLowerCase()
  }

  const fromDate = safeDate(from)
  const toDate = safeDate(to)

  if (fromDate || toDate) {
    query.createdAt = {}
    if (fromDate) query.createdAt.$gte = fromDate
    if (toDate) query.createdAt.$lte = toDate
  }

  if (minTotal || maxTotal) {
    query['paymentIntent.amountCents'] = {}

    if (minTotal) {
      query['paymentIntent.amountCents'].$gte = money.fromDecimal(minTotal)
    }

    if (maxTotal) {
      query['paymentIntent.amountCents'].$lte = money.fromDecimal(maxTotal)
    }
  }

  if (q?.trim()) {
    const safeRegex = new RegExp(escapeRegex(q.trim().slice(0, 50)), 'i')

    const users = await User.find({
      tenantId: tenantObjectId,
      $or: [
        { email: safeRegex },
        { firstname: safeRegex },
        { lastname: safeRegex },
      ],
    })
      .setOptions({ tenantId: String(tenantObjectId) })
      .select('_id')
      .lean()

    const userIds = users.map(user => user._id)

    query.$or = [
      { idempotencyKey: safeRegex },
      { 'paymentIntent.id': safeRegex },
      { 'paymentIntent.providerPaymentId': safeRegex },
      ...(userIds.length ? [{ orderby: { $in: userIds } }] : []),
    ]
  }

  const sortFieldMap = {
    createdAt: 'createdAt',
    amount: 'paymentIntent.amountCents',
    status: 'orderStatus',
    paymentStatus: 'paymentStatus',
    fulfillmentStatus: 'fulfillmentStatus',
  }

  return {
    query,
    filters: {
      status: status || null,
      paymentStatus: paymentStatus || null,
      fulfillmentStatus: fulfillmentStatus || null,
      dateRange: from || to ? { from: from || null, to: to || null } : null,
      search: q || null,
    },
    sorting: {
      field: sortFieldMap[sortBy] || 'createdAt',
      direction: sortDir === 'asc' ? 'asc' : 'desc',
    },
  }
}
