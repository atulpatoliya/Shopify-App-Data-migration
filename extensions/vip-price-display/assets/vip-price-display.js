(() => {
  const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const moneyFormat = (amountInSubunits) => {
    // Basic INR formatting fallback for storefront display
    const amount = toNumber(amountInSubunits) / 100;
    return `Rs. ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const computeVipPrice = (price, compareAtPrice, percent) => {
    const current = toNumber(price);
    const compareAt = toNumber(compareAtPrice);
    if (current <= 0 || percent <= 0 || percent >= 100) {
      return { show: false, vipPrice: current };
    }

    if (compareAt > current) {
      const existingDiscountPct = ((compareAt - current) / compareAt) * 100;
      if (existingDiscountPct >= percent) {
        return { show: false, vipPrice: current };
      }
      const target = compareAt * (1 - percent / 100);
      return { show: target < current, vipPrice: target };
    }

    const target = current * (1 - percent / 100);
    return { show: target < current, vipPrice: target };
  };

  const initWidget = (widget) => {
    const isVip = String(widget.dataset.customerVip) === "true";
    if (!isVip) return;

    const percent = toNumber(widget.dataset.percent);
    const content = widget.querySelector(".vip-price-content");
    const vipPriceEl = widget.querySelector("[data-vip-price]");
    const originalEl = widget.querySelector("[data-original-price]");
    const jsonEl = widget.querySelector(".vip-variants-json");

    if (!content || !vipPriceEl || !originalEl || !jsonEl) return;

    let variants = {};
    try {
      variants = JSON.parse(jsonEl.textContent || "{}");
    } catch (_e) {
      return;
    }

    const updateForVariant = (variantId) => {
      const data = variants[String(variantId)];
      if (!data) return;

      const result = computeVipPrice(data.price, data.compare_at_price, percent);
      if (!result.show) {
        content.style.display = "none";
        return;
      }

      content.style.display = "block";
      vipPriceEl.textContent = moneyFormat(result.vipPrice);
      originalEl.textContent = moneyFormat(data.price);
    };

    const variantInput = document.querySelector('form[action*="/cart/add"] [name="id"]');
    if (variantInput) {
      updateForVariant(variantInput.value);
      variantInput.addEventListener("change", () => updateForVariant(variantInput.value));
    } else {
      updateForVariant(widget.dataset.selectedVariantId);
    }

    document.addEventListener("variant:change", (evt) => {
      const variantId = evt?.detail?.variant?.id;
      if (variantId) updateForVariant(variantId);
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".vip-price-widget").forEach(initWidget);
  });
})();
