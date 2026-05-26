import React from 'react'
import PropTypes from 'prop-types'

const Container = props => {
  return (
    <section className={props.className}>
      <div className="container-xxl">{props.children}</div>
    </section>
  )
}

Container.propTypes = {
  className: PropTypes.string, // Prop ahora es más semántica
  children: PropTypes.node.isRequired,
}

Container.defaultProps = {
  className: '', // Valor predeterminado
}

export default Container
