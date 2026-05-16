import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'
import Product from '../models/productModel.js'
import logger from '../../config/logger.js'

let cloudinary = null
if ((process.env.STORAGE_DRIVER || 'cloudinary').toLowerCase() === 'cloudinary') {
  const { v2 } = await import('cloudinary')
  cloudinary = v2
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  })
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '../../')

const ensureDir = async dir => {
  try { await fs.mkdir(dir, { recursive: true }) } catch (_) {_}
}

const ensureSingleMain = product => product.ensureSingleMainImage()
const publicBaseUrl = () => process.env.CLOUDINARY_URL || ''

export const uploadProductImage = async (req, res) => {
  try {
    const { productId } = req.params
    const { alt } = req.body || {}

    if (!req.file?.processedBuffer) {
      return res.status(400).json({ success: false, message: 'Imagen no procesada' })
    }

    const product = await Product.findById(productId)
    if (!product) return res.status(404).json({ success: false, message: 'Producto no encontrado' })

    const driver = (process.env.STORAGE_DRIVER || 'cloudinary').toLowerCase()
    let url = ''
    let public_id = ''

    if (driver === 'cloudinary' && cloudinary) {
      const folder = `products/${productId}`
      const publicIdBase = `${Date.now()}-${uuidv4()}`
      const uploaded = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder, public_id: publicIdBase, resource_type: 'image', overwrite: false },
          (err, result) => (err ? reject(err) : resolve(result)),
        )
        stream.end(req.file.processedBuffer)
      })
      url = uploaded.secure_url
      public_id = uploaded.public_id
    } else {
      const folderAbs = path.join(rootDir, 'uploads', 'products', productId)
      await ensureDir(folderAbs)
      const fileName = req.file.safeName
      const absPath = path.join(folderAbs, fileName)
      await fs.writeFile(absPath, req.file.processedBuffer)
      public_id = path.posix.join('products', productId, fileName)
      url = `${publicBaseUrl()}/uploads/${public_id}`.replace(/(?<!:)\/{2,}/g, '/')
    }

    const isFirst = !product.images?.length
    product.images.push({
      url,
      public_id,
      alt: alt?.toString().slice(0, 120),
      isMain: Boolean(isFirst),
    })
    ensureSingleMain(product)
    await product.save()

    logger.info(`📸 Imagen subida para producto ${productId} via ${driver}: ${public_id}`)
    return res.status(201).json({ success: true, data: product.images })
  } catch (err) {
    logger.error('Error subiendo imagen de producto', { err })
    return res.status(500).json({ success: false, message: 'Error subiendo imagen' })
  }
}

export const deleteProductImage = async (req, res) => {
  try {
    const { productId, public_id } = req.params
    const driver = (process.env.STORAGE_DRIVER || 'cloudinary').toLowerCase()

    const product = await Product.findById(productId)
    if (!product) return res.status(404).json({ success: false, message: 'Producto no encontrado' })

    const idx = product.images.findIndex(img => String(img.public_id) === String(public_id))
    if (idx === -1) return res.status(404).json({ success: false, message: 'Imagen no encontrada en el producto' })

    if (driver === 'cloudinary' && cloudinary) {
      await cloudinary.uploader.destroy(public_id, { resource_type: 'image' })
    } else {
      const abs = path.join(rootDir, 'uploads', public_id)
      try { await fs.unlink(abs) } catch (_) {_}
    }

    const wasMain = !!product.images[idx]?.isMain
    product.images.splice(idx, 1)
    if (wasMain && product.images.length) product.images[0].isMain = true
    ensureSingleMain(product)
    await product.save()

    logger.info(`🗑️ Imagen eliminada ${public_id} del producto ${productId} (${driver})`)
    return res.status(200).json({ success: true, data: product.images })
  } catch (err) {
    logger.error('Error eliminando imagen de producto', { err })
    return res.status(500).json({ success: false, message: 'Error eliminando imagen' })
  }
}
