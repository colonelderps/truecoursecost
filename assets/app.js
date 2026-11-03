'use strict';

/** Annual USD model. Eligibility is always true; incomplete rows are excluded explicitly. */
function quote(plan, R, S, billing, mode, site) {
  if (!Number.isFinite(R) || R <= 0 || !Number.isFinite(S) || S <= 0) {
    throw new RangeError('Revenue and average sale price must be positive finite numbers.');
  }
  if (!['annual', 'monthly'].includes(billing) || !['native', 'own'].includes(mode)) {
    throw new RangeError('Unknown billing or processor mode.');
  }
  site = site || {};
  const ownPct = site.own_pct ?? 2.9;
  const ownFixed = site.own_fixed_cents ?? 30;
  const N = R / S;
  const price = billing === 'annual' ? plan.price_annual_mo : plan.price_monthly;
  const reasons = [];
  const flags = [];
  if (price == null) reasons.push('contact sales / price unavailable');
  if (mode === 'own' && plan.own_processor_surcharge_pct == null) {
    reasons.push('own-gateway not stated by vendor');
  }
  const baseline_processing = R * 2.9 / 100 + N * 0.30;
  const subscription = price == null ? null : 12 * price;
  const platform_fee = R * plan.platform_fee_pct / 100;
  let processing;
  let gateway_surcharge;
  if (mode === 'native') {
    processing = R * plan.native_processor.pct / 100 + N * (plan.native_processor.fixed_cents || 0) / 100;
    gateway_surcharge = 0;
    if (plan.native_processor.fixed_cents == null) flags.push('fixed fee unknown, assumed $0');
  } else {
    processing = R * ownPct / 100 + N * ownFixed / 100;
    gateway_surcharge = plan.own_processor_surcharge_pct == null ? null : R * plan.own_processor_surcharge_pct / 100;
  }
  const excluded = reasons.length > 0;
  const total = excluded ? null : subscription + platform_fee + processing + gateway_surcharge;
  return { eligible: true, excluded, reasons, flags, sales: N, subscription, platform_fee,
    processing, gateway_surcharge, baseline_processing, total,
    effective_take_pct: excluded ? null : (total - baseline_processing) / R * 100 };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { quote };

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    if (!$('calculator-form')) return;
    const fees = window.FEES || [];
    const site = window.SITE || {};
    const names = { thinkific: 'Thinkific', teachable: 'Teachable', kajabi: 'Kajabi', podia: 'Podia', kit: 'Kit' };
    const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
    const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const label = p => `${names[p.platform] || p.platform} · ${p.plan}`;
    const params = new URLSearchParams(window.location.search);
    for (const [key, fallback, min, max] of [['revenue', 25000, 1000, 1000000], ['sale', 100, 0.01, Infinity]]) {
      const raw = params.get(key);
      const value = raw === null ? fallback : Number(raw);
      $(key).value = Number.isFinite(value) && value >= min && value <= max ? value : fallback;
    }
    for (const [key, allowed] of [['billing', ['annual', 'monthly']], ['mode', ['native', 'own']]]) {
      if (allowed.includes(params.get(key))) $(key).value = params.get(key);
    }
    document.querySelectorAll('[data-site-name]').forEach(el => { el.textContent = site.name || site.site_name || 'TrueCourseCost'; });
    document.title = `${site.name || site.site_name || 'TrueCourseCost'} — Course platform fee calculator`;

    function evidence(p) {
      const date = esc(p.last_verified || 'not recorded');
      const text = p.confidence === 'primary' ? `verified from vendor page ${date}` : p.confidence === 'secondary' ? 'partly from secondary source' : 'unverified';
      const kind = ['primary', 'secondary'].includes(p.confidence) ? p.confidence : 'unverified';
      return `<span class="badge ${kind}">${text}</span><br><small>Last verified: ${date}</small>`;
    }
    function source(p) {
      const url = /^https?:\/\//i.test(p.source_url || '') ? p.source_url : '#';
      return `<a href="${esc(url)}">Vendor pricing</a>`;
    }
    function table(rows, caption) {
      if (!rows.length) return '<p>No plans can be ranked with these inputs.</p>';
      return `<div class="table-scroll" role="region" tabindex="0" aria-label="${esc(caption)}"><table><caption>${esc(caption)} — USD per year</caption><thead><tr><th scope="col">Platform / plan</th><th scope="col">Subscription</th><th scope="col">Platform fee</th><th scope="col">Processing</th><th scope="col">Gateway surcharge</th><th scope="col">Total / yr</th><th scope="col">Effective take</th><th scope="col">Confidence / last verified</th></tr></thead><tbody>${rows.map(({ plan: p, cost: c }) => `<tr><th scope="row">${esc(label(p))}<small class="block">Eligible</small><small class="block">${source(p)}</small>${c.flags.map(f => `<small class="warning block">${esc(f)}</small>`).join('')}</th><td>${money(c.subscription)}</td><td>${money(c.platform_fee)}<small class="block">${number(p.platform_fee_pct)}% of revenue</small></td><td>${money(c.processing)}</td><td>${money(c.gateway_surcharge)}</td><td class="total">${money(c.total)}</td><td>${number(c.effective_take_pct)}%</td><td>${evidence(p)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    function updateURL(R, S, billing, mode) {
      const url = new URL(window.location.href);
      for (const [key, value] of Object.entries({ revenue: R, sale: S, billing, mode })) url.searchParams.set(key, value);
      $('share-url').value = url.href;
      // Some browsers forbid history changes for file://. The copyable URL still works.
      try { window.history.replaceState(null, '', url.href); } catch (_) { /* local-file history restriction */ }
      $('share-status').textContent = '';
    }
    function render() {
      const R = Number($('revenue').value), S = Number($('sale').value);
      if (!$('calculator-form').checkValidity() || !Number.isFinite(R) || !Number.isFinite(S)) {
        $('input-error').textContent = 'Enter revenue from $1,000 to $1,000,000 and an average sale price of at least $0.01.';
        $('results-section').setAttribute('aria-busy', 'true');
        $('result-summary').textContent = 'Results paused: correct the inputs to update the estimates.';
        return;
      }
      $('input-error').textContent = '';
      $('results-section').setAttribute('aria-busy', 'false');
      const billing = $('billing').value, mode = $('mode').value;
      $('revenue-slider').value = R;
      $('revenue-slider').setAttribute('aria-valuetext', `${money(R)} annual revenue`);
      $('sales-count').textContent = `${number(R / S)} modeled sales per year (revenue ÷ average sale).`;
      $('processor-help').textContent = mode === 'own'
        ? `Assumed processing: ${number(site.own_pct ?? 2.9)}% + ${money((site.own_fixed_cents ?? 30) / 100)} per sale. Unknown gateway surcharges are excluded.`
        : 'Uses the listed native or required integrated rate. Some platforms require Stripe / PayPal; see each plan’s notes.';
      updateURL(R, S, billing, mode);
      const rows = fees.map(plan => ({ plan, cost: quote(plan, R, S, billing, mode, site) }));
      const included = rows.filter(r => !r.cost.excluded);
      const groups = new Map();
      included.forEach(row => {
        if (!groups.has(row.plan.platform)) groups.set(row.plan.platform, []);
        groups.get(row.plan.platform).push(row);
      });
      const cheapest = [...groups.values()].map(group => [...group].sort((a, b) => a.cost.total - b.cost.total)[0]).sort((a, b) => a.cost.total - b.cost.total);
      $('result-summary').textContent = fees.length ? `${cheapest.length} platforms ranked by their cheapest plan · ${included.length} plans priced · ${rows.length - included.length} excluded. Baseline card processing: ${money(R * 0.029 + R / S * 0.30)} / year.` : 'Fee data is not available yet. Reload once assets/fees-data.js has been generated.';
      $('ranked-results').innerHTML = table(cheapest, 'Cheapest plan per platform, ranked by total');
      $('all-plans').innerHTML = [...groups.entries()].map(([platform, group]) => table([...group].sort((a, b) => a.cost.total - b.cost.total), `All priced ${names[platform] || platform} plans`) + group.map(({ plan }) => `<details class="plan-notes"><summary>${esc(label(plan))}: vendor notes</summary><p>${esc(plan.notes || 'No additional notes.')}</p>${plan.secondary_fields?.length ? `<p>Secondary-source fields: ${esc(plan.secondary_fields.join(', '))}</p>` : ''}</details>`).join('')).join('') || '<p>No priced plans.</p>';
      const excluded = rows.filter(r => r.cost.excluded);
      $('excluded-plans').innerHTML = excluded.length ? `<ul class="excluded">${excluded.map(({ plan, cost }) => `<li><strong>${esc(label(plan))}</strong> — ${cost.reasons.map(esc).join('; ')}.<small class="block">Eligible; excluded from cost ranking.</small>${evidence(plan)}<p>${source(plan)}</p><details><summary>Vendor notes</summary><p>${esc(plan.notes || 'No additional notes.')}</p></details></li>`).join('')}</ul>` : '<p>No plans excluded.</p>';
      $('break-even').innerHTML = cheapest.map(current => {
        const group = groups.get(current.plan.platform);
        const next = group.filter(r => r.cost.subscription > current.cost.subscription).sort((a, b) => a.cost.subscription - b.cost.subscription)[0];
        let message;
        if (!next) message = 'No higher-priced plan with complete costs is available in this comparison.';
        else {
          const currentRate = (current.cost.total - current.cost.subscription) / R;
          const nextRate = (next.cost.total - next.cost.subscription) / R;
          const savingRate = currentRate - nextRate;
          const threshold = (next.cost.subscription - current.cost.subscription) / savingRate;
          message = savingRate > 0 && Number.isFinite(threshold)
            ? `${esc(next.plan.plan)} beats ${esc(current.plan.plan)} above ${money(threshold)} annual revenue${threshold > 1000000 ? ' (beyond the slider range)' : ''}.`
            : `${esc(next.plan.plan)} has no fee-based break-even against ${esc(current.plan.plan)} with these inputs.`;
        }
        return `<p><strong>${esc(names[current.plan.platform] || current.plan.platform)}:</strong> ${message}</p>`;
      }).join('') || '<p>No break-even can be computed without priced plans.</p>';
    }
    $('calculator-form').addEventListener('submit', event => event.preventDefault());
    ['revenue', 'sale', 'billing', 'mode'].forEach(id => $(id).addEventListener('input', render));
    $('revenue-slider').addEventListener('input', () => { $('revenue').value = $('revenue-slider').value; render(); });
    document.querySelectorAll('[data-revenue]').forEach(button => button.addEventListener('click', () => { $('revenue').value = button.dataset.revenue; render(); }));
    $('share').addEventListener('click', async () => {
      if (!$('calculator-form').reportValidity()) return;
      try {
        await navigator.clipboard.writeText($('share-url').value);
        $('share-status').textContent = 'Link copied.';
      } catch (_) {
        $('share-url').focus(); $('share-url').select();
        $('share-status').textContent = 'Copy the selected link. Clipboard access may be unavailable for local files.';
      }
    });
    render();
  });
}
