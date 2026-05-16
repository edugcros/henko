import { useEffect } from 'react'
import blog from '@assets/images/blog-1.jpg'
import { useDispatch, useSelector } from 'react-redux'
import { getABlog } from '@features/blogs/blogSlice'
import { useLocation } from 'react-router-dom'

const SingleBlog = () => {
  const dispatch = useDispatch()
  const location = useLocation()
  const getBlogId = location.pathname.split('/')[2]

  useEffect(() => {
    dispatch(getABlog(getBlogId))
  }, [dispatch, getBlogId])

  const blobState = useSelector(state => state?.blog.singleBlog)

  return (
    <>
      <Meta title={blobState?.title} />
      <BreadCrumb title={blobState?.title} />
      <Container class1="blog-wrapper home-wrapper-2 py-5">
        <div className="row">
          <div className="col-12">
            <div className="single-blog-card">
              <Link to="/blogs" className="d-flex align-items-center gap-10">
                <HiOutlineArrowLeft className="fs-4" /> Go back to Blogs
              </Link>
              <h3 className="title">{blobState?.title} </h3>
              <img src={blog} className="img-fluid w-auto my-4" alt="blog" />
              <p
                dangerouslySetInnerHTML={{
                  __html: blobState?.description,
                }}
              ></p>
            </div>
          </div>
        </div>
      </Container>
    </>
  )
}

export default SingleBlog
