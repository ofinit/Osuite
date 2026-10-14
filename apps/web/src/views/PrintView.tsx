import { amountInWords, companyAddressLines, computeGst, IN_STATES, upiPayLink, type RecordData } from '@osuite/kernel';
import { BrandMark } from '@osuite/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type Company } from '../lib/api.ts';
import { formatDate, formatDecimal } from '../lib/format.ts';
import { useSession } from '../lib/session.ts';

type Line = Record<string, unknown>;
const stateName = (code: unknown) => IN_STATES.find(([c]) => c === code)?.[1] ?? '';
const money = (v: unknown) => formatDecimal(String(v ?? 0));

export function PrintView() {
  const { model = '', id = '' } = useParams();
  const { company } = useSession();
  const { data: doc, error } = useQuery({ queryKey: ['record', model, Number(id)], queryFn: () => api.read(model, Number(id)) });
  const customerId = (doc?.customerId as { id: number } | null)?.id;
  const { data: customer } = useQuery({
    queryKey: ['record', 'base.contact', customerId],
    queryFn: () => api.read('base.contact', customerId!),
    enabled: !!customerId,
  });

  useEffect(() => {
    if (doc?.number) document.title = `${String(doc.number).replaceAll('/', '-')} ${String((doc.customerId as { display: string }).display)}`;
  }, [doc]);

  if (error) return <p className="p-8 text-crimson">{error.message}</p>;
  if (model !== 'sales.invoice' && model !== 'sales.credit_note') return <p className="p-8">This document has no print layout.</p>;
  if (!doc || !customer) return null;

  return (
    <div className="min-h-full bg-paper print:bg-white">
      <div className="flex items-center gap-2 border-b border-rule bg-sheet px-4 py-2 print:hidden">
        <Link to={`/m/${model}?id=${doc.id}`} className="btn-quiet">
          <ArrowLeft size={16} /> Back
        </Link>
        <span className="flex-1" />
        <button className="btn-primary" onClick={() => window.print()}>
          <Printer size={15} /> Print or save as PDF
        </button>
      </div>
      <div className="mx-auto my-6 w-[210mm] max-w-full bg-white p-[12mm] text-[12px] leading-snug text-black shadow-sm print:m-0 print:w-auto print:p-0 print:shadow-none">
        <TaxInvoice doc={doc} customer={customer} company={company} isCreditNote={model === 'sales.credit_note'} />
      </div>
      <style>{'@page { size: A4; margin: 12mm; } @media print { html, body { background: #fff !important; } }'}</style>
    </div>
  );
}

function TaxInvoice({ doc, customer, company, isCreditNote }: { doc: RecordData; customer: RecordData; company: Company | null; isCreditNote: boolean }) {
  const lines = (doc.lines as Line[]) ?? [];
  const intraState = Number(doc.igstAmount) === 0 && (Number(doc.cgstAmount) > 0 || company?.stateCode === doc.placeOfSupply);
  const calc = computeGst(
    lines.map((l) => ({ qty: l.qty as string, unitPrice: l.unitPrice as string, discountPct: l.discountPct as string, gstRate: l.gstRate as string })),
    { intraState },
  );

  // HSN/SAC-wise tax summary.
  const groups = new Map<string, { hsn: string; rate: string; taxable: number; cgst: number; sgst: number; igst: number }>();
  lines.forEach((l, i) => {
    const r = calc.lines[i]!;
    const key = `${String(l.hsnCode ?? '')}|${String(l.gstRate)}`;
    const g = groups.get(key) ?? { hsn: String(l.hsnCode ?? '—'), rate: String(l.gstRate), taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    g.taxable += Number(r.taxable);
    g.cgst += Number(r.cgst);
    g.sgst += Number(r.sgst);
    g.igst += Number(r.igst);
    groups.set(key, g);
  });

  const state = String(doc.state);
  const kind = isCreditNote ? 'credit note' : 'tax invoice';
  const banner = state === 'draft' ? `Draft: not a valid ${kind}` : state === 'cancelled' ? 'Cancelled' : null;
  const address = [customer.street, customer.street2, [customer.city, customer.pincode].filter(Boolean).join(' '), stateName(customer.stateCode)]
    .filter((p) => p)
    .map(String);

  const th = 'border border-black/70 px-1.5 py-1 text-left font-semibold';
  const td = 'border border-black/70 px-1.5 py-1 align-top';
  const num = 'text-right tabular-nums';

  return (
    <article>
      {banner && <p className="mb-3 border-2 border-black py-1 text-center text-[13px] font-bold">{banner}</p>}
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div className="flex items-start gap-4">
          {company?.logo && <img src={company.logo} alt="" className="max-h-16 max-w-32 object-contain" />}
          <div>
            <p className="text-[18px] font-bold">{company?.name}</p>
            {companyAddressLines(company ?? {}, stateName).map((l) => (
              <p key={l}>{l}</p>
            ))}
            {(company?.phone || company?.email) && <p>{[company.phone, company.email].filter(Boolean).join(', ')}</p>}
            {company?.gstin && (
              <p>
                GSTIN: <span className="font-semibold">{company.gstin}</span>
                {company.stateCode && (
                  <>
                    , State: {stateName(company.stateCode)} ({company.stateCode})
                  </>
                )}
              </p>
            )}
            {company?.pan && <p>PAN: {company.pan}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[18px] font-bold tracking-wide">{isCreditNote ? 'Credit Note' : 'Tax Invoice'}</p>
          <p className="text-[11px]">Original for recipient</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-6 border-b border-black py-3">
        <div>
          <p className="font-semibold">Bill to</p>
          <p className="text-[13px] font-semibold">{String(customer.name)}</p>
          {address.map((a) => (
            <p key={a}>{a}</p>
          ))}
          <p>GSTIN: {doc.customerGstin ? String(doc.customerGstin) : 'Unregistered'}</p>
          {!!customer.phone && <p>Phone: {String(customer.phone)}</p>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-0.5">
          <dt>{isCreditNote ? 'Credit note no.' : 'Invoice no.'}</dt>
          <dd className="font-semibold">{doc.number ? String(doc.number) : '—'}</dd>
          {isCreditNote && (
            <>
              <dt>Against invoice</dt>
              <dd>{(doc.invoiceId as { display: string } | null)?.display}</dd>
            </>
          )}
          <dt>{isCreditNote ? 'Date' : 'Invoice date'}</dt>
          <dd>{formatDate(String(doc.date))}</dd>
          {!!doc.dueDate && (
            <>
              <dt>Due date</dt>
              <dd>{formatDate(String(doc.dueDate))}</dd>
            </>
          )}
          <dt>Place of supply</dt>
          <dd>
            {stateName(doc.placeOfSupply)} ({String(doc.placeOfSupply)})
          </dd>
          {!!doc.reference && (
            <>
              <dt>Reference</dt>
              <dd>{String(doc.reference)}</dd>
            </>
          )}
          <dt>Reverse charge</dt>
          <dd>No</dd>
        </dl>
      </section>

      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>#</th>
            <th className={th}>Description</th>
            <th className={th}>HSN/SAC</th>
            <th className={`${th} ${num}`}>Qty</th>
            <th className={`${th} ${num}`}>Rate</th>
            <th className={`${th} ${num}`}>Disc %</th>
            <th className={`${th} ${num}`}>Taxable value</th>
            <th className={`${th} ${num}`}>GST %</th>
            <th className={`${th} ${num}`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={String(l.id)}>
              <td className={td}>{i + 1}</td>
              <td className={td}>{String(l.description)}</td>
              <td className={td}>{String(l.hsnCode ?? '')}</td>
              <td className={`${td} ${num}`}>
                {Number(l.qty).toLocaleString('en-IN', { maximumFractionDigits: 3 })} {String(l.uom)}
              </td>
              <td className={`${td} ${num}`}>{money(l.unitPrice)}</td>
              <td className={`${td} ${num}`}>{Number(l.discountPct) ? Number(l.discountPct) : ''}</td>
              <td className={`${td} ${num}`}>{money(l.taxableAmount)}</td>
              <td className={`${td} ${num}`}>{String(l.gstRate)}</td>
              <td className={`${td} ${num}`}>{money(l.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-3 flex items-start justify-between gap-6">
        <table className="border-collapse text-[11px]">
          <thead>
            <tr>
              <th className={th}>HSN/SAC</th>
              <th className={`${th} ${num}`}>Taxable value</th>
              {intraState ? (
                <>
                  <th className={`${th} ${num}`}>CGST</th>
                  <th className={`${th} ${num}`}>SGST</th>
                </>
              ) : (
                <th className={`${th} ${num}`}>IGST</th>
              )}
            </tr>
          </thead>
          <tbody>
            {[...groups.values()].map((g) => (
              <tr key={`${g.hsn}|${g.rate}`}>
                <td className={td}>
                  {g.hsn} @ {g.rate}%
                </td>
                <td className={`${td} ${num}`}>{money(g.taxable.toFixed(2))}</td>
                {intraState ? (
                  <>
                    <td className={`${td} ${num}`}>{money(g.cgst.toFixed(2))}</td>
                    <td className={`${td} ${num}`}>{money(g.sgst.toFixed(2))}</td>
                  </>
                ) : (
                  <td className={`${td} ${num}`}>{money(g.igst.toFixed(2))}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="w-64 shrink-0">
          {(
            [
              ['Taxable value', doc.taxableAmount],
              ...(intraState
                ? [
                    ['CGST', doc.cgstAmount],
                    ['SGST', doc.sgstAmount],
                  ]
                : [['IGST', doc.igstAmount]]),
              ...(Number(doc.roundOff) ? [['Round off', doc.roundOff]] : []),
            ] as [string, unknown][]
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between py-0.5">
              <dt>{k}</dt>
              <dd className="tabular-nums">{money(v)}</dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t-2 border-black pt-1 text-[14px] font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">₹{money(doc.totalAmount)}</dd>
          </div>
          {Number(doc.amountPaid) > 0 && (
            <>
              <div className="flex justify-between py-0.5">
                <dt>Paid</dt>
                <dd className="tabular-nums">{money(doc.amountPaid)}</dd>
              </div>
              <div className="flex justify-between py-0.5 font-semibold">
                <dt>Balance due</dt>
                <dd className="tabular-nums">₹{money(doc.amountDue)}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      <p className="mt-3 border-y border-black py-1.5">
        <span className="font-semibold">Amount in words: </span>
        {amountInWords(String(doc.totalAmount))}
      </p>

      {!!doc.notes && <p className="mt-3 whitespace-pre-line">{String(doc.notes)}</p>}

      {!isCreditNote && <PaymentDetails company={company} doc={doc} />}

      {company?.invoiceTerms && (
        <section className="mt-3">
          <p className="font-semibold">Terms</p>
          <p className="whitespace-pre-line">{company.invoiceTerms}</p>
        </section>
      )}

      <footer className="mt-10 flex items-end justify-between">
        <p className="flex items-center gap-1.5 text-[10px] text-black/60">
          <BrandMark className="scale-75" /> Computer-generated {isCreditNote ? 'credit note' : 'invoice'}
        </p>
        <div className="text-right">
          <p>For {company?.name}</p>
          <p className="mt-12 border-t border-black pt-1">Authorised signatory</p>
        </div>
      </footer>
    </article>
  );
}

/** Bank details and, for posted invoices, a UPI QR code for the exact amount. */
function PaymentDetails({ company, doc }: { company: Company | null; doc: RecordData }) {
  const [qr, setQr] = useState<string | null>(null);
  const payable = doc.state === 'posted' && company?.upiId && Number(doc.totalAmount) > 0;
  useEffect(() => {
    if (!payable) return;
    const link = upiPayLink({ upiId: company.upiId!, payee: company.name, amount: String(doc.totalAmount), note: `Invoice ${String(doc.number)}` });
    let live = true;
    void QRCode.toString(link, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then((svg) => {
      if (live) setQr(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
    });
    return () => {
      live = false;
    };
  }, [payable, company, doc]);

  const bank = company?.bankAccountNumber
    ? [
        ['Account name', company.bankAccountName ?? company.name],
        ['Account no.', company.bankAccountNumber],
        ['IFSC', company.bankIfsc],
        ['Bank', [company.bankName, company.bankBranch].filter(Boolean).join(', ')],
      ].filter(([, v]) => v)
    : [];
  if (!bank.length && !payable) return null;

  return (
    <section className="mt-3 flex items-start justify-between gap-6 border-b border-black pb-3">
      {bank.length > 0 && (
        <div>
          <p className="font-semibold">Bank details</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3">
            {bank.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {payable && qr && (
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="font-semibold">Scan to pay with UPI</p>
            <p>{company.upiId}</p>
            <p className="font-semibold">₹{money(doc.totalAmount)}</p>
          </div>
          <img src={qr} alt={`UPI QR code to pay ${company.upiId}`} className="size-24" />
        </div>
      )}
    </section>
  );
}
