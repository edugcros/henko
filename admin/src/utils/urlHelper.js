// admin/src/utils/urlHelper.js

export const getShopUrl = (tenantDomains) => {
  if (!tenantDomains || tenantDomains.length === 0) return null;

  const isProd = process.env.NODE_ENV === 'production';
  // Usamos el protocolo actual o default a https
  const protocol = window.location.protocol || 'https:';
  
  // Obtenemos el dominio (manejamos si el item es {domain: '...'} o solo un string)
  const primary = tenantDomains[0];
  const domainName = typeof primary === 'object' ? primary.domain : primary;

  if (!domainName) return null;

  // En desarrollo (Localhost / .local)
  if (!isProd || domainName.includes('localhost') || domainName.includes('.local')) {
    const port = process.env.REACT_APP_SHOP_PORT || '3002';
    // Si el dominio ya tiene puerto no lo agregamos, si no, se lo ponemos
    return `${protocol}//${domainName.split(':')[0]}:${port}`;
  }

  // En producción
  return `${protocol}//${domainName}`;
};