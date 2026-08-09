const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

function assertSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error('Order database is not configured.');
}

async function supabase(path, options = {}) {
  assertSupabaseConfig();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}): ${body}`);
  return body ? JSON.parse(body) : null;
}

function orderNumber(razorpayOrderId) {
  return `BLN-${crypto.createHash('sha256').update(razorpayOrderId).digest('hex').slice(0, 8).toUpperCase()}`;
}

function asCurrency(paise) { return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`; }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

function orderEmail(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const rows = items.map(item => `<tr><td>${escapeHtml(item.product_name)}</td><td>${escapeHtml(item.sku)}</td><td>${escapeHtml(item.size)}</td><td>${item.quantity}</td><td>${asCurrency(item.total_price)}</td></tr>`).join('');
  const pricing = order.pricing || {};
  const html = `<!doctype html><html><body style="margin:0;background:#0A0A0A;color:#D4C5A9;font-family:monospace"><main style="max-width:620px;margin:0 auto;padding:36px 24px"><p style="color:#FF3B30;letter-spacing:2px;font-size:12px">[ BLUNNT.* // ORDER CONFIRMED ]</p><h1 style="font-size:30px;line-height:1.1;margin:20px 0">THANKS FOR TRUSTING A NEW BRAND.</h1><p>Hey ${escapeHtml(order.customer_name)},</p><p>Your BLUNNT order is confirmed, paid, and entering its physical era. Thank you for taking a chance on us. We’re getting it ready and will share tracking once it escapes our system.</p><p style="border:1px solid #D4C5A9;padding:14px"><strong>ORDER #${escapeHtml(order.order_number)}</strong><br>${new Date(order.paid_at || order.created_at).toLocaleString('en-IN')}</p><table style="width:100%;border-collapse:collapse;font-size:12px" cellpadding="8"><thead><tr style="text-align:left;border-bottom:1px solid #D4C5A9"><th>ITEM</th><th>SKU</th><th>SIZE</th><th>QTY</th><th>TOTAL</th></tr></thead><tbody>${rows}</tbody></table><p style="border-top:1px solid #D4C5A9;padding-top:14px"><strong>ORDER TOTAL: ${asCurrency(pricing.total || 0)}</strong><br>PAYMENT STATUS: PAID</p><p><strong>DELIVERY ADDRESS</strong><br>${escapeHtml(order.shipping_address).replace(/\n/g, '<br>')}</p><p style="margin-top:32px">— BLUNNT.*</p></main></body></html>`;
  return { subject: `Order confirmed — ${order.order_number}`, html };
}

function internalOrderEmail(order) {
  const items = (order.items || []).map(item => `${item.product_name} (${item.sku}) · ${item.size} × ${item.quantity} · ${asCurrency(item.total_price)}`).join('\n');
  const pricing = order.pricing || {};
  return { subject: `New BLUNNT Order — ${order.order_number}`, text: `NEW ORDER RECEIVED\n\nORDER\nOrder ID: ${order.order_number}\nDate: ${new Date(order.paid_at || order.created_at).toLocaleString('en-IN')}\nRazorpay payment ID: ${order.razorpay_payment_id}\nPayment status: ${order.payment_status}\n\nCUSTOMER\n${order.customer_name}\n${order.customer_email}\n${order.customer_phone}\n\nPRODUCTS\n${items}\n\nSHIPPING\n${order.shipping_address}\n\nORDER TOTAL: ${asCurrency(pricing.total || 0)}` };
}

async function sendBrevo(message) {
  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) throw new Error('Email service is not configured.');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ sender: { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || 'BLUNNT' }, ...message }) });
  if (!response.ok) throw new Error(`Brevo request failed (${response.status}).`);
}

async function createPendingOrder({ razorpayOrderId, customer, items, pricing, promoCode }) {
  const order = { order_number: orderNumber(razorpayOrderId), razorpay_order_id: razorpayOrderId, customer_name: customer.name.trim(), customer_email: customer.email.trim().toLowerCase(), customer_phone: customer.phone.trim(), shipping_address: customer.address.trim(), items, pricing, promo_code: promoCode || null };
  const created = await supabase('orders', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(order) });
  return created[0];
}

async function confirmPaidOrder({ razorpayOrderId, razorpayPaymentId }) {
  // The null payment-id condition is the idempotency lock: only one request can claim a paid order.
  const claimed = await supabase(`orders?razorpay_order_id=eq.${encodeURIComponent(razorpayOrderId)}&razorpay_payment_id=is.null`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ razorpay_payment_id: razorpayPaymentId, payment_status: 'paid', paid_at: new Date().toISOString() }) });
  if (claimed.length) return { order: claimed[0], newlyPaid: true };
  const existing = await supabase(`orders?razorpay_order_id=eq.${encodeURIComponent(razorpayOrderId)}&select=*`, { method: 'GET' });
  if (!existing.length || existing[0].razorpay_payment_id !== razorpayPaymentId || existing[0].payment_status !== 'paid') throw new Error('Order payment state is invalid.');
  return { order: existing[0], newlyPaid: false };
}

async function recordEmailSent(orderId, field) { await supabase(`orders?id=eq.${encodeURIComponent(orderId)}`, { method: 'PATCH', body: JSON.stringify({ [field]: new Date().toISOString() }) }); }

async function sendOrderEmails(order) {
  const outcomes = { customer: false, internal: false };
  if (!order.customer_email_sent_at) {
    try { const email = orderEmail(order); await sendBrevo({ to: [{ email: order.customer_email, name: order.customer_name }], subject: email.subject, htmlContent: email.html }); await recordEmailSent(order.id, 'customer_email_sent_at'); outcomes.customer = true; } catch (error) { console.error('CUSTOMER ORDER EMAIL ERROR:', error.message); }
  }
  if (!order.email_sent_at) {
    try { const email = internalOrderEmail(order); await sendBrevo({ to: [{ email: 'contact@blunnt.store', name: 'BLUNNT Orders' }], subject: email.subject, textContent: email.text }); await recordEmailSent(order.id, 'email_sent_at'); outcomes.internal = true; } catch (error) { console.error('INTERNAL ORDER EMAIL ERROR:', error.message); }
  }
  return outcomes;
}

module.exports = { createPendingOrder, confirmPaidOrder, sendOrderEmails };
