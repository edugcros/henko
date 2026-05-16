// analyzeResponses.js
import fs from 'fs'
import path from 'path'

const targetDir = './src/controller' // O ajustalo a tu carpeta
const statusRegex = /res\.status\((\d+)\)\.json\(\s*({[\s\S]*?})\s*\)/g

const scanFile = filePath => {
  const content = fs.readFileSync(filePath, 'utf-8')
  let match
  const results = []

  while ((match = statusRegex.exec(content)) !== null) {
    const [ statusCode, jsonContent] = match
    results.push({
      file: filePath,
      status: statusCode,
      content: jsonContent.trim(),
    })
  }

  return results
}

const walkDir = (dir, callback) => {
  fs.readdirSync(dir).forEach(file => {
    const fullPath = path.join(dir, file)
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      walkDir(fullPath, callback)
    } else if (file.endsWith('.js')) {
      callback(fullPath)
    }
  })
}

const allMatches = []
walkDir(targetDir, file => {
  const matches = scanFile(file)
  if (matches.length > 0) {
    allMatches.push(...matches)
  }
})

if (allMatches.length === 0) {
  console.log('✅ No se encontraron llamadas a res.status(...).json(...)')
} else {
  console.log('📦 Resultados encontrados:\n')
  allMatches.forEach(({ file, status, content }, i) => {
    console.log(`🔹 ${i + 1}. Archivo: ${file}`)
    console.log(`   Status: ${status}`)
    console.log(`   JSON: ${content}\n`)
  })
}
