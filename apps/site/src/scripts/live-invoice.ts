// Recalculates the sample invoice with OSuite's own GST code whenever a
// control marked data-live="buyer|rate|discount|qty|price" changes.
import { amountInWords, computeGst } from '@osuite/kernel';

const sheet = document.querySelector<HTMLElement>('[data-live-invoice]');
const raw = document.getElementById('live-invoice-sample')?.textContent;

if (sheet && raw) {
  const sample = JSON.parse(raw) as {
    seller: { state: string };
    buyers: Record<string, { name: string; place: string; state: string }>;
    item: { uom: string };
    start: { buyer: string; qty: string; rate: string; gstRate: string; discount: string };
  };
  const state = { ...sample.start };
  const out = (k: string) => sheet.querySelector<HTMLElement>(`[data-out="${k}"]`)!;
  const fmt = (v: string | number) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const render = () => {
    const intra = state.buyer === sample.seller.state;
    const qty = Math.max(0, Number(state.qty) || 0);
    const rate = Math.max(0, Number(state.rate) || 0);
    const r = computeGst([{ qty, unitPrice: rate, discountPct: state.discount, gstRate: state.gstRate }], { intraState: intra });
    const b = sample.buyers[state.buyer]!;
    out('buyer').textContent = b.name;
    out('buyer-place').textContent = `${b.place}, ${b.state}`;
    out('pos').textContent = `${b.state} (${state.buyer})`;
    out('qty').textContent = `${qty.toLocaleString('en-IN')} ${sample.item.uom}`;
    out('rate').textContent = fmt(rate);
    out('taxable').textContent = fmt(r.lines[0]!.taxable);
    out('disc-note').hidden = Number(state.discount) === 0;
    out('disc-note').textContent = ` less ${state.discount}%`;
    out('t-taxable').textContent = fmt(r.taxable);
    out('row-cgst').hidden = !intra;
    out('row-sgst').hidden = !intra;
    out('row-igst').hidden = intra;
    out('half-rate').textContent = String(Number(state.gstRate) / 2);
    out('half-rate2').textContent = String(Number(state.gstRate) / 2);
    out('full-rate').textContent = state.gstRate;
    out('cgst').textContent = fmt(r.cgst);
    out('sgst').textContent = fmt(r.sgst);
    out('igst').textContent = fmt(r.igst);
    out('row-round').hidden = Number(r.roundOff) === 0;
    out('round').textContent = fmt(r.roundOff);
    out('total').textContent = fmt(r.total);
    out('words').textContent = amountInWords(r.total);
  };

  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-live]').forEach((el) => {
    const key = el.dataset.live as keyof typeof state;
    const update = () => {
      if (el instanceof HTMLInputElement && el.type === 'radio' && !el.checked) return;
      state[key] = el.value;
      const echo = document.querySelector(`[data-echo="${key}"]`);
      if (echo) echo.textContent = el.value;
      render();
    };
    el.addEventListener('input', update);
    el.addEventListener('change', update);
  });
}
