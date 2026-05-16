import React, { useEffect } from 'react'
import PropTypes from 'prop-types'

const Meta = ({ title, description }) => {
  useEffect(() => {
    document.title = title

    // Actualizar meta descripción
    const metaDescription = document.querySelector('meta[name="description"]')
    if (metaDescription) {
      metaDescription.setAttribute('content', description || '')
    } else {
      const newMeta = document.createElement('meta')
      newMeta.name = 'description'
      newMeta.content = description
      document.head.appendChild(newMeta)
    }
  }, [title, description])

  return null
}

Meta.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
}

export default Meta
