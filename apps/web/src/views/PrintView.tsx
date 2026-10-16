import { amountInWords, companyAddressLines, computeGst, IN_STATES, upiPayLink, type RecordData } from '@osuite/kernel';
import { BrandMark } from '@osuite/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { api, type Company } from '../lib/api.ts';
import { formatDate, formatDecimal } from '../lib/format.ts';
import { useSession } from '../lib/session.ts';

type Line = Record<string, unknown>;
type Variant = 'invoice' | 'credit_note' | 'quotation' | 'proforma' | 'order' | 'challan' | 'purchase_order';

const VARIANT: Record<Variant, { title: string; noun: string; numberLabel: string; dateLabel: string }> = {
  invoice: { title: 'Tax Invoice', noun: 'tax invoice', numberLabel: 'Invoice no.', dateLabel: 'Invoice date' },
  credit_note: { title: 'Credit Note', noun: 'credit note', numberLabel: 'Credit note no.', dateLabel: 'Date' },
  quotation: { title: 'Quotation', noun: 'quotation', numberLabel: 'Quotation no.', dateLabel: 'Date' },
  proforma: { title: 'Proforma Invoice', noun: 'proforma invoice', numberLabel: 'Proforma no.', dateLabel: 'Date' },
  order: { title: 'Sales Order', noun: 'sales order', numberLabel: 'Order no.', dateLabel: 'Order date' },
  challan: { title: 'Delivery Challan', noun: 'delivery challan', numberLabel: 'Challan no.', dateLabel: 'Challan date' },
  purchase_order: { title: 'Purchase Order', noun: 'purchase order', numberLabel: 'PO no.', dateLabel: 'Order date' },
};
const VARIANT_OF: Record<string, Variant> = {
  'sales.invoice': 'invoice',
  'sales.credit_note': 'credit_note',
  'sales.quotation': 'quotation',
  'sales.order': 'order',
  'sales.delivery': 'challan',
  'purchase.order': 'purchase_order',
};
const PURPOSE: Record<string, string> = { supply: 'Supply', approval: 'Sent on approval', job_work: 'Job work', other: 'Other' };
const stateName = (code: unknown) => IN_STATES.find(([c]) => c === code)?.[1] ?? '';
const money = (v: unknown) => formatDecimal(String(v ?? 0));

export function PrintView() {
  const { model = '', id = '' } = useParams();
  const [params] = useSearchParams();
  const { company } = useSession();
  const variant: Variant | null = model === 'sales.quotation' && params.get('as') === 'proforma' ? 'proforma' : (VARIANT_OF[model] ?? null);
  const { data: doc, error } = useQuery({ queryKey: ['record', model, Number(id)], queryFn: () => api.read(model, Number(id)) });
  // The other party: the customer, or the vendor on a purchase order.
  const customerId = ((doc?.customerId ?? doc?.vendorId) as { id: number } | null | undefined)?.id;
  const { data: customer } = useQuery({
    queryKey: ['record', 'base.contact', customerId],
    queryFn: () => api.read('base.contact', customerId!),
    enabled: !!customerId,
  });

  useEffect(() => {
    const party = (doc?.customerId ?? doc?.vendorId) as { display: string } | undefined;
    if (doc?.number && party) document.title = `${String(doc.number).replaceAll('/', '-')} ${party.display}`;
  }, [doc]);

  if (error) return <p className="p-8 text-crimson">{error.message}</p>;
  if (!variant) return <p className="p-8">This document has no print layout.</p>;
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
        <TaxInvoice doc={doc} customer={customer} company={company} variant={variant} />
      </div>
      <style>{'@page { size: A4; margin: 12mm; } @media print { html, body { background: #fff !important; } }'}</style>
    </div>
  );
}

function TaxInvoice({ doc, customer, company, variant }: { doc: RecordData; customer: RecordData; company: Company | null; variant: Variant }) {
  const v = VARIANT[variant];
  const isCreditNote = variant === 'credit_note';
  const isQuote = variant === 'quotation' || variant === 'proforma';
  const isChallan = variant === 'challan';
  // Only invoices and credit notes are GST tax documents; the rest are not.
  const taxDoc = variant === 'invoice' || isCreditNote;
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
  const banner =
    doc.irnStatus === 'cancelled'
      ? 'E-invoice cancelled'
      : state === 'draft'
      ? isQuote || variant === 'order' || variant === 'purchase_order'
        ? `Draft ${v.noun}`
        : `Draft: not a valid ${v.noun}`
      : state === 'cancelled'
        ? 'Cancelled'
        : state === 'declined'
          ? 'Declined'
          : null;
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
          <p className="text-[18px] font-bold tracking-wide">{v.title}</p>
          <p className="text-[11px]">{isChallan ? 'Original for consignee' : taxDoc ? 'Original for recipient' : 'This is not a tax invoice'}</p>
        </div>
      </header>

      {!!doc.irn && <IrnBlock doc={doc} />}

      <section className="grid grid-cols-2 gap-6 border-b border-black py-3">
        <div>
          <p className="font-semibold">{isChallan ? 'Deliver to' : variant === 'purchase_order' ? 'Vendor' : 'Bill to'}</p>
          <p className="text-[13px] font-semibold">{String(customer.name)}</p>
          {address.map((a) => (
            <p key={a}>{a}</p>
          ))}
          <p>GSTIN: {doc.customerGstin || doc.vendorGstin ? String(doc.customerGstin ?? doc.vendorGstin) : 'Unregistered'}</p>
          {!!customer.phone && <p>Phone: {String(customer.phone)}</p>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-0.5">
          <dt>{v.numberLabel}</dt>
          <dd className="font-semibold">{doc.number ? String(doc.number) : '—'}</dd>
          {isCreditNote && (
            <>
              <dt>Against invoice</dt>
              <dd>{(doc.invoiceId as { display: string } | null)?.display}</dd>
            </>
          )}
          {!isCreditNote && !!doc.orderId && (
            <>
              <dt>Sales order</dt>
              <dd>{(doc.orderId as { display: string }).display}</dd>
            </>
          )}
          <dt>{v.dateLabel}</dt>
          <dd>{formatDate(String(doc.date))}</dd>
          {!!doc.deliverBy && (
            <>
              <dt>{variant === 'purchase_order' ? 'Expected by' : 'Deliver by'}</dt>
              <dd>{formatDate(String(doc.deliverBy))}</dd>
            </>
          )}
          {isChallan && (
            <>
              <dt>Purpose</dt>
              <dd>{PURPOSE[String(doc.purpose)] ?? String(doc.purpose)}</dd>
            </>
          )}
          {!!doc.vehicleNo && (
            <>
              <dt>Vehicle no.</dt>
              <dd>{String(doc.vehicleNo)}</dd>
            </>
          )}
          {!!doc.validUntil && (
            <>
              <dt>Valid until</dt>
              <dd>{formatDate(String(doc.validUntil))}</dd>
            </>
          )}
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
          {taxDoc && (
            <>
              <dt>Reverse charge</dt>
              <dd>No</dd>
            </>
          )}
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

      {(variant === 'invoice' || variant === 'proforma') && <PaymentDetails company={company} doc={doc} />}

      {taxDoc && company?.invoiceTerms && (
        <section className="mt-3">
          <p className="font-semibold">Terms</p>
          <p className="whitespace-pre-line">{company.invoiceTerms}</p>
        </section>
      )}

      {isChallan && (
        <section className="mt-6 grid grid-cols-2 gap-6">
          <p>Goods received in good condition.</p>
          <p className="mt-10 border-t border-black pt-1 text-right">Receiver's signature and date</p>
        </section>
      )}

      <footer className="mt-10 flex items-end justify-between">
        <p className="flex items-center gap-1.5 text-[10px] text-black/60">
          <BrandMark className="scale-75" /> Computer-generated {v.noun}
        </p>
        <div className="text-right">
          <p>For {company?.name}</p>
          <p className="mt-12 border-t border-black pt-1">Authorised signatory</p>
        </div>
      </footer>
    </article>
  );
}

/** IRN, acknowledgement and e-way bill, with the IRP-signed QR code the rules require on the invoice. */
function IrnBlock({ doc }: { doc: RecordData }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void QRCode.toString(String(doc.irnSignedQr), { type: 'svg', margin: 2, errorCorrectionLevel: 'L' }).then((svg) => {
      if (live) setQr(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
    });
    return () => {
      live = false;
    };
  }, [doc.irnSignedQr]);
  const ack = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(String(doc.irnAckDate)),
  );
  return (
    <section className="flex items-start justify-between gap-6 border-b border-black py-2">
      <dl className="grid grid-cols-[auto_1fr] content-start gap-x-3 gap-y-0.5">
        {!!doc.irnSimulated && (
          <dd className="col-span-2 mb-1 font-bold">SIMULATED E-INVOICE: not registered with the GST portal</dd>
        )}
        <dt className="font-semibold">IRN</dt>
        <dd className="font-mono text-[10.5px] break-all">{String(doc.irn)}</dd>
        <dt className="font-semibold">Ack no.</dt>
        <dd>{String(doc.irnAckNo)}</dd>
        <dt className="font-semibold">Ack date</dt>
        <dd>{ack}</dd>
        {doc.ewbStatus === 'active' && (
          <>
            <dt className="font-semibold">E-way bill</dt>
            <dd>
              {String(doc.ewbNo)}, valid until {formatDate(String(doc.ewbValidUntil))}
            </dd>
          </>
        )}
      </dl>
      {qr && <img src={qr} alt="E-invoice QR code signed by the IRP" className="size-36 shrink-0" />}
    </section>
  );
}

/** Bank details and, for posted invoices, a UPI QR code for the exact amount. */
function PaymentDetails({ company, doc }: { company: Company | null; doc: RecordData }) {
  const [qr, setQr] = useState<string | null>(null);
  // Posted invoices, and proformas the customer may pay in advance.
  const payable = (doc.state === 'posted' || doc.state === 'sent' || doc.state === 'accepted') && company?.upiId && Number(doc.totalAmount) > 0;
  useEffect(() => {
    if (!payable) return;
    const link = upiPayLink({ upiId: company.upiId!, payee: company.name, amount: String(doc.totalAmount), note: `${doc.state === 'posted' ? 'Invoice' : 'Proforma'} ${String(doc.number)}` });
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
