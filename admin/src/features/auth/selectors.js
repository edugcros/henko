// 📁 src/features/auth/selectors.js
import { createSelector } from '@reduxjs/toolkit'

// Refs inmutables compartidas (no crean nuevas referencias en cada render)
export const EMPTY_ARR = Object.freeze([])
export const EMPTY_PAG = Object.freeze({ total: 0, page: 1, pages: 1 })

const authState = s => s.auth

export const selectIsLoading = createSelector([authState], a => a?.isLoading)
