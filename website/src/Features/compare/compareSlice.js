// src/features/compare/compareSlice.js
import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  items: JSON.parse(localStorage.getItem('compareItems')) || [],
}

const compareSlice = createSlice({
  name: 'compare',
  initialState,
  reducers: {
    addToCompare: (state, action) => {
      const product = action.payload
      const exists = state.items.find(p => p._id === product._id)
      if (!exists) {
        if (state.items.length >= 2) state.items.shift()
        state.items.push(product)
      }
      localStorage.setItem('compareItems', JSON.stringify(state.items))
    },
    removeFromCompare: (state, action) => {
      state.items = state.items.filter(p => p._id !== action.payload)
      localStorage.setItem('compareItems', JSON.stringify(state.items))
    },
    clearCompare: state => {
      state.items = []
      localStorage.removeItem('compareItems')
    },
  },
})

export const { addToCompare, removeFromCompare, clearCompare } =
  compareSlice.actions
export default compareSlice.reducer
