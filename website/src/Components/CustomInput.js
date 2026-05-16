import React from 'react'
import PropTypes from 'prop-types'

const CustomInput = props => {
  const { type, name, placeholder, onChange, onBlur, value } = props
  return (
    <div>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        className={'form-control'}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
      />
    </div>
  )
}
CustomInput.propTypes = {
  type: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  placeholder: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onBlur: PropTypes.func,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
}

export default CustomInput
