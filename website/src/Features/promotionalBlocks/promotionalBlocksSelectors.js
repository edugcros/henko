// 📁 src/features/promotionalBlocks/promotionalBlocksSelectors.js

export const selectPromotionalBlocksState = state =>
  state.promotionalBlocks || {}

export const selectPublicPromotionalBlocks = state =>
  selectPromotionalBlocksState(state).publicBlocks || []

export const selectSelectedPromotionalBlock = state =>
  selectPromotionalBlocksState(state).selectedBlock || null

export const selectPublicPromotionalBlocksError = state =>
  selectPromotionalBlocksState(state).publicError || null

export const selectPublicPromotionalBlocksLoading = state =>
  Boolean(selectPromotionalBlocksState(state).isFetchingPublic)
