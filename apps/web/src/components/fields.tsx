import type { FieldDef, Many2oneValue } from '@osuite/kernel';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { formatValue, isNumeric } from '../lib/format.ts';

export interface FieldProps {
  name: string;
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  disabled?: boolean;
  /** Show the value as text (locked documents), not as an input. */
  asText?: boolean;
}

export function Field(props: FieldProps) {
  const { field, error, name } = props;
  const id = `f-${name}`;
  if (field.readonly || props.asText) {
    return (
      <div className="min-w-0">
        <span className="mb-1 block text-[12.5px] font-medium text-ink-2">{field.label}</span>
        <span className={clsx('flex min-h-9 items-center whitespace-pre-line', isNumeric(field) && 'justify-end')}>
          {formatValue(field, props.value) || '—'}
        </span>
      </div>
    );
  }
  if (field.type === 'bool') {
    return (
      <label className="flex h-9 items-center gap-2.5 self-end text-ink" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          className="size-4 accent-[var(--accent)]"
          checked={!!props.value}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        {field.label}
      </label>
    );
  }
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[12.5px] font-medium text-ink-2">
        {field.label}
        {field.required && (
          <span aria-hidden="true" className="text-crimson">
            {' '}
            *
          </span>
        )}
      </label>
      <FieldControl {...props} id={id} />
      {error ? (
        <p className="mt-1 text-[12.5px] text-crimson" id={`${id}-err`}>
          {error}
        </p>
      ) : field.help ? (
        <p className="mt-1 text-[12px] text-ink-3">{field.help}</p>
      ) : null}
    </div>
  );
}

export interface ControlProps extends FieldProps {
  id: string;
  /** Dense variant for grid cells. */
  compact?: boolean;
  'aria-label'?: string;
}

/** The bare input for a field (no label), used by forms and the lines grid. */
export function FieldControl({ field, value, onChange, error, disabled, id, compact, 'aria-label': ariaLabel }: ControlProps) {
  const base = compact ? 'field-input h-8 rounded-[4px] px-2' : 'field-input';
  const common = {
    id,
    disabled,
    'aria-label': ariaLabel,
    'aria-invalid': error ? true : undefined,
    'aria-required': field.required || undefined,
    'aria-describedby': error && !compact ? `${id}-err` : undefined,
    title: compact ? error : undefined,
    className: base,
  } as const;
  const str = value === null || value === undefined ? '' : String(value);

  switch (field.type) {
    case 'text':
      return (
        <textarea {...common} className={`${base} h-auto min-h-20 py-2`} rows={3} value={str} onChange={(e) => onChange(e.target.value)} />
      );
    case 'selection':
      return (
        <select {...common} value={str} onChange={(e) => onChange(e.target.value || null)}>
          {/* Never let the browser show the first option as if it were chosen. */}
          {(!field.required || !str) && (
            <option value="" disabled={field.required}>
              {field.required ? 'Select…' : '—'}
            </option>
          )}
          {field.options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      );
    case 'int':
      return (
        <input
          {...common}
          className={`${base} text-right`}
          inputMode="numeric"
          value={str}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d-]/g, '');
            onChange(raw === '' || raw === '-' ? (raw === '-' ? raw : null) : Number(raw));
          }}
        />
      );
    case 'decimal':
      return (
        <input
          {...common}
          className={`${base} text-right`}
          inputMode="decimal"
          value={str}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, '') || null)}
        />
      );
    case 'date':
      return <input {...common} type="date" value={str} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime':
      return (
        <input
          {...common}
          type="datetime-local"
          value={str ? str.slice(0, 16) : ''}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );
    case 'many2one':
      return (
        <Many2oneInput
          id={id}
          className={base}
          ariaLabel={ariaLabel}
          relation={field.relation}
          filter={field.filter}
          value={(value as Many2oneValue | null) ?? null}
          onChange={onChange}
          disabled={disabled}
          invalid={!!error}
        />
      );
    case 'email':
      return <input {...common} type="email" value={str} onChange={(e) => onChange(e.target.value)} />;
    case 'phone':
      return <input {...common} type="tel" value={str} onChange={(e) => onChange(e.target.value)} />;
    default:
      return (
        <input
          {...common}
          maxLength={field.type === 'char' ? field.maxLength : undefined}
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function Many2oneInput({
  id,
  className,
  ariaLabel,
  relation,
  filter,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string;
  className: string;
  ariaLabel?: string;
  relation: string;
  filter?: Record<string, string | number | boolean>;
  value: Many2oneValue | null;
  onChange: (v: Many2oneValue | null) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [text, setText] = useState(value?.display ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [term, setTerm] = useState('');
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(value?.display ?? '');
  }, [value]);
  useEffect(() => {
    const t = setTimeout(() => setTerm(text), 150);
    return () => clearTimeout(t);
  }, [text]);

  const searchTerm = value && text === value.display ? '' : term;
  const { data: options = [] } = useQuery({
    queryKey: ['name-search', relation, searchTerm, filter],
    queryFn: () => api.nameSearch(relation, searchTerm, 8, filter),
    enabled: open,
  });

  const pick = (o: Many2oneValue | null) => {
    onChange(o);
    setText(o?.display ?? '');
    setOpen(false);
  };

  return (
    <div
      ref={wrap}
      className="relative"
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node)) {
          setOpen(false);
          // Only clear when there was a value: a needless update can race other edits.
          if (!text) {
            if (value) onChange(null);
          }
          else setText(value?.display ?? '');
        }
      }}
    >
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        aria-label={ariaLabel}
        className={`${className} pr-8`}
        value={text}
        disabled={disabled}
        placeholder="Search…"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && options[active]) {
            e.preventDefault();
            pick(options[active]);
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {value && !disabled && (
        <button
          type="button"
          tabIndex={-1}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-ink-3 hover:text-ink"
          onClick={() => pick(null)}
          aria-label="Clear"
        >
          <X size={14} />
        </button>
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-[5px] border border-rule-strong bg-sheet py-1 shadow-lg"
        >
          {options.length === 0 && <li className="px-2.5 py-1.5 text-ink-3">No matches</li>}
          {options.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              onMouseEnter={() => setActive(i)}
              className={clsx('cursor-pointer px-2.5 py-1.5', i === active ? 'bg-accent-soft text-ink' : 'text-ink-2')}
            >
              {o.display}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
