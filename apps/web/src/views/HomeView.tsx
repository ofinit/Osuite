import { money } from '@osuite/kernel';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, FilePlus2, HandCoins, ReceiptText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAccess } from '../lib/access.ts';
import { api, type Dashboard } from '../lib/api.ts';
import { formatDecimal } from '../lib/format.ts';
import { useMeta, useSession } from '../lib/session.ts';

const rupees = (v: string) => `₹${formatDecimal(Math.round(Number(v)), 0)}`;

/** ₹ in lakh / crore for chart labels. */
function compact(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (a >= 1e5) return `${(n / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1]!;

export function HomeView() {
  const { user, company } = useSession();
  const access = useAccess();
  const { data, error } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard, refetchInterval: 5 * 60 * 1000 });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="h-full overflow-y-auto px-5 py-7 sm:px-10">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-[24px] font-semibold tracking-tight">
            {greeting}, {user.name.split(' ')[0]}
          </h1>
          <p className="mt-0.5 text-ink-2">{company?.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {access.canChange('sales.invoice') && (
            <Link className="btn-primary" to="/m/sales.invoice?id=new">
              <FilePlus2 size={15} /> New invoice
            </Link>
          )}
          {access.canChange('account.payment') && (
            <Link className="btn-outline" to="/m/account.payment?f.direction=inbound&id=new">
              <HandCoins size={15} /> Receive payment
            </Link>
          )}
          {access.canChange('purchase.bill') && (
            <Link className="btn-outline" to="/m/purchase.bill?id=new">
              <ReceiptText size={15} /> New bill
            </Link>
          )}
        </div>
      </div>

      {error && <p className="mt-6 text-crimson">{error.message}</p>}
      {data && <Board d={data} />}

      <p className="mt-8 text-[13px] text-ink-3">
        Press <span className="kbd">Ctrl K</span> anywhere to search records or jump to a list. In a list, <span className="kbd">N</span>{' '}
        creates a record and <span className="kbd">/</span> searches.
      </p>
    </div>
  );
}

function Board({ d }: { d: Dashboard }) {
  const change = d.sales && money.cmp(d.sales.lastMonthToDate, 0) > 0 ? (Number(d.sales.month) / Number(d.sales.lastMonthToDate) - 1) * 100 : null;
  const gstCredit = !!d.gst && money.cmp(d.gst.net, 0) < 0;
  return (
    <>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Key figures">
        {d.sales && (
          <Kpi
            label="Sales this month"
            value={rupees(d.sales.month)}
            to="/m/sales.invoice"
            note={
              change === null ? (
                `Today ${rupees(d.sales.today)}`
              ) : (
                <span className={clsx('inline-flex items-center gap-0.5', change >= 0 ? 'text-ok' : 'text-crimson')}>
                  {change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                  {Math.abs(change).toFixed(0)}% vs same days last month
                </span>
              )
            }
          />
        )}
        {d.receivable && (
          <Kpi
            label="Customers owe you"
            value={rupees(d.receivable.total)}
            to="/reports/receivables"
            note={
              money.isPositive(d.receivable.overdue) ? <span className="text-crimson">{rupees(d.receivable.overdue)} overdue</span> : 'Nothing overdue'
            }
          />
        )}
        {d.payable && (
          <Kpi
            label="You owe vendors"
            value={rupees(d.payable.total)}
            to="/reports/payables"
            note={money.isPositive(d.payable.overdue) ? <span className="text-amber">{rupees(d.payable.overdue)} overdue</span> : 'Nothing overdue'}
          />
        )}
        {d.cash && (
          <Kpi
            label="Cash and bank"
            value={rupees(d.cash.total)}
            to={d.cash.accounts[0] ? `/reports/ledger?account=${d.cash.accounts[0].accountId}` : undefined}
            note={d.cash.accounts
              .filter((a) => Number(a.balance) !== 0)
              .map((a) => `${a.name} ${rupees(a.balance)}`)
              .join(' · ') || 'No money recorded yet'}
          />
        )}
        {d.gst && (
          <Kpi
            label={`GST ${gstCredit ? 'credit' : 'payable'} for ${monthLabel(d.gst.month)}`}
            value={rupees(gstCredit ? money.sub(0, d.gst.net) : d.gst.net)}
            to="/reports/gstr-3b"
            note={`Output ${rupees(d.gst.output)} less input credit ${rupees(d.gst.input)}`}
          />
        )}
        {d.profitFy !== null && (
          <Kpi
            label={`${money.cmp(d.profitFy, 0) < 0 ? 'Loss' : 'Profit'} in FY ${d.fy}`}
            value={rupees(money.cmp(d.profitFy, 0) < 0 ? money.sub(0, d.profitFy) : d.profitFy)}
            to="/reports/profit-loss"
            note={d.sales ? `On sales of ${rupees(d.sales.fy)}` : `Financial year ${d.fy}`}
            tone={money.cmp(d.profitFy, 0) < 0 ? 'bad' : undefined}
          />
        )}
      </section>

      {d.trend && (
        <section className="mt-4 rounded-[6px] border border-rule bg-sheet p-4" aria-label="Sales and purchases, last 12 months">
          <div className="mb-2 flex flex-wrap items-center gap-4">
            <h2 className="mr-auto font-semibold">Last 12 months</h2>
            {d.sales && <Legend className="bg-accent" label="Sales" />}
            {d.purchasesMonth !== null && <Legend className="bg-rule-strong" label="Purchases" />}
          </div>
          <TrendChart trend={d.trend} />
        </section>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {d.receivable && (
          <Panel title="Overdue invoices" empty="No invoice is overdue." more={{ to: '/reports/receivables', label: 'All receivables' }}>
            {d.receivable.overdueInvoices.map((i) => (
              <Row key={i.id} to={`/m/sales.invoice?id=${i.id}`} left={i.partner} sub={`${i.number} · ${i.daysOverdue} days overdue`} right={rupees(i.amountDue)} danger={i.daysOverdue > 90} />
            ))}
          </Panel>
        )}
        {d.topCustomers && (
          <Panel title={`Top customers, FY ${d.fy}`} empty="No sales this year yet.">
            {d.topCustomers.map((c) => (
              <Row key={c.partnerId} to={`/reports/ledger?partner=${c.partnerId}`} left={c.name} right={rupees(c.sales)} />
            ))}
          </Panel>
        )}
        {d.lowStock && (
          <Panel title="Running low" empty="Nothing is below its reorder level." more={{ to: '/m/stock.quant', label: 'Stock on hand' }}>
            {d.lowStock.map((p) => (
              <Row
                key={p.productId}
                to={`/m/base.product?id=${p.productId}`}
                left={p.name}
                sub={Number(p.reorderLevel) > 0 ? `Reorder at ${formatDecimal(p.reorderLevel, 0)} ${p.uom}` : 'Negative stock'}
                right={`${formatDecimal(p.onHand, Number(p.onHand) % 1 ? 2 : 0)} ${p.uom}`}
                danger={Number(p.onHand) <= 0}
              />
            ))}
          </Panel>
        )}
        <Drafts drafts={d.drafts} />
      </div>
    </>
  );
}

function Kpi({ label, value, note, to, tone }: { label: string; value: string; note: React.ReactNode; to?: string; tone?: 'bad' }) {
  const body = (
    <>
      <span className="block text-[13px] text-ink-2">{label}</span>
      <span className={clsx('mt-1 block text-[24px] font-semibold tracking-tight tabular-nums', tone === 'bad' && 'text-crimson')}>{value}</span>
      <span className="mt-1 block truncate text-[12.5px] text-ink-3">{note}</span>
    </>
  );
  const cls = 'block rounded-[6px] border border-rule bg-sheet px-4 py-3';
  return to ? (
    <Link to={to} className={clsx(cls, 'transition-colors hover:border-rule-strong')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
      <span className={clsx('size-2.5 rounded-[2px]', className)} /> {label}
    </span>
  );
}

function TrendChart({ trend }: { trend: NonNullable<Dashboard['trend']> }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the container's real width so text stays at its true size.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setW(Math.max(280, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 190;
  const top = 12;
  const bottom = 24;
  const left = 44;
  const max = Math.max(1, ...trend.flatMap((t) => [Number(t.sales), Number(t.purchases)]));
  // A round axis maximum: 1, 2 or 5 times a power of ten.
  const pow = 10 ** Math.floor(Math.log10(max));
  const axisMax = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= max)!;
  const y = (v: number) => top + (H - top - bottom) * (1 - Math.max(0, v) / axisMax);
  const slot = (W - left) / trend.length;
  const bar = Math.min(18, slot / 3);
  const shown = hover ?? trend.length - 1;
  const cur = trend[shown]!;

  return (
    <div ref={box}>
      <p className="mb-1 text-[12.5px] text-ink-2 tabular-nums">
        {monthLabel(cur.month)} {cur.month.slice(0, 4)}: sales {rupees(cur.sales)}, purchases {rupees(cur.purchases)}
      </p>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Monthly sales and purchases" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W} y1={y(axisMax * f)} y2={y(axisMax * f)} className="stroke-rule" strokeWidth={1} />
            <text x={left - 6} y={y(axisMax * f) + 4} textAnchor="end" className="fill-ink-3 text-[11px]">
              {compact(axisMax * f)}
            </text>
          </g>
        ))}
        {trend.map((t, i) => {
          const x = left + slot * i + slot / 2;
          return (
            <g key={t.month} onMouseEnter={() => setHover(i)}>
              <rect x={left + slot * i} y={top} width={slot} height={H - top - bottom} className={clsx(i === shown ? 'fill-accent-soft' : 'fill-transparent')} />
              <rect x={x - bar - 1} y={y(Number(t.sales))} width={bar} height={H - bottom - y(Number(t.sales))} rx={2} className="fill-accent" />
              <rect x={x + 1} y={y(Number(t.purchases))} width={bar} height={H - bottom - y(Number(t.purchases))} rx={2} className="fill-rule-strong" />
              <text x={x} y={H - 6} textAnchor="middle" className="fill-ink-3 text-[11px]">
                {monthLabel(t.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Panel({ title, empty, more, children }: { title: string; empty: string; more?: { to: string; label: string }; children: React.ReactNode[] }) {
  return (
    <section className="rounded-[6px] border border-rule bg-sheet p-4">
      <div className="mb-1 flex items-baseline">
        <h2 className="mr-auto font-semibold">{title}</h2>
        {more && (
          <Link to={more.to} className="text-[12.5px] text-accent underline-offset-2 hover:underline">
            {more.label}
          </Link>
        )}
      </div>
      {children.length ? <ul className="divide-y divide-rule">{children}</ul> : <p className="py-4 text-[13px] text-ink-3">{empty}</p>}
    </section>
  );
}

function Row({ to, left, sub, right, danger }: { to: string; left: string; sub?: string; right: string; danger?: boolean }) {
  return (
    <li>
      <Link to={to} className="flex items-baseline gap-3 py-2 hover:bg-paper">
        <span className="min-w-0 flex-1">
          <span className="block truncate">{left}</span>
          {sub && <span className="block text-[12.5px] text-ink-3">{sub}</span>}
        </span>
        <span className={clsx('font-medium tabular-nums', danger && 'text-crimson')}>{right}</span>
      </Link>
    </li>
  );
}

function Drafts({ drafts }: { drafts: Dashboard['drafts'] }) {
  const { data: meta } = useMeta();
  return (
    <Panel title="Drafts to finish" empty="No drafts waiting.">
      {drafts.map((d) => {
        const model = meta?.models[d.model];
        return <Row key={d.model} to={`/m/${d.model}?f.state=draft`} left={model?.labelPlural ?? d.model} right={String(d.count)} />;
      })}
    </Panel>
  );
}
