import { configureStore, combineReducers } from '@reduxjs/toolkit'
import { persistStore, persistReducer } from 'redux-persist'
import storageSession from 'redux-persist/lib/storage/session' // o 'redux-persist/lib/storage' si querés localStorage

import authReducer, { SESSION_RESET } from '@features/auth/authSlice'
import couponReducer from '@features/coupons/couponSlice'
import customerReducer from '@features/customers/customerSlice'
import enquiryReducer from '@features/enquiry/enquirySlice'
import productReducer from '@features/product/productSlice'
import themeReducer from '@features/theme/themeSlice.js'
import orderReducer from '@features/order/orderSlice.js'
import promotionalBlocksReducer from '@features/promotionalBlocks/promotionalBlocksSlice'
import tenantReducer from '@features/tenant/tenantSlice'

const authPersistConfig = {
  key: 'user',
  storage: storageSession, // O storage para localStorage
  // 'token' fuera a propósito: el access token vive en una cookie httpOnly
  // desde el backend, nunca en storage legible por JS.
  //
  // 'sessionKey' va SÍ o SÍ junto a 'user': es a quién pertenece lo guardado.
  // Persistir el usuario sin su identidad deja exactamente el estado que esto
  // viene a evitar — datos cacheados sin forma de saber de quién son.
  whitelist: ['user', 'isAuthenticated', 'sessionKey'],
}

const appReducer = combineReducers({
  user: persistReducer(authPersistConfig, authReducer),
  product: productReducer,
  customers: customerReducer,
  enquiry: enquiryReducer,
  coupon: couponReducer,
  theme: themeReducer,
  order: orderReducer,
  promotionalBlocks: promotionalBlocksReducer,
  tenant: tenantReducer,
})

/**
 * Un cambio de sesión vacía TODO, no solo el slice de auth.
 *
 * Si solo se limpiara `user`, en la misma pestaña quedarían cargados los
 * productos, pedidos, clientes, cupones y el tema del comercio anterior. El
 * usuario nuevo vería su nombre arriba y el catálogo del otro abajo — que es
 * la misma confusión que esto viene a resolver, solo que peor, porque ahora
 * parecería consistente.
 *
 * `appReducer(undefined, action)` hace que cada slice devuelva su initialState.
 */
export const rootReducer = (state, action) =>
  action.type === SESSION_RESET
    ? appReducer(undefined, action)
    : appReducer(state, action)

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
