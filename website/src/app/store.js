import { configureStore } from '@reduxjs/toolkit'
import { combineReducers } from 'redux'
import { persistReducer } from 'redux-persist'
import storage from 'redux-persist/lib/storage'
import {
  PURGE,
  PAUSE,
  PERSIST,
  REGISTER,
  REHYDRATE,
  FLUSH,
} from 'redux-persist'

// Reducers
import userReducer from '@features/user/userSlice'
import productReducer from '@features/products/productSlice'
import contactReducer from '@features/contact/contactSlice'
import couponReducer from '@features/coupon/couponSlice'
import cartReducer from '@features/cart/cartSlice'
import colorReducer from '@features/colors/colorSlice'
import enquiryReducer from '@features/enquiries/enquirySlice'
import productCategoryReducer from '@features/productCategories/productCategorySlice'
import orderReducer from '@features/orders/orderSlice'
import compareReducer from '@features/compare/compareSlice'
import themeReducer from '@features/theme/themeSlice'
import promotionalBlocksReducer from '@features/promotionalBlocks/promotionalBlocksSlice'

export const RESET_APP = 'RESET_APP'

// Persist config SOLO para user
const userPersistConfig = {
  key: 'user',
  storage,
  whitelist: ['user', 'token', 'wishlist'], // lo correcto
}

// Root reducer
const rootReducer = combineReducers({
  user: persistReducer(userPersistConfig, userReducer),
  product: productReducer,
  theme: themeReducer,
  contact: contactReducer,
  coupon: couponReducer,
  cart: cartReducer,
  color: colorReducer,
  enquiry: enquiryReducer,
  productCategory: productCategoryReducer,
  order: orderReducer,
  compare: compareReducer,
  promotionalBlocks: promotionalBlocksReducer,
})

// Persist global
const persistConfig = {
  key: 'root',
  storage,
  whitelist: ['user'], // solo se persiste user
}

const persistedReducer = persistReducer(persistConfig, rootReducer)

// Middleware limpio para reset
const resetMiddleware = store => next => action => {
  if (action.type === 'user/logoutUser/fulfilled') {
    console.log('[STORE] Ejecutando PURGE por logout...')
    store.dispatch({ type: PURGE })
  }
  return next(action)
}

// Store final
const store = configureStore({
  reducer: persistedReducer,
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, REGISTER, PURGE],
      },
    }).concat(resetMiddleware),
})

// Persistor estable (sin import() dinámico)
import { persistStore } from 'redux-persist'
export const persistor = persistStore(store)

export { store }
export default store
