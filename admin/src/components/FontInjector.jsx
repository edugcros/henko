// src/components/shop/FontInjector.jsx
import React, { useEffect } from 'react';
import { GOOGLE_FONTS } from './FontSelector'; // Importa tu array de objetos

const FontInjector = ({ typography }) => {
  useEffect(() => {
    if (!typography) return;

    // 1. Identificar qué fuentes se están usando
    const usedFonts = [
      typography.fontFamily,
      typography.headingFont,
      typography.secondaryFont
    ].filter(Boolean);

    // 2. Generar los links para Google Fonts
    usedFonts.forEach(stack => {
      const fontData = GOOGLE_FONTS.find(f => f.stack === stack);
      
      if (fontData) {
        const linkId = `google-font-${fontData.id}`;
        if (!document.getElementById(linkId)) {
          const link = document.createElement('link');
          link.id = linkId;
          link.rel = 'stylesheet';
          // Cargamos todos los pesos necesarios para que no se vea "flaca" la letra
          link.href = `https://fonts.googleapis.com/css2?family=${fontData.family}:wght@${fontData.weights}&display=swap`;
          document.head.appendChild(link);
        }
      }
    });
  }, [typography]);

  return null; // Este componente no renderiza nada visual
};

export default FontInjector;