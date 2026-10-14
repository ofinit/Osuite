import { amountInWords, IN_STATES, type GstResult } from '@osuite/kernel';
import { formatDecimal } from '../lib/format.ts';

const stateName = (code: unknown) => IN_STATES.find(([c]) => c === code)?.[1];

/** Live totals for a GST document; mirrors what the server stores on save. */
export function GstSummary({ result, intraState, placeOfSupply }: { result: GstResult; intraState: boolean; placeOfSupply: unknown }) {
  const rows: [string, string][] = [['Taxable value', result.taxable]];
  if (intraState) rows.push(['CGST', result.cgst], ['SGST', result.sgst]);
  else rows.push(['IGST', result.igst]);
  if (Number(result.roundOff) !== 0) rows.push(['Round off', result.roundOff]);

  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-md text-[13px] text-ink-2">
        <p>
          {intraState ? 'Intra-state supply: CGST + SGST' : 'Inter-state supply: IGST'}
          {stateName(placeOfSupply) && <>, place of supply {stateName(placeOfSupply)}</>}
        </p>
        <p className="mt-1 text-ink-3">{amountInWords(result.total)}</p>
      </div>
      <dl className="w-full max-w-xs text-[14px] sm:w-72">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between py-1">
            <dt className="text-ink-2">{k}</dt>
            <dd className="tabular-nums">{formatDecimal(v)}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t border-ink pt-2 text-[17px] font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">₹{formatDecimal(result.total)}</dd>
        </div>
      </dl>
    </div>
  );
}
