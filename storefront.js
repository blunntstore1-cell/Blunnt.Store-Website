(() => {
  const catalogEndpoint = '/api/shopify';
  const storageKey = 'blunnt-shopify-cart';
  const grid = document.querySelector('#product-grid');
  const productModal = document.querySelector('#product-modal');
  const cartModal = document.querySelector('#cart-modal');
  const checkoutModal = document.querySelector('#checkout-modal');
  const galleryImage = document.querySelector('#gallery-image');
  const galleryLabel = document.querySelector('#gallery-label');
  const galleryDots = document.querySelector('#gallery-dots');
  const sizePicker = document.querySelector('#size-picker');
  const products = new Map();
  let cart = readCart();
  let selectedProduct = null;
  let selectedVariant = null;
  let activeSlide = 0;

  function readCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(saved) ? saved.filter(item => item && item.merchandiseId && Number.isInteger(item.quantity) && item.quantity > 0) : [];
    } catch { return []; }
  }

  function saveCart() { localStorage.setItem(storageKey, JSON.stringify(cart)); }
  function money(amount, currency = 'INR') {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount || 0));
  }
  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }
  function setModal(modal, open) {
    modal.hidden = !open;
    document.body.classList.toggle('overflow-hidden', !productModal.hidden || !cartModal.hidden || !checkoutModal.hidden);
    if (open) modal.querySelector('button, input, textarea')?.focus();
  }
  function productImages(product) {
    const images = (product.images || []).filter(Boolean);
    return images.length ? images : ['img/main.png'];
  }
  function selectedSize(variant) {
    return variant.selectedOptions?.find(option => option.name.toLowerCase() === 'size')?.value || variant.title;
  }
  function variantForSize(product, size) {
    return product.variants.find(variant => selectedSize(variant) === size);
  }
  function estimatedPromoPrice(variant) { return Math.max(0, Number(variant.price.amount) - 700); }

  function renderProducts() {
    grid.innerHTML = [...products.values()].map(product => {
      const firstVariant = product.variants.find(variant => variant.availableForSale) || product.variants[0];
      const sizes = product.variants.map(selectedSize);
      const image = productImages(product)[0];
      const price = firstVariant ? money(firstVariant.price.amount, firstVariant.price.currencyCode) : 'UNAVAILABLE';
      return `<article class="border border-borderGray bg-cardDark flex flex-col group product-trigger" data-shopify-product="${escapeHtml(product.handle)}" tabindex="0" role="button" aria-label="View ${escapeHtml(product.title)} t-shirt">
        <div class="aspect-[4/5] bg-black relative overflow-hidden flex items-center justify-center border-b border-borderGray"><img src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}" class="w-full h-full object-cover"></div>
        <div class="p-6 flex flex-col flex-grow"><div class="flex justify-between items-start mb-2 gap-2"><h3 class="font-bold text-sm tracking-wide">${escapeHtml(product.title)}</h3><span class="text-errorRed font-bold text-sm text-right"><s class="text-gray-400 font-normal">${price}</s><br>₹999</span></div>
        <p class="text-xs text-gray-400 mb-6 flex-grow">${escapeHtml(product.description || 'Heavyweight BLUNNT tee. Limited period offer applied at checkout.')}</p>
        <div class="flex gap-1.5 mb-6 text-[10px]">${sizes.map(size => `<span class="border border-borderGray px-2 py-1 text-gray-400">${escapeHtml(size)}</span>`).join('')}</div><button type="button" class="w-full bg-white text-black text-xs font-bold py-3.5 text-center hover:bg-errorRed hover:text-systemBlack transition tracking-widest">VIEW T-SHIRT</button></div></article>`;
    }).join('');
  }

  function renderGallery() {
    const images = productImages(selectedProduct);
    galleryImage.src = images[activeSlide];
    galleryImage.alt = selectedProduct.title;
    galleryLabel.textContent = `${String(activeSlide + 1).padStart(2, '0')} // PRODUCT VIEW`;
    galleryDots.innerHTML = images.map((_, index) => `<button class="gallery-dot" type="button" data-shopify-slide="${index}" aria-label="Show image ${index + 1}" aria-current="${index === activeSlide}">${index + 1}</button>`).join('');
  }

  function renderProductModal() {
    document.querySelector('#product-modal-title').textContent = selectedProduct.title;
    document.querySelector('#detail-description').textContent = selectedProduct.description || 'Limited-period offer. Final pricing and availability are confirmed by Shopify at checkout.';
    const first = selectedProduct.variants[0];
    document.querySelector('#detail-price').innerHTML = first ? `₹999 <span class="detail-mrp">${money(first.price.amount, first.price.currencyCode)}</span>` : 'UNAVAILABLE';
    document.querySelector('#limited-offer').hidden = !first;
    sizePicker.innerHTML = selectedProduct.variants.map(variant => {
      const size = selectedSize(variant);
      return `<button type="button" data-shopify-size="${escapeHtml(size)}" ${variant.availableForSale ? '' : 'disabled'} aria-pressed="false">${escapeHtml(size)}${variant.availableForSale ? '' : ' / SOLD OUT'}</button>`;
    }).join('');
    document.querySelector('#size-message').textContent = '';
    renderGallery();
  }

  function openProduct(handle) {
    selectedProduct = products.get(handle);
    if (!selectedProduct) return;
    selectedVariant = null;
    activeSlide = 0;
    renderProductModal();
    setModal(productModal, true);
  }

  function renderCart() {
    const cartItems = document.querySelector('#cart-items');
    const validItems = cart.map(item => ({ ...item, product: products.get(item.handle) })).filter(item => item.product && variantForSize(item.product, item.size));
    if (validItems.length !== cart.length) { cart = validItems.map(({ product, ...item }) => item); saveCart(); }
    const quantity = cart.reduce((sum, item) => sum + item.quantity, 0);
    const total = validItems.reduce((sum, item) => sum + estimatedPromoPrice(variantForSize(item.product, item.size)) * item.quantity, 0);
    document.querySelector('#cart-count').textContent = quantity;
    document.querySelector('#cart-total').textContent = money(total);
    document.querySelector('#cart-empty').textContent = cart.length ? 'PROMO PRICE IS CONFIRMED BY SHOPIFY AT CHECKOUT.' : 'YOUR BAG IS CURRENTLY EMPTY.';
    document.querySelector('#cart-checkout').disabled = !cart.length;
    document.querySelector('#promo-code').closest('.promo-row').hidden = true;
    document.querySelector('#promo-status').hidden = true;
    document.querySelector('#discount-lines').hidden = true;
    cartItems.innerHTML = validItems.map(item => {
      const variant = variantForSize(item.product, item.size);
      return `<div class="cart-item"><img src="${escapeHtml(productImages(item.product)[0])}" alt="${escapeHtml(item.product.title)}"><div><strong>${escapeHtml(item.product.title)}</strong><br>SIZE: ${escapeHtml(item.size)} · QTY: ${item.quantity}<br><span class="text-errorRed">₹999 EACH</span></div><button class="cart-remove" type="button" data-shopify-remove="${escapeHtml(item.merchandiseId)}">REMOVE</button></div>`;
    }).join('');
  }

  function addToCart() {
    if (!selectedVariant) { document.querySelector('#size-message').textContent = 'SELECT YOUR SIZE FIRST.'; return; }
    const size = selectedSize(selectedVariant);
    const current = cart.find(item => item.merchandiseId === selectedVariant.id);
    if (current) current.quantity += 1;
    else cart.push({ merchandiseId: selectedVariant.id, handle: selectedProduct.handle, size, quantity: 1 });
    saveCart(); renderCart(); setModal(productModal, false); setModal(cartModal, true);
  }

  async function checkout() {
    if (!cart.length) return;
    const button = document.querySelector('#cart-checkout');
    const status = document.querySelector('#cart-empty');
    button.disabled = true; button.textContent = 'OPENING SHOPIFY CHECKOUT...'; status.textContent = '';
    try {
      const response = await fetch(catalogEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: cart.map(({ merchandiseId, quantity }) => ({ merchandiseId, quantity })) }) });
      const result = await response.json();
      if (!response.ok || !result.checkoutUrl) throw new Error(result.error || 'Shopify checkout is unavailable.');
      location.assign(result.checkoutUrl);
    } catch (error) {
      status.textContent = error.message || 'SHOPIFY CHECKOUT IS UNAVAILABLE.';
      button.disabled = false; button.textContent = 'CHECKOUT';
    }
  }

  document.addEventListener('click', event => {
    const productCard = event.target.closest('[data-shopify-product]');
    if (productCard) { event.preventDefault(); event.stopImmediatePropagation(); openProduct(productCard.dataset.shopifyProduct); return; }
    const size = event.target.closest('[data-shopify-size]');
    if (size) { event.preventDefault(); event.stopImmediatePropagation(); selectedVariant = variantForSize(selectedProduct, size.dataset.shopifySize); sizePicker.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', button === size)); document.querySelector('#size-message').textContent = ''; return; }
    const slide = event.target.closest('[data-shopify-slide]');
    if (slide) { event.preventDefault(); event.stopImmediatePropagation(); activeSlide = Number(slide.dataset.shopifySlide); renderGallery(); return; }
    if (event.target.closest('#start-checkout')) { event.preventDefault(); event.stopImmediatePropagation(); addToCart(); return; }
    if (event.target.closest('#cart-button')) { event.preventDefault(); event.stopImmediatePropagation(); renderCart(); setModal(cartModal, true); return; }
    const remove = event.target.closest('[data-shopify-remove]');
    if (remove) { event.preventDefault(); event.stopImmediatePropagation(); cart = cart.filter(item => item.merchandiseId !== remove.dataset.shopifyRemove); saveCart(); renderCart(); return; }
    if (event.target.closest('#cart-checkout')) { event.preventDefault(); event.stopImmediatePropagation(); checkout(); }
  }, true);

  document.addEventListener('keydown', event => {
    const card = event.target.closest('[data-shopify-product]');
    if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopImmediatePropagation(); openProduct(card.dataset.shopifyProduct); }
  }, true);

  fetch(catalogEndpoint).then(async response => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Catalog unavailable.');
    result.products.forEach(product => products.set(product.handle, product));
    renderProducts(); renderCart();
  }).catch(error => { grid.innerHTML = `<p class="text-xs text-errorRed">CATALOGUE UNAVAILABLE. ${escapeHtml(error.message)}</p>`; });
})();
