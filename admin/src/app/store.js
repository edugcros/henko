import { configureStore, combineReducers } from '@reduxjs/toolkit'
import { persistStore, persistReducer } from 'redux-persist'
import storageSession from 'redux-persist/lib/storage/session' // o 'redux-persist/lib/storage' si querés localStorage

import dashboardReducer from '../features/dashboard/dashboardSlice'
import authReducer from '@features/auth/authSlice'
import couponReducer from '@features/coupons/couponSlice'
import customerReducer from '@features/customers/customerSlice'
import enquiryReducer from '@features/enquiry/enquirySlice'
import productReducer from '@features/product/productSlice'
import uploadReducer from '@features/upload/uploadSlice'
import themeReducer from '@features/theme/themeSlice.js'
import orderReducer from '@features/order/orderSlice.js'
import promotionalBlocksReducer from '@features/promotionalBlocks/promotionalBlocksSlice'

const authPersistConfig = {
  key: 'user',
  storage: storageSession, // O storage para localStorage
  whitelist: ['user', 'token', 'isAuthenticated'], // Persistí sólo lo necesario
}

const rootReducer = combineReducers({
  user: persistReducer(authPersistConfig, authReducer),
  product: productReducer,
  customers: customerReducer,
  dashboard: dashboardReducer,
  enquiry: enquiryReducer,
  upload: uploadReducer,
  coupon: couponReducer,
  theme: themeReducer,
  order: orderReducer,
  promotionalBlocks: promotionalBlocksReducer,
})

// El rootReducer **NO** se persiste entero, solo el slice user
export const store = configureStore({
  reducer: rootReducer,
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware({
      serializableCheck: false,
      thunk: true,
    }),
})

export const persistor = persistStore(store)
