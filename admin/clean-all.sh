#!/bin/bash
#!./clean-all.sh

echo "🧹 Limpiando caché de ESLint..."
rm -f .eslintcache

echo "🧼 Ejecutando Prettier..."
npx prettier --write .

echo "🧠 Ejecutando ESLint con --fix..."
npx eslint . --fix

echo "✅ Formateo y limpieza completados."
