// The home dashboard: the few numbers an owner checks every morning.
import { financialYear, localToday, money } from '@osuite/kernel';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { gstr3b, profitAndLoss } from './reports.ts';
import { ageing } from './service.ts';

const rowsOf = <T>(r: unknown) => (r as { rows: T[] }).rows;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** First day of the month `offset` months from the month of `date`. */
function monthStart(date: string, offset = 0) {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return iso(d);
}

/** Net taxable value of posted sales (invoices less credit notes) or purchases (bills less debit notes). */
async function netTaxable(tx: Tx, side: 'sales' | 'purchase', from: string, to: string): Promise<string> {
  const [doc, note] = side === 'sales' ? ['sales_invoice', 'sales_credit_note'] : ['purchase_bill', 'purchase_debit_note'];
  const [r] = rowsOf<{ v: string }>(
    await tx.execute(sql`
      select (coalesce((select sum(taxable_amount) from ${sql.identifier(doc)} where state = 'posted' and date between ${from} and ${to}), 0)
            - coalesce((select sum(taxable_amount) from ${sql.identifier(note)} where state = 'posted' and date between ${from} and ${to}), 0))::text as v`),
  );
  return money.add(r!.v);
}

export async function dashboard(tx: Tx, today = localToday()) {
  const fy = financialYear(today);
  const fyFrom = `${Number(today.slice(5, 7)) >= 4 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-04-01`;
  const thisMonth = monthStart(today);
  const lastMonthFrom = monthStart(today, -1);
  const lastMonthTo = iso(new Date(Date.parse(`${thisMonth}T00:00:00Z`) - 86_400_000));
  // Same number of days into last month, for a fair comparison.
  const day = Number(today.slice(8, 10));
  const lastMonthSameDay = [lastMonthTo, `${lastMonthFrom.slice(0, 8)}${String(day).padStart(2, '0')}`].sort()[0]!;

  const [salesToday, salesMonth, salesLastMonth, salesFy, purchasesMonth] = await Promise.all([
    netTaxable(tx, 'sales', today, today),
    netTaxable(tx, 'sales', thisMonth, today),
    netTaxable(tx, 'sales', lastMonthFrom, lastMonthSameDay),
    netTaxable(tx, 'sales', fyFrom, today),
    netTaxable(tx, 'purchase', thisMonth, today),
  ]);

  // Twelve months of sales and purchases, oldest first.
  const trendFrom = monthStart(today, -11);
  const trendRows = rowsOf<{ month: string; sales: string; purchases: string }>(
    await tx.execute(sql`
      with months as (select to_char(m, 'YYYY-MM') as month from generate_series(${trendFrom}::date, ${thisMonth}::date, interval '1 month') m),
      s as (
        select to_char(date, 'YYYY-MM') as month, sum(taxable_amount) as v from sales_invoice where state = 'posted' and date >= ${trendFrom} group by 1
        union all
        select to_char(date, 'YYYY-MM'), -sum(taxable_amount) from sales_credit_note where state = 'posted' and date >= ${trendFrom} group by 1),
      p as (
        select to_char(date, 'YYYY-MM') as month, sum(taxable_amount) as v from purchase_bill where state = 'posted' and date >= ${trendFrom} group by 1
        union all
        select to_char(date, 'YYYY-MM'), -sum(taxable_amount) from purchase_debit_note where state = 'posted' and date >= ${trendFrom} group by 1)
      select months.month,
             coalesce((select sum(v) from s where s.month = months.month), 0)::text as sales,
             coalesce((select sum(v) from p where p.month = months.month), 0)::text as purchases
        from months order by months.month`),
  );
  const trend = trendRows.map((r) => ({ month: r.month, sales: money.add(r.sales), purchases: money.add(r.purchases) }));

  // Money in hand: cash and every bank's ledger account.
  const cash = rowsOf<{ id: string; name: string; balance: string }>(
    await tx.execute(sql`
      select a.id, a.name, coalesce(sum(l.debit - l.credit), 0)::text as balance
        from account_account a left join account_entry_line l on l.account_id = a.id and l.date <= ${today}
       where a.key in ('cash', 'bank') or a.id in (select ledger_account_id from account_bank_account where active)
       group by a.id, a.name, a.code order by a.code`),
  ).map((r) => ({ accountId: Number(r.id), name: r.name, balance: money.add(r.balance) }));

  const [receivable, payable] = await Promise.all([ageing(tx, 'inbound', today), ageing(tx, 'outbound', today)]);
  const overdue = (a: Awaited<ReturnType<typeof ageing>>) => money.sub(a.totals.total!, a.totals.notDue!);
  const overdueInvoices = receivable.rows
    .flatMap((r) => r.items.filter((i) => i.daysOverdue > 0).map((i) => ({ id: i.id, number: i.number, partner: r.partner, amountDue: i.amountDue, daysOverdue: i.daysOverdue })))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 5);

  const gst = await gstr3b(tx, today.slice(0, 7));
  const output = money.add(gst.outward.taxable.igst, gst.outward.taxable.cgst, gst.outward.taxable.sgst);
  const input = money.add(gst.itc.igst, gst.itc.cgst, gst.itc.sgst);

  const pl = await profitAndLoss(tx, fyFrom, today);

  const topCustomers = rowsOf<{ id: string; name: string; v: string }>(
    await tx.execute(sql`
      select c.id, c.name, sum(x.v)::text as v from (
        select customer_id as cid, taxable_amount as v from sales_invoice where state = 'posted' and date between ${fyFrom} and ${today}
        union all
        select customer_id, -taxable_amount from sales_credit_note where state = 'posted' and date between ${fyFrom} and ${today}
      ) x join contact c on c.id = x.cid
      group by c.id, c.name having sum(x.v) > 0 order by sum(x.v) desc limit 5`),
  ).map((r) => ({ partnerId: Number(r.id), name: r.name, sales: money.add(r.v) }));

  const lowStock = rowsOf<{ id: string; name: string; uom: string; on_hand: string; reorder_level: string }>(
    await tx.execute(sql`
      select p.id, p.name, p.uom, coalesce(sum(q.qty), 0)::text as on_hand, p.reorder_level::text
        from product p left join stock_quant q on q.product_id = p.id
       where p.active and p.kind = 'goods'
       group by p.id
      having coalesce(sum(q.qty), 0) < 0 or (p.reorder_level > 0 and coalesce(sum(q.qty), 0) <= p.reorder_level)
       order by coalesce(sum(q.qty), 0) - p.reorder_level, p.name limit 8`),
  ).map((r) => ({ productId: Number(r.id), name: r.name, uom: r.uom, onHand: r.on_hand, reorderLevel: r.reorder_level }));

  const drafts = rowsOf<{ model: string; n: string }>(
    await tx.execute(sql`
      select 'sales.invoice' as model, count(*) as n from sales_invoice where state = 'draft' and active
      union all select 'sales.credit_note', count(*) from sales_credit_note where state = 'draft' and active
      union all select 'purchase.bill', count(*) from purchase_bill where state = 'draft' and active
      union all select 'purchase.debit_note', count(*) from purchase_debit_note where state = 'draft' and active
      union all select 'account.payment', count(*) from account_payment where state = 'draft' and active
      union all select 'account.manual', count(*) from account_manual where state = 'draft' and active
      union all select 'stock.adjustment', count(*) from stock_adjustment where state = 'draft' and active`),
  )
    .map((r) => ({ model: r.model, count: Number(r.n) }))
    .filter((d) => d.count > 0);

  return {
    asOf: today,
    fy,
    sales: { today: salesToday, month: salesMonth, lastMonthToDate: salesLastMonth, fy: salesFy },
    purchasesMonth,
    profitFy: pl.netProfit,
    cash: { accounts: cash, total: money.add(...cash.map((c) => c.balance)) },
    receivable: { total: receivable.totals.total!, overdue: overdue(receivable), advance: receivable.totals.advance!, overdueInvoices },
    payable: { total: payable.totals.total!, overdue: overdue(payable), advance: payable.totals.advance! },
    gst: { month: gst.month, output, input, net: money.sub(output, input) },
    trend,
    topCustomers,
    lowStock,
    drafts,
  };
}
