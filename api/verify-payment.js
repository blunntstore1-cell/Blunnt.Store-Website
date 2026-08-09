const crypto = require('crypto');
const { confirmPaidOrder, sendOrderEmails } = require('./_lib/order-service');

function getBody(req) {
  if (!req.body) return {};
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  try {
    const { razorpay_payment_id: paymentId, razorpay_order_id: orderId, razorpay_signature: signature } = getBody(req);
    if (!paymentId || !orderId || !signature || !process.env.RAZORPAY_KEY_SECRET) return res.status(400).json({ error: 'Invalid payment response.' });

    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    const valid = expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!valid) return res.status(400).json({ error: 'Payment signature verification failed.' });

    const { order, newlyPaid } = await confirmPaidOrder({ razorpayOrderId: orderId, razorpayPaymentId: paymentId });
    // Payment remains safely recorded if Brevo is temporarily unavailable.
    if (newlyPaid) await sendOrderEmails(order);
    return res.status(200).json({ verified: true, order: { orderNumber: order.order_number, customerName: order.customer_name, items: order.items, pricing: order.pricing } });
  } catch (error) {
    console.error('VERIFY PAYMENT ERROR:', error);
    return res.status(500).json({ error: 'Unable to verify and record payment.' });
  }
};
