const SHOPIFY_API_VERSION = process.env.SHOPIFY_STOREFRONT_API_VERSION || '2026-04';

function config() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  if (!domain || !token) throw new Error('Shopify storefront is not configured.');
  return { domain: domain.replace(/^https?:\/\//, '').replace(/\/$/, ''), token };
}

async function storefront(query, variables = {}) {
  const { domain, token } = config();
  const response = await fetch(`https://${domain}/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const result = await response.json();
  if (!response.ok || result.errors) throw new Error(result.errors?.map(error => error.message).join(' ') || 'Shopify request failed.');
  return result.data;
}

function body(req) { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }

const CATALOG_QUERY = `query Catalog { products(first: 50, sortKey: TITLE) { nodes { handle title description images(first: 10) { nodes { url } } variants(first: 100) { nodes { id title availableForSale quantityAvailable selectedOptions { name value } price { amount currencyCode } } } } } }`;
const CREATE_CART = `mutation CreateCart($lines: [CartLineInput!]!) { cartCreate(input: { lines: $lines }) { cart { checkoutUrl cost { totalAmount { amount currencyCode } subtotalAmount { amount currencyCode } totalTaxAmount { amount currencyCode } } } userErrors { field message } } }`;

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const data = await storefront(CATALOG_QUERY);
      const products = data.products.nodes.map(product => ({ ...product, images: product.images.nodes.map(image => image.url), variants: product.variants.nodes }));
      return res.status(200).json({ products });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
    const { items } = body(req);
    if (!Array.isArray(items) || !items.length || items.length > 50) return res.status(400).json({ error: 'Your bag is invalid.' });
    const lines = items.map(item => ({ merchandiseId: String(item.merchandiseId || ''), quantity: Number(item.quantity) }));
    if (!lines.every(line => line.merchandiseId.startsWith('gid://shopify/ProductVariant/') && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 10)) return res.status(400).json({ error: 'Your bag contains an invalid variant.' });
    const data = await storefront(CREATE_CART, { lines });
    const result = data.cartCreate;
    if (result.userErrors.length || !result.cart?.checkoutUrl) return res.status(400).json({ error: result.userErrors.map(item => item.message).join(' ') || 'Shopify could not create your cart.' });
    return res.status(200).json({ checkoutUrl: result.cart.checkoutUrl, cost: result.cart.cost });
  } catch (error) {
    console.error('SHOPIFY STOREFRONT ERROR:', error);
    return res.status(500).json({ error: error.message || 'Shopify storefront is unavailable.' });
  }
};
