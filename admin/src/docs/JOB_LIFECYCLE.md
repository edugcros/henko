# Job Lifecycle: ProductAnalysisPage ↔ AddProduct

## Arquitectura de Responsabilidades

```
┌─────────────────────────────────────────────────────────────┐
│ ProductAnalysisPage                                         │
│ • Encolar imágenes (ahora o programadas)                   │
│ • Ver status de jobs                                       │
│ • Cancelar/reprogramar jobs                               │
│ • NO ejecuta IA                                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ Comparte: STATUS_META, jobAnalysisService
                   │
┌──────────────────▼──────────────────────────────────────────┐
│ Backend API                                                  │
│ • GET /product/analysis/{jobId}                            │
│ • POST /product/analyze-visual (crea/analiza)             │
│ • PATCH /product/analysis/{jobId} (actualiza status)      │
│ • DELETE /product/analysis/{jobId}                        │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ Sincroniza status de jobs
                   │
┌──────────────────▼──────────────────────────────────────────┐
│ AddProduct                                                   │
│ • Carga una imagen                                         │
│ • Si tiene jobId → obtiene análisis previo (sin IA)       │
│ • Si no → ejecuta IA mediante /product/analyze-visual     │
│ • Aprueba/rechaza análisis                                │
│ • Crea producto                                           │
└─────────────────────────────────────────────────────────────┘
```

## Estados del Job

| Estado | Descripción | Quién Controla | Transición Siguiente |
|--------|-------------|-----------------|----------------------|
| **pending** | En cola, listo para análisis | ProductAnalysisPage → Backend | → imported (AddProduct lo abre) |
| **scheduled** | Programado para hora X | ProductAnalysisPage | → pending (a las X horas) |
| **imported** | Admin abrió AddProduct con esto | AddProduct | → processing (IA inicia) |
| **processing** | IA analizando | Backend + AddProduct | → completed (IA termina) |
| **completed** | Análisis listo | Backend | → approved/rejected (Admin decide) |
| **approved** | Admin aprobó, producto creado | AddProduct | ✓ Finalizado |
| **rejected** | Admin rechazó | AddProduct | → pending (opcionalmente reintentar) |
| **failed** | Error en IA | Backend | → pending (reintentar) |

## Flujo Completo: Ejemplo

```
1. Admin en ProductAnalysisPage carga imagen
   • Estado: pending
   • Job creado en BD

2. Admin abre AddProduct
   • AddProduct llama: jobAnalysisService.getJobById(jobId)
   • Obtiene job + análisis previo (si existe)
   • Llama: jobAnalysisService.markJobAsImported(jobId)
   • Estado → imported

3. AddProduct llama /product/analyze-visual
   • Backend recibe jobId
   • Actualiza job: Estado → processing
   • Ejecuta IA

4. IA termina
   • Backend guarda resultado en job.analysis
   • Estado → completed

5. AddProduct muestra resultados
   • Extrae de job.analysis
   • Admin revisa y aprueba/rechaza

6. Admin aprueba
   • Estado → approved
   • Producto creado
   • ProductAnalysisPage muestra "Aprobado"

7. Admin rechaza (opcional)
   • Estado → rejected
   • Admin puede reintentar desde ProductAnalysisPage
   • Estado → pending
```

## Integración AddProduct ↔ jobAnalysisService

```javascript
// En AddProduct.js, cuando carga una imagen:

import jobAnalysisService from '@services/jobAnalysisService'
import useProductAnalyzer from '@hooks/useProductAnalyzer'

// Si la imagen tiene jobId (viene de ProductAnalysisPage):
const loadExistingJob = async (jobId) => {
  // 1. Obtener job + análisis previo
  const job = await jobAnalysisService.getJobById(jobId)
  
  // 2. Hidratar análisis sin llamar IA de nuevo
  if (job?.analysis) {
    const analyzer = useProductAnalyzer()
    analyzer.hydrateAnalysis(job.analysis)
  }
  
  // 3. Notificar que fue "imported"
  await jobAnalysisService.markJobAsImported(jobId)
}

// Si es una imagen nueva sin jobId:
const analyzeNewImage = async (file) => {
  // useProductAnalyzer.analyzeImage() automáticamente:
  // • POST /product/analyze-visual (crea job si no existe)
  // • Backend retorna jobId
  // • Se sincroniza con ProductAnalysisPage
  const result = await analyzer.analyzeImage(file)
}
```

## Constantes Compartidas

Ver: `src/constants/jobStatus.js`

- **STATUS_META**: Definición única de estados
- **STATUS_FILTER_OPTIONS**: Opciones para filtros UI
- **STATUS_GROUPS**: Estados agrupados por etapa
- **STATE_TRANSITIONS**: Transiciones válidas

## Archivos Relacionados

- `src/pages/ProductAnalysisPage.jsx` → UI de cola
- `src/pages/AddProduct.js` → UI de análisis + creación
- `src/constants/jobStatus.js` → Definiciones de estado
- `src/services/jobAnalysisService.js` → API pública
- `src/hooks/useProductAnalyzer.js` → Hook de IA
