// 📁 src/features/promotionalBlocks/promotionalBlocksSelectors.js

export const selectPromotionalBlocksState = state =>
  state.promotionalBlocks || {}

export const selectPromotionalBlocks = state =>
  selectPromotionalBlocksState(state).blocks || []

selectPromotionalBlocksState(state).publicBlocks || []

selectPromotionalBlocksState(state).selectedBlock || null

export const selectPromotionalBlocksMeta = state =>
  selectPromotionalBlocksState(state).meta || {
    total: 0,
    page: 1,
    pages: 1,
    limit: 10,
  }

export const selectPromotionalBlocksError = state =>
  selectPromotionalBlocksState(state).error || null

selectPromotionalBlocksState(state).publicError || null

export const selectPromotionalBlocksSuccess = state =>
  selectPromotionalBlocksState(state).successMessage || null

export const selectPromotionalBlocksIsFetching = state =>
  Boolean(selectPromotionalBlocksState(state).isFetching)

Boolean(selectPromotionalBlocksState(state).isFetchingOne)

Boolean(selectPromotionalBlocksState(state).isFetchingPublic)

Boolean(selectPromotionalBlocksState(state).isCreating)

Boolean(selectPromotionalBlocksState(state).isUpdating)

export const selectPromotionalBlocksIsDeleting = state =>
  Boolean(selectPromotionalBlocksState(state).isDeleting)

export const selectPromotionalBlocksIsToggling = state =>
  Boolean(selectPromotionalBlocksState(state).isToggling)

export const selectPromotionalBlocksIsSaving = state => {
  const slice = selectPromotionalBlocksState(state)

  return Boolean(slice.isCreating || slice.isUpdating)
}
