// 📁 src/features/promotionalBlocks/promotionalBlocksSelectors.js
//
// Este archivo tenía siete expresiones sueltas a nivel de módulo —restos de
// selectores que perdieron su `export const ... = state =>`— que referenciaban
// un `state` inexistente. Importarlo lanzaba ReferenceError, así que
// PromotionalBlocksPage no abría.
//
// Se borran en vez de restaurarlas: ninguna estaba exportada ni la importaba
// nadie. Inventarles un nombre sería agregar exports que nadie usa para
// justificar código que ya no existía.

export const selectPromotionalBlocksState = state =>
  state.promotionalBlocks || {}

export const selectPromotionalBlocks = state =>
  selectPromotionalBlocksState(state).blocks || []

export const selectPromotionalBlocksMeta = state =>
  selectPromotionalBlocksState(state).meta || {
    total: 0,
    page: 1,
    pages: 1,
    limit: 10,
  }

export const selectPromotionalBlocksError = state =>
  selectPromotionalBlocksState(state).error || null

export const selectPromotionalBlocksSuccess = state =>
  selectPromotionalBlocksState(state).successMessage || null

export const selectPromotionalBlocksIsFetching = state =>
  Boolean(selectPromotionalBlocksState(state).isFetching)

export const selectPromotionalBlocksIsDeleting = state =>
  Boolean(selectPromotionalBlocksState(state).isDeleting)

export const selectPromotionalBlocksIsToggling = state =>
  Boolean(selectPromotionalBlocksState(state).isToggling)

export const selectPromotionalBlocksIsSaving = state => {
  const slice = selectPromotionalBlocksState(state)

  return Boolean(slice.isCreating || slice.isUpdating)
}
