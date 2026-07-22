import React, { useMemo } from 'react'
import { useSelector } from 'react-redux'
import {
  getActiveThemeConfig,
  getLayoutThemeConfig,
  getSpacingThemeConfig,
} from '@utils/themeRuntime'

const removeBootstrapSpacingClasses = value =>
  String(value || '')
    .split(/\s+/)
    .filter(className => !/^(m|p)[trblxyse]?-\d+$/.test(className))
    .join(' ')

const Container = props => {
  const themeState = useSelector(state => state.theme) || {}
  const activeConfig = useMemo(
    () => getActiveThemeConfig(themeState),
    [themeState],
  )
  const layout = useMemo(
    () => getLayoutThemeConfig(activeConfig),
    [activeConfig],
  )
  const spacing = useMemo(
    () => getSpacingThemeConfig(activeConfig),
    [activeConfig],
  )
  const className = removeBootstrapSpacingClasses(
    props.class1 || props.className,
  )

  return (
    <section
      className={className}
      style={{
        paddingTop: spacing.section ?? 0,
        paddingBottom: spacing.section ?? 0,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: layout.maxWidth ?? 1200,
          marginLeft: 'auto',
          marginRight: 'auto',
          paddingLeft: layout.containerPadding ?? spacing.container ?? 0,
          paddingRight: layout.containerPadding ?? spacing.container ?? 0,
        }}
      >
        {props.children}
      </div>
    </section>
  )
}
export default Container
