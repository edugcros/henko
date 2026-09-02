// 📁 src/components/promotionalBlocks/PromotionalBlockRenderer.jsx
import React from 'react'
import WeeklyOffersSection from './WeeklyOffersSection'
import GenericPromotionalSection from './GenericPromotionalSection'

const BLOCK_COMPONENTS = {
  weekly_offers: WeeklyOffersSection,
  featured_products: GenericPromotionalSection,
  new_arrivals: GenericPromotionalSection,
  clearance: GenericPromotionalSection,
  seasonal_campaign: GenericPromotionalSection,
  custom: GenericPromotionalSection,
}

const PromotionalBlockRenderer = ({ blocks = [] }) => {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return null
  }

  return (
    <>
      {blocks.map(block => {
        const Component = BLOCK_COMPONENTS[block.type] || GenericPromotionalSection

        return <Component key={block._id} block={block} />
      })}
    </>
  )
}

export default PromotionalBlockRenderer
