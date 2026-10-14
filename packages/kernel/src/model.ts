// Model metadata: the single source of truth for a business object.
// Server derives tables + validation from it; the client renders generic
// list/form views from the same (JSON-serialisable) definition.

export type FieldType =
  | 'char'
  | 'text'
  | 'email'
  | 'phone'
  | 'int'
  | 'decimal'
  | 'bool'
  | 'date'
  | 'datetime'
  | 'selection'
  | 'many2one'
  | 'lines';

interface BaseField {
  type: FieldType;
  label: string;
  required?: boolean;
  readonly?: boolean;
  help?: string;
  index?: boolean;
  unique?: boolean;
  /**
   * Only show the field when the record has these values, e.g.
   * { state: ['posted', 'cancelled'] }. For a line field, the values are read
   * from the parent document.
   */
  visibleWhen?: Record<string, string | string[]>;
}

export interface CharField extends BaseField {
  type: 'char' | 'email' | 'phone';
  maxLength?: number;
  default?: string;
}
export interface TextField extends BaseField {
  type: 'text';
  default?: string;
}
export interface IntField extends BaseField {
  type: 'int';
  min?: number;
  default?: number;
}
/** Exact decimal, transported as a string to avoid float rounding. */
export interface DecimalField extends BaseField {
  type: 'decimal';
  precision?: number;
  scale?: number;
  default?: string;
}
export interface BoolField extends BaseField {
  type: 'bool';
  default?: boolean;
}
export interface DateField extends BaseField {
  type: 'date' | 'datetime';
  /** 'today' fills the current local date on create. */
  default?: 'today';
}
export interface SelectionField extends BaseField {
  type: 'selection';
  options: ReadonlyArray<readonly [value: string, label: string]>;
  default?: string;
  /** Show values as coloured status badges in lists and headers. */
  badge?: boolean;
}
export interface Many2oneField extends BaseField {
  type: 'many2one';
  /** Target model name. */
  relation: string;
  onDelete?: 'restrict' | 'set null' | 'cascade';
  /**
   * When a record is picked in the form, copy its fields into this record:
   * { ownField: 'targetField' }. Users can still edit the copied values.
   */
  fill?: Record<string, string>;
  /** Only offer records matching these exact values, e.g. { isVendor: true }. */
  filter?: Record<string, string | number | boolean>;
}

/** Child rows owned by the record (e.g. invoice lines), edited inline. */
export interface LinesField extends BaseField {
  type: 'lines';
  /** Child model name. */
  model: string;
  /** many2one field on the child that points back to this record. */
  inverse: string;
}

export type FieldDef =
  | CharField
  | TextField
  | IntField
  | DecimalField
  | BoolField
  | DateField
  | SelectionField
  | Many2oneField
  | LinesField;

export interface FormSection {
  title?: string;
  /** Number of columns the section's fields are laid out in (default 2). */
  columns?: 1 | 2 | 3;
  fields: string[];
}

/** A workflow step exposed as a button, implemented by a server hook. */
export interface ActionDef {
  name: string;
  label: string;
  /** States in which the action is offered (all when omitted). */
  states?: string[];
  /** Confirmation question shown before running. */
  confirm?: string;
  primary?: boolean;
  danger?: boolean;
}

export interface ModelDef {
  /** Dotted identifier, e.g. "base.contact". */
  name: string;
  table: string;
  label: string;
  labelPlural: string;
  /** Field used as the record's display name. */
  recName: string;
  fields: Record<string, FieldDef>;
  /** Fields matched by the quick-search box. */
  searchFields: string[];
  /** Default SQL ordering, e.g. "name asc". */
  order?: string;
  list: { columns: string[] };
  form: {
    sections: FormSection[];
    /** 'page' gives the record the full width (documents with lines). */
    layout?: 'panel' | 'page';
    /** Live totals block under the lines: GST totals, or debit/credit balance. */
    summary?: 'gst' | 'balance';
  };
  /**
   * GST document: supply is intra-state (CGST + SGST) when the supplier's
   * state equals the place of supply. Without `supplierStateField` the
   * supplier is the company itself (sales).
   */
  gst?: { placeOfSupplyField: string; supplierStateField?: string };
  /** Written only by server logic (ledgers, balances); the API and UI never edit it. */
  readonly?: boolean;
  /** Combinations of fields that must be unique together. */
  uniqueTogether?: string[][];
  /** Workflow state: records are editable only in the listed states. */
  states?: { field: string; editable: string[] };
  actions?: ActionDef[];
}

/** Columns every model gets automatically. */
export const SYSTEM_FIELDS = ['id', 'active', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'] as const;

export function defineModel<const M extends ModelDef>(model: M): M {
  for (const f of [model.recName, ...model.searchFields, ...model.list.columns]) {
    if (!(f in model.fields)) throw new Error(`${model.name}: unknown field "${f}"`);
  }
  for (const s of model.form.sections) {
    for (const f of s.fields) {
      if (!(f in model.fields)) throw new Error(`${model.name}: form references unknown field "${f}"`);
    }
  }
  for (const f of [model.gst?.placeOfSupplyField, model.gst?.supplierStateField]) {
    if (f && !(f in model.fields)) throw new Error(`${model.name}: gst references unknown field "${f}"`);
  }
  for (const combo of model.uniqueTogether ?? []) {
    for (const f of combo) if (!(f in model.fields)) throw new Error(`${model.name}: uniqueTogether references unknown field "${f}"`);
  }
  if (model.states && model.fields[model.states.field]?.type !== 'selection')
    throw new Error(`${model.name}: state field "${model.states.field}" must be a selection`);
  return model;
}

export interface MenuItem {
  id: string;
  label: string;
  /** lucide icon name, resolved on the client. */
  icon?: string;
  model?: string;
  /**
   * Fixed filter for the model's list; new records start with these values,
   * e.g. { direction: 'inbound' } for "Payments received".
   */
  filter?: Record<string, string | number | boolean>;
  /** Custom client page (reports) instead of a model list. */
  path?: string;
  children?: MenuItem[];
}

/** Whether a field is shown for these record values (see visibleWhen). */
export function isVisible(field: { visibleWhen?: Record<string, string | string[]> }, values: Record<string, unknown>): boolean {
  if (!field.visibleWhen) return true;
  return Object.entries(field.visibleWhen).every(([k, want]) => {
    const v = String(values[k] ?? '');
    return Array.isArray(want) ? want.includes(v) : v === want;
  });
}

export interface AppModule {
  name: string;
  label: string;
  depends: string[];
  models: ModelDef[];
  menus: MenuItem[];
}

export function defineModule(mod: AppModule): AppModule {
  return mod;
}

/** Shape the server exposes at /api/meta. */
export interface Metadata {
  models: Record<string, ModelDef>;
  menus: MenuItem[];
}
