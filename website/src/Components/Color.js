import React from 'react'
import PropTypes from 'prop-types'

const Color = props => {
  const { colorData, setColorData } = props

  return (
    <>
      <ul className="colors ps-0">
        {colorData &&
          colorData.map((item, index) => {
            return (
              <li
                onClick={() => setColorData(item?._id)} // Usamos el _id para actualizar el estado
                style={{ backgroundColor: item?.title }} // Usamos title para aplicar color de fondo
                key={index}
              ></li>
            )
          })}
      </ul>
    </>
  )
}

// Ajuste de PropTypes para reflejar que `colorData` es un array de objetos con `_id` y `title`
Color.propTypes = {
  colorData: PropTypes.arrayOf(
    PropTypes.shape({
      _id: PropTypes.string.isRequired, // Asegura que cada objeto tenga un _id
      title: PropTypes.string.isRequired, // Asegura que cada objeto tenga un title
    }),
  ).isRequired,
  setColorData: PropTypes.func.isRequired,
}

export default Color
