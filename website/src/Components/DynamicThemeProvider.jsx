import React from 'react'

import { StoreThemeProvider } from '../theme/context/StoreThemeContext'

const DynamicThemeProvider = ({ children }) => (
  <StoreThemeProvider>{children}</StoreThemeProvider>
)

export default React.memo(DynamicThemeProvider)
