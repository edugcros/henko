import PropTypes from 'prop-types'

const SpecialProduct = props => {
  const { item } = props
  const quantity = item?.quantity
  const sold = item?.sold

  return (
    <>
      <div className="col-6 mb-3">
        <div className="special-product-card">
          <div className="d-flex justify-content-between">
            <div>
              <img
                src={item?.images[0]?.url}
                className="img-fluid"
                style={{ borderRadius: '15px' }}
                alt="watch"
                width="auto"
              />
            </div>
            <div className="special-product-content">
              <h5 className="brand">{item?.brand}</h5>
              <h6 className="title">{item?.title}</h6>
              <ReactStars
                count={5}
                size={24}
                value={item?.totalrating?.toString()}
                edit={false}
                activeColor="#ffd700"
              />
              <p className="price">
                <span className="red-p">$ {item?.price}</span> &nbsp;{' '}
                {/*<strike>$200</strike>*/}
              </p>
              <div className="discount-till d-flex align-items-center gap-10">
                <p className="mb-0">
                  <b>5 </b>days
                </p>
                <div className="d-flex gap-10 align-items-center">
                  <span className="badge rounded-circle p-3 bg-danger">1</span>:
                  <span className="badge rounded-circle p-3 bg-danger">1</span>:
                  <span className="badge rounded-circle p-3 bg-danger">1</span>
                </div>
              </div>
              <div className="prod-count my-3">
                <p>Stock: {quantity - sold}</p>
                <div className="progress">
                  <div
                    className="progress-bar"
                    role="progressbar"
                    style={{ width: quantity - sold }}
                    aria-valuenow={quantity - sold}
                    aria-valuemin={quantity - sold}
                    aria-valuemax={quantity}
                  ></div>
                </div>
              </div>
              <Link className="button" to={'/product/' + item?._id}>
                View
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
SpecialProduct.propTypes = {
  item: PropTypes.shape({
    quantity: PropTypes.number,
    sold: PropTypes.number,
    images: PropTypes.arrayOf(
      PropTypes.shape({
        url: PropTypes.string.isRequired,
      }),
    ),
    brand: PropTypes.string,
    title: PropTypes.string,
    totalrating: PropTypes.number,
    price: PropTypes.number.isRequired,
    _id: PropTypes.string.isRequired,
  }).isRequired,
}

export default SpecialProduct
