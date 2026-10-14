import {
  detectStatement,
  parseCsv,
  readStatement,
  type FieldDef,
  type Many2oneValue,
  type StatementMapping,
} from '@osuite/kernel';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, CircleCheck, Upload, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { FieldControl } from '../components/fields.tsx';
import { api, type ReconcileView as Reconcile } from '../lib/api.ts';
import { formatDate, formatDecimal } from '../lib/format.ts';
import { useSession } from '../lib/session.ts';

const th = 'border-b border-rule-strong py-2 pr-4 text-[12.5px] font-medium whitespace-nowrap text-ink-2';
const td = 'border-b border-rule py-2 pr-4 align-top';
const num = 'text-right tabular-nums whitespace-nowrap';

const ROLES: [keyof StatementMapping, string][] = [
  ['date', 'Date'],
  ['description', 'Description'],
  ['reference', 'Reference'],
  ['debit', 'Withdrawal'],
  ['credit', 'Deposit'],
  ['amount', 'Amount (signed)'],
  ['drcr', 'Dr / Cr'],
  ['balance', 'Balance'],
];

/** Import a bank statement CSV and list earlier statements. */
export function BankView() {
  const { license } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: banks } = useQuery({ queryKey: ['list', 'account.bank_account', 'bank-view'], queryFn: () => api.search('account.bank_account', { limit: 50 }) });
  const [bankId, setBankId] = useState<number | null>(null);
  const bank = bankId ?? banks?.records[0]?.id ?? null;
  const { data: statements } = useQuery({
    queryKey: ['list', 'account.statement', 'bank-view', bank],
    queryFn: () => api.search('account.statement', { limit: 50, filters: { bankAccountId: bank! } }),
    enabled: bank !== null,
  });

  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<StatementMapping | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [closing, setClosing] = useState('');
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => (file && mapping ? readStatement(file.rows, headerRow, mapping) : null), [file, mapping, headerRow]);

  const onFile = async (f: File | undefined) => {
    setError(null);
    setMapping(null);
    if (!f) return;
    const rows = parseCsv(await f.text());
    setFile({ name: f.name, rows });
    const d = detectStatement(rows);
    if (!d) {
      setError('Could not find the date and amount columns. Choose them below.');
      setHeaderRow(0);
      setMapping({ date: 0, description: 1 });
      return;
    }
    setHeaderRow(d.headerRow);
    setMapping(d.mapping);
    const last = readStatement(rows, d.headerRow, d.mapping).rows.at(-1);
    setClosing(last?.balance ?? '');
  };

  const importIt = useMutation({
    mutationFn: () => api.importStatement({ bankAccountId: bank!, rows: parsed!.rows, closingBalance: closing.trim() || null }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['list', 'account.statement'] });
      void navigate(`/bank/${r.statementId}`);
    },
    onError: (e) => setError(e.message),
  });

  const headers = file?.rows[headerRow] ?? [];

  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-10">
      <header className="mb-6 flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-[22px] font-semibold tracking-tight">Bank reconciliation</h1>
          <p className="mt-1 text-ink-2">Import a statement from your bank, then match each line to your books.</p>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          Bank account
          <select className="field-input h-8 w-auto" value={bank ?? ''} onChange={(e) => setBankId(Number(e.target.value))}>
            {banks?.records.map((b) => (
              <option key={b.id} value={b.id}>
                {String(b.name)}
              </option>
            ))}
          </select>
        </label>
      </header>

      {license.writable && (
        <section className="mb-10 max-w-5xl rounded-lg border border-rule bg-sheet p-5">
          <h2 className="text-[15px] font-semibold">Import a statement</h2>
          <p className="mt-0.5 mb-3 text-[13px] text-ink-3">
            Download the statement as CSV from net banking. Lines already imported are skipped, so overlapping periods are fine.
          </p>
          <label className="btn-outline cursor-pointer">
            <Upload size={15} /> {file ? `Replace ${file.name}` : 'Choose CSV file'}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>

          {file && mapping && (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-4">
                {ROLES.map(([role, label]) => (
                  <label key={role} className="block text-[12.5px]">
                    <span className="mb-1 block font-medium text-ink-2">{label}</span>
                    <select
                      className="field-input h-8"
                      aria-label={label}
                      value={mapping[role] ?? ''}
                      onChange={(e) => {
                        const next = { ...mapping };
                        if (e.target.value === '') delete next[role];
                        else next[role] = Number(e.target.value);
                        setMapping(next as StatementMapping);
                      }}
                    >
                      <option value="">Not in file</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label className="block text-[12.5px]">
                  <span className="mb-1 block font-medium text-ink-2">Header row</span>
                  <input className="field-input h-8" inputMode="numeric" value={headerRow + 1} onChange={(e) => setHeaderRow(Math.max(Number(e.target.value || 1) - 1, 0))} />
                </label>
                <label className="block text-[12.5px]">
                  <span className="mb-1 block font-medium text-ink-2">Closing balance on the bank</span>
                  <input className="field-input h-8 text-right" inputMode="decimal" value={closing} onChange={(e) => setClosing(e.target.value.replace(/[^\d.-]/g, ''))} />
                </label>
              </div>

              {parsed && (
                <div className="mt-5">
                  <p className="mb-2 text-[13px] text-ink-2">
                    {parsed.rows.length} lines read
                    {parsed.skipped.length > 0 && `, ${parsed.skipped.length} skipped (${parsed.skipped.slice(0, 3).map((s) => `line ${s.line}: ${s.reason}`).join('; ')})`}.
                  </p>
                  <StatementPreview rows={parsed.rows.slice(0, 8)} />
                </div>
              )}
            </>
          )}
          {error && <p className="mt-3 text-[13px] text-crimson">{error}</p>}
          {parsed && parsed.rows.length > 0 && (
            <button className="btn-primary mt-4" disabled={importIt.isPending || bank === null} onClick={() => importIt.mutate()}>
              Import {parsed.rows.length} lines
            </button>
          )}
        </section>
      )}

      <h2 className="mb-2 text-[15px] font-semibold">Statements</h2>
      {statements?.records.length ? (
        <table className="w-full max-w-5xl border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th className={th}>Statement</th>
              <th className={th}>Period</th>
              <th className={clsx(th, num)}>Lines</th>
              <th className={clsx(th, num)}>Closing balance</th>
            </tr>
          </thead>
          <tbody>
            {statements.records.map((s) => (
              <tr key={s.id} className="hover:bg-sheet">
                <td className={td}>
                  <Link to={`/bank/${s.id}`} className="font-medium underline-offset-2 hover:underline">
                    {String(s.name)}
                  </Link>
                </td>
                <td className={td}>
                  {formatDate(String(s.dateFrom))} to {formatDate(String(s.dateTo))}
                </td>
                <td className={clsx(td, num)}>{String(s.lineCount)}</td>
                <td className={clsx(td, num)}>{s.closingBalance ? formatDecimal(String(s.closingBalance)) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-ink-3">No statements imported for this account yet.</p>
      )}
    </div>
  );
}

function StatementPreview({ rows }: { rows: { date: string; description: string; reference: string | null; amount: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
        <thead>
          <tr>
            <th className={th}>Date</th>
            <th className={th}>Description</th>
            <th className={clsx(th, num)}>Money out</th>
            <th className={clsx(th, num)}>Money in</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className={clsx(td, 'whitespace-nowrap')}>{formatDate(r.date)}</td>
              <td className={td}>
                {r.description}
                {r.reference && <span className="ml-2 text-ink-3">{r.reference}</span>}
              </td>
              <td className={clsx(td, num)}>{Number(r.amount) < 0 ? formatDecimal(r.amount.slice(1)) : ''}</td>
              <td className={clsx(td, num)}>{Number(r.amount) > 0 ? formatDecimal(r.amount) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ACCOUNT_FIELD: FieldDef = { type: 'many2one', label: 'Account', relation: 'account.account' };

/** Match one statement's lines to the books. */
export function ReconcileStatementView() {
  const id = Number(useParams().id);
  const { license } = useSession();
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['reconcile', id], queryFn: () => api.reconcile(id) });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['reconcile', id] });
  const fail = (e: Error) => setMessage({ kind: 'error', text: e.message });

  const auto = useMutation({
    mutationFn: () => api.autoMatch(id),
    onSuccess: (r) => {
      setMessage({ kind: 'ok', text: r.matched ? `Matched ${r.matched} line${r.matched === 1 ? '' : 's'}.` : 'No more clear matches. Match the rest by hand.' });
      refresh();
    },
    onError: fail,
  });
  const match = useMutation({ mutationFn: (v: { lineId: number; entryLineId: number }) => api.matchLine(v.lineId, v.entryLineId), onSuccess: refresh, onError: fail });
  const unmatch = useMutation({ mutationFn: (lineId: number) => api.unmatchLine(lineId), onSuccess: refresh, onError: fail });

  if (error) return <p className="p-8 text-crimson">{error.message}</p>;
  if (!data) return null;
  const s = data.summary;
  const done = s.matched === s.total;

  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-10">
      <Link to="/bank" className="btn-quiet -ml-3 mb-2 h-8 text-[13px]">
        <ArrowLeft size={15} /> All statements
      </Link>
      <header className="mb-5 flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-[22px] font-semibold tracking-tight">{data.statement.bankAccount}</h1>
          <p className="mt-1 text-ink-2">
            Statement {formatDate(data.statement.dateFrom)} to {formatDate(data.statement.dateTo)}
          </p>
        </div>
        {license.writable && !done && (
          <button className="btn-primary" disabled={auto.isPending} onClick={() => auto.mutate()}>
            <Wand2 size={15} /> Auto-match
          </button>
        )}
      </header>

      <dl className="mb-6 grid max-w-5xl grid-cols-2 gap-x-8 gap-y-3 border-y border-rule py-4 sm:grid-cols-4">
        <div>
          <dt className="text-[12.5px] text-ink-2">Reconciled</dt>
          <dd className={clsx('flex items-center gap-1.5 text-[20px] font-semibold tabular-nums', done && 'text-ok')}>
            {done && <CircleCheck size={18} />}
            {s.matched} of {s.total}
          </dd>
        </div>
        <div>
          <dt className="text-[12.5px] text-ink-2">Bank closing balance</dt>
          <dd className="text-[20px] font-semibold tabular-nums">{data.statement.closingBalance ? formatDecimal(data.statement.closingBalance) : '—'}</dd>
        </div>
        <div>
          <dt className="text-[12.5px] text-ink-2">Balance in your books</dt>
          <dd className="text-[20px] font-semibold tabular-nums">{formatDecimal(s.bookBalance)}</dd>
        </div>
        <div>
          <dt className="text-[12.5px] text-ink-2">Difference</dt>
          <dd className="text-[20px] font-semibold tabular-nums">{s.difference === null ? '—' : formatDecimal(s.difference)}</dd>
        </div>
        {s.unreconciledBookItems > 0 && (
          <p className="col-span-full text-[13px] text-ink-2">
            {s.unreconciledBookItems} item{s.unreconciledBookItems === 1 ? '' : 's'} in your books worth ₹{formatDecimal(s.unreconciledBookTotal.replace('-', ''))}{' '}
            {s.unreconciledBookItems === 1 ? 'has' : 'have'} not reached the bank yet, such as cheques not yet cleared.
          </p>
        )}
      </dl>

      {message && (
        <p role="status" className={clsx('mb-4 text-[13px]', message.kind === 'error' ? 'text-crimson' : 'text-ok')}>
          {message.text}
        </p>
      )}

      <table className="w-full max-w-6xl border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <th className={th}>Date</th>
            <th className={th}>Bank description</th>
            <th className={clsx(th, num)}>Money out</th>
            <th className={clsx(th, num)}>Money in</th>
            <th className={th}>In your books</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l) => (
            <tr key={l.id} className={l.matched ? 'text-ink-2' : ''}>
              <td className={clsx(td, 'whitespace-nowrap')}>{formatDate(l.date)}</td>
              <td className={clsx(td, 'max-w-80')}>
                {l.description}
                {l.reference && <span className="block text-[12.5px] text-ink-3">{l.reference}</span>}
              </td>
              <td className={clsx(td, num)}>{Number(l.amount) < 0 ? formatDecimal(l.amount.slice(1)) : ''}</td>
              <td className={clsx(td, num)}>{Number(l.amount) > 0 ? formatDecimal(l.amount) : ''}</td>
              <td className={clsx(td, 'min-w-80')}>
                {l.matched ? (
                  <div className="flex items-start gap-2">
                    <CircleCheck size={15} className="mt-0.5 shrink-0 text-ok" />
                    <span className="flex-1 text-[13px]">
                      {l.matched.reference}
                      <span className="block text-ink-3">
                        {l.matched.entryNumber}
                        {l.matched.narration && `, ${l.matched.narration}`}
                      </span>
                    </span>
                    {license.writable && (
                      <button className="btn-quiet h-7 text-[12.5px]" onClick={() => unmatch.mutate(l.id)}>
                        Unmatch
                      </button>
                    )}
                  </div>
                ) : (
                  <Unmatched line={l} writable={license.writable} onMatch={(entryLineId) => match.mutate({ lineId: l.id, entryLineId })} onBooked={refresh} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Unmatched({
  line,
  writable,
  onMatch,
  onBooked,
}: {
  line: Reconcile['lines'][number];
  writable: boolean;
  onMatch: (entryLineId: number) => void;
  onBooked: () => void;
}) {
  const [booking, setBooking] = useState(false);
  const [account, setAccount] = useState<Many2oneValue | null>(null);
  const [narration, setNarration] = useState(line.description);
  const book = useMutation({
    mutationFn: () => api.bookLine(line.id, { accountId: account!.id, narration }),
    onSuccess: onBooked,
  });

  return (
    <div className="space-y-1.5 text-[13px]">
      {(line.suggestions ?? []).map((c) => (
        <div key={c.entryLineId} className="flex items-start gap-2">
          <span className="flex-1">
            {c.reference}
            {c.partner && <span>, {c.partner}</span>}
            <span className="block text-ink-3">
              {formatDate(c.date)}
              {c.paymentReference && `, ref ${c.paymentReference}`}
              {c.referenceMatch && <span className="ml-1 font-medium text-ok">reference matches</span>}
            </span>
          </span>
          {writable && (
            <button className="btn-outline h-7 text-[12.5px]" onClick={() => onMatch(c.entryLineId)}>
              Match
            </button>
          )}
        </div>
      ))}
      {!line.suggestions?.length && <p className="text-ink-3">No entry with this amount nearby.</p>}
      {writable &&
        (booking ? (
          <div className="space-y-2 rounded-[5px] border border-rule bg-paper p-2.5">
            <FieldControl
              id={`book-${line.id}`}
              name="accountId"
              field={ACCOUNT_FIELD}
              value={account}
              onChange={(v) => setAccount(v as Many2oneValue | null)}
              compact
              aria-label={`Account for ${line.description}`}
            />
            <input className="field-input h-8" value={narration} onChange={(e) => setNarration(e.target.value)} aria-label="Narration" />
            {book.error && <p className="text-crimson">{book.error.message}</p>}
            <div className="flex gap-2">
              <button className="btn-primary h-7 text-[12.5px]" disabled={!account || book.isPending} onClick={() => book.mutate()}>
                Book and match
              </button>
              <button className="btn-quiet h-7 text-[12.5px]" onClick={() => setBooking(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="text-[12.5px] text-accent underline-offset-2 hover:underline" onClick={() => setBooking(true)}>
            Book to an account…
          </button>
        ))}
    </div>
  );
}
