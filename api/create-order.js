const PRODUCT_PRICES = {
  coke: 99900,
  spotify: 99900,
  internet: 89900,
  finalcut: 99900,
};

// Keep this in sync with the storefront configuration. Set false to close OG15.
const PROMO_ENABLED = true;
const PROMO_CODE = 'OG15';

function calculatePricing(items, promoCode) {
  const quantity = items.reduce((total, item) => total + item.quantity, 0);
  const subtotal = items.reduce((total, item) => total + PRODUCT_PRICES[item.sku] * item.quantity, 0);
  const bundleRate = quantity >= 4 ? 0.30 : quantity === 3 ? 0.25 : quantity === 2 ? 0.15 : 0;
  const bundleDiscount = Math.round(subtotal * bundleRate);
  const afterBundle = subtotal - bundleDiscount;
  const promoValid = PROMO_ENABLED && String(promoCode || '').trim().toUpperCase() === PROMO_CODE;
  // OG15 applies after the automatic bundle tier, making the discounts stack.
  const promoDiscount = promoValid ? Math.round(afterBundle * 0.15) : 0;
  const merchandise = afterBundle - promoDiscount;
  const shipping = merchandise > 200000 ? 0 : merchandise < 100000 ? 5000 : 0;
  return { quantity, subtotal, bundleRate, bundleDiscount, promoDiscount, shipping, total: merchandise + shipping };
}

function getBody(req) {
  if (!req.body) return {};
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  try {
    const { items, customer = {}, promoCode } = getBody(req);
    if (!Array.isArray(items) || !items.length || items.length > 10) return res.status(400).json({ error: 'Your bag is invalid.' });
    const validItems = items.map(({ sku, size, quantity }) => ({ sku, size, quantity: Number(quantity) }));
    const isValid = validItems.every(item => PRODUCT_PRICES[item.sku] && ['S', 'M', 'L', 'XL'].includes(item.size) && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 10);
    if (!isValid) return res.status(400).json({ error: 'Invalid product, size, or quantity.' });
    const pricing = calculatePricing(validItems, promoCode);
    if (!customer.name || !customer.email || !customer.phone || !customer.address) return res.status(400).json({ error: 'Customer details are incomplete.' });
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return res.status(500).json({ error: 'Payment service is not configured.' });

    const authorization = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const receipt = `blunnt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: pricing.total, currency: 'INR', receipt, notes: { items: validItems.map(item => `${item.sku}:${item.size}:${item.quantity}`).join(','), bundle_discount: pricing.bundleDiscount, promo_discount: pricing.promoDiscount, shipping: pricing.shipping } }),
    });
    const order = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: 'Razorpay could not create the order.' });
    return res.status(200).json({ order: { id: order.id, amount: order.amount, currency: order.currency }, pricing, keyId: process.env.RAZORPAY_KEY_ID });
  } catch {
    return res.status(500).json({ error: 'Unable to create a secure order.' });
  }
};
