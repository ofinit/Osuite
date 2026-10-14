import type { FieldErrors } from '@osuite/kernel';
import type { Tx } from '../db/client.ts';

export type Values = Record<string, unknown>;

export interface HookCtx {
  tx: Tx;
  userId: number;
}

/** Server-only business rules attached to a model. */
export interface ModelHooks {
  /** Adjust incoming values (e.g. upper-case codes) before validation. */
  normalize?(values: Values): void;
  /** Cross-field / domain validation. `existing` is set on update. */
  validate?(values: Values, existing?: Values): FieldErrors | undefined;
  /**
   * Derives readonly fields before saving, mutating in place: `record` is the
   * merged parent row, `lines` maps each lines field to its child rows.
   */
  compute?(ctx: HookCtx, record: Values, lines: Record<string, Values[]>): Promise<void> | void;
  /** Workflow actions (see ModelDef.actions); return values to write on the record. */
  actions?: Record<string, (ctx: HookCtx, record: Values, lines: Record<string, Values[]>) => Promise<Values | void>>;
}

export type HookMap = Record<string, ModelHooks>;
