// 📁 src/features/promotionalBlocks/promotionalBlocksSelectors.js

export const selectPromotionalBlocksState = state =>
  state.promotionalBlocks || {}

export const selectPromotionalBlocks = state =>
  selectPromotionalBlocksState(state).blocks || []

export const selectPublicPromotionalBlocks = state =>
  selectPromotionalBlocksState(state).publicBlocks || []

export const selectSelectedPromotionalBlock = state =>
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

export const selectPublicPromotionalBlocksError = state =>
  selectPromotionalBlocksState(state).publicError || null

export const selectPromotionalBlocksSuccess = state =>
  selectPromotionalBlocksState(state).successMessage || null

export const selectPromotionalBlocksIsFetching = state =>
  Boolean(selectPromotionalBlocksState(state).isFetching)

export const selectPromotionalBlocksIsFetchingOne = state =>
  Boolean(selectPromotionalBlocksState(state).isFetchingOne)

export const selectPromotionalBlocksIsFetchingPublic = state =>
  Boolean(selectPromotionalBlocksState(state).isFetchingPublic)

export const selectPromotionalBlocksIsCreating = state =>
  Boolean(selectPromotionalBlocksState(state).isCreating)

export const selectPromotionalBlocksIsUpdating = state =>
  Boolean(selectPromotionalBlocksState(state).isUpdating)

export const selectPromotionalBlocksIsDeleting = state =>
  Boolean(selectPromotionalBlocksState(state).isDeleting)

export const selectPromotionalBlocksIsToggling = state =>
  Boolean(selectPromotionalBlocksState(state).isToggling)

export const selectPromotionalBlocksIsSaving = state => {
  const slice = selectPromotionalBlocksState(state)

  return Boolean(slice.isCreating || slice.isUpdating)
}

export const selectPromotionalBlocksIsMutating = state => {
  const slice = selectPromotionalBlocksState(state)

  return Boolean(
    slice.isCreating ||
    slice.isUpdating ||
    slice.isDeleting ||
    slice.isToggling,
  )
}

export const selectPromotionalBlocksIsBusy = state => {
  const slice = selectPromotionalBlocksState(state)

  return Boolean(
    slice.isFetching ||
    slice.isFetchingOne ||
    slice.isFetchingPublic ||
    slice.isCreating ||
    slice.isUpdating ||
    slice.isDeleting ||
    slice.isToggling,
  )
}
