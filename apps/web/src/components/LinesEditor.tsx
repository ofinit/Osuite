import { isVisible, type FieldDef, type LinesField, type Many2oneValue, type ModelDef } from '@osuite/kernel';
import clsx from 'clsx';
import { Plus, X } from 'lucide-react';
import { useRef } from 'react';
import { defaults, fillFrom, type Values } from '../lib/document.ts';
import { formatValue, isNumeric } from '../lib/format.ts';
import { FieldControl } from './fields.tsx';

/** Column widths by kind; the text column takes the remaining space. */
function width(name: string, f: FieldDef): string {
  if (f.readonly) return 'w-28';
  if (f.type === 'many2one') return 'w-48';
  if (f.type === 'selection') return name === 'gstRate' ? 'w-20' : 'w-28';
  if (f.type === 'decimal') return name === 'discountPct' ? 'w-20' : name === 'qty' ? 'w-20' : 'w-28';
  if (f.type === 'char' && (f.maxLength ?? 255) <= 15) return 'w-24';
  return 'min-w-48';
}

/**
 * Spreadsheet-style editor for a document's lines. Enter moves down a column
 * (adding a row at the end); arrow keys move between rows in text cells.
 */
export function LinesEditor({
  name,
  field,
  child,
  rows,
  onChange,
  errors,
  disabled,
  preview,
  parent = {},
}: {
  name: string;
  field: LinesField;
  child: ModelDef;
  rows: Values[];
  /**
   * Receives an update to apply to the latest rows (not a snapshot): edits
   * that land close together, or an async product fill, never undo each other.
   */
  onChange: (update: (rows: Values[]) => Values[]) => void;
  errors: Record<string, string>;
  disabled: boolean;
  /** Live values for readonly columns (e.g. computed amounts), per row. */
  preview?: Values[];
  /** The parent document's values, for columns shown conditionally (visibleWhen). */
  parent?: Values;
}) {
  const tableRef = useRef<HTMLTableElement>(null);
  const columns = child.list.columns.filter((c) => c !== field.inverse && isVisible(child.fields[c]!, parent));
  const editable = columns.filter((c) => !child.fields[c]!.readonly);

  const focusCell = (row: number, col: string) => {
    const before = document.activeElement;
    requestAnimationFrame(() => {
      // If the user has already moved on (clicked another cell and started
      // typing), don't pull focus away mid-keystroke.
      if (document.activeElement !== before) return;
      tableRef.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)?.focus();
    });
  };

  const addRow = (focus = true) => {
    onChange((current) => [...current, defaults(child)]);
    if (focus) focusCell(rows.length, editable[0]!);
  };

  const patchRow = (i: number, patch: Values) => onChange((current) => current.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const setCell = async (i: number, col: string, v: unknown) => {
    patchRow(i, { [col]: v });
    const f = child.fields[col]!;
    if (f.type === 'many2one' && f.fill && v) {
      // Applied to the row as it is when the product arrives, keeping later typing.
      patchRow(i, await fillFrom(f, v as Many2oneValue));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return; // e.g. a combobox picked an option
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!cell) return;
    const [rowStr, col] = cell.dataset.cell!.split(':') as [string, string];
    const row = Number(rowStr);
    const isText = cell.tagName === 'INPUT' && cell.getAttribute('role') !== 'combobox';
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (row === rows.length - 1) addRow(false);
      focusCell(row + 1, col);
    } else if (isText && e.key === 'ArrowDown' && row < rows.length - 1) {
      e.preventDefault();
      focusCell(row + 1, col);
    } else if (isText && e.key === 'ArrowUp' && row > 0) {
      e.preventDefault();
      focusCell(row - 1, col);
    }
  };

  return (
    <div>
      <div className="overflow-x-auto rounded-[5px] border border-rule-strong">
        <table ref={tableRef} className="w-full border-collapse text-left" onKeyDown={onKeyDown}>
          <thead className="bg-paper">
            <tr>
              <th scope="col" className="w-9 border-b border-rule-strong px-2 py-1.5 text-[12px] font-medium text-ink-3">
                #
              </th>
              {columns.map((c) => {
                const f = child.fields[c]!;
                return (
                  <th
                    key={c}
                    scope="col"
                    className={clsx(
                      'border-b border-rule-strong px-1 py-1.5 text-[12px] font-medium whitespace-nowrap text-ink-2',
                      width(c, f),
                      isNumeric(f) && 'text-right',
                    )}
                  >
                    {f.label}
                  </th>
                );
              })}
              <th className="w-9 border-b border-rule-strong" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={(r.id as number | undefined) ?? `new-${i}`} className="group align-top">
                <td className="border-b border-rule px-2 pt-2 text-[12.5px] text-ink-3 tabular-nums">{i + 1}</td>
                {columns.map((c) => {
                  const f = child.fields[c]!;
                  const err = errors[`${name}.${i}.${c}`];
                  if (f.readonly || disabled) {
                    const v = f.readonly ? (preview?.[i]?.[c] ?? r[c]) : r[c];
                    // Quantities drop trailing zeros; money keeps two decimals.
                    const text =
                      f.type === 'decimal' && (f.scale ?? 2) > 2
                        ? Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: f.scale })
                        : formatValue(f, v);
                    return (
                      <td
                        key={c}
                        className={clsx('border-b border-rule px-2 py-2', isNumeric(f) || f.readonly ? 'text-right whitespace-nowrap tabular-nums' : '')}
                      >
                        {text}
                      </td>
                    );
                  }
                  return (
                    <td key={c} className="border-b border-rule px-1 py-1">
                      <CellControl
                        id={`${name}-${i}-${c}`}
                        cell={`${i}:${c}`}
                        name={c}
                        field={f}
                        value={r[c]}
                        error={err}
                        disabled={disabled}
                        label={`${f.label}, line ${i + 1}`}
                        onChange={(v) => void setCell(i, c, v)}
                      />
                    </td>
                  );
                })}
                <td className="border-b border-rule px-1 pt-1.5 text-center">
                  {!disabled && (
                    <button
                      type="button"
                      className="rounded p-1 text-ink-3 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-crimson"
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() => onChange((current) => current.filter((_, j) => j !== i))}
                    >
                      <X size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="px-3 py-6 text-center text-ink-3">
                  No items yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <button type="button" className="btn-quiet mt-2 h-8 text-[13px]" onClick={() => addRow()}>
          <Plus size={15} /> Add line
          <span className="kbd">Enter</span>
        </button>
      )}
    </div>
  );
}

/** FieldControl wrapped so the grid can find and focus it by row/column. */
function CellControl({
  cell,
  label,
  ...props
}: { id: string; cell: string; name: string; field: FieldDef; value: unknown; error?: string; disabled: boolean; label: string; onChange: (v: unknown) => void }) {
  return (
    <div
      ref={(el) => {
        // Tag the actual focusable element so focusCell() can target it.
        el?.querySelector('input,select,textarea')?.setAttribute('data-cell', cell);
      }}
    >
      <FieldControl {...props} compact aria-label={label} />
    </div>
  );
}
