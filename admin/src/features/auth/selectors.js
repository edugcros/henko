// 📁 src/features/auth/selectors.js
import { createSelector } from '@reduxjs/toolkit'

// Refs inmutables compartidas (no crean nuevas referencias en cada render)
export const EMPTY_ARR = Object.freeze([])
export const EMPTY_PAG = Object.freeze({ total: 0, page: 1, pages: 1 })

const authState = (s) => s.auth

export const selectIsLoading = createSelector([authState], (a) => a?.isLoading)
export const selectMessage   = createSelector([authState], (a) => a?.message)

// Devuelven SIEMPRE la misma referencia si no cambia el slice
export const selectOrdersData = createSelector(
  [authState],
  (a) => a?.orders?.data ?? EMPTY_ARR
)

export const selectOrdersPagination = createSelector(
  [authState],
  (a) => a?.orders?.pagination ?? EMPTY_PAG
)
