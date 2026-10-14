// Loads every module, generates tables and exposes the merged metadata.
import type { AppModule, Metadata, ModelDef } from '@osuite/kernel';
import { defineModelTable, type AnyTable } from './db/tables.ts';
import base from './modules/base/index.ts';
import { hooks as baseHooks } from './modules/base/hooks.ts';
import stock from './modules/stock/index.ts';
import { hooks as stockHooks } from './modules/stock/hooks.ts';
import sales from './modules/sales/index.ts';
import { hooks as salesHooks } from './modules/sales/hooks.ts';
import purchase from './modules/purchase/index.ts';
import account from './modules/account/index.ts';
import { hooks as accountHooks } from './modules/account/hooks.ts';
import { hooks as purchaseHooks } from './modules/purchase/hooks.ts';
import type { ModelHooks } from './services/hooks.ts';

/** Modules in dependency order. */
export const MODULES: AppModule[] = [base, stock, sales, purchase, account];

export const models = new Map<string, ModelDef>();
export const tables = new Map<string, AnyTable>();
export const hooks = new Map<string, ModelHooks>(Object.entries({ ...baseHooks, ...stockHooks, ...salesHooks, ...purchaseHooks, ...accountHooks }));
/** Child model -> parent model, for models that only exist as lines of another. */
export const ownedBy = new Map<string, ModelDef>();

for (const mod of MODULES) {
  for (const m of mod.models) {
    if (models.has(m.name)) throw new Error(`Duplicate model ${m.name}`);
    models.set(m.name, m);
    tables.set(m.name, defineModelTable(m));
  }
}
for (const m of models.values()) {
  for (const f of Object.values(m.fields)) {
    if (f.type !== 'lines') continue;
    const child = models.get(f.model);
    if (!child) throw new Error(`${m.name}: lines model ${f.model} is not registered`);
    if (child.fields[f.inverse]?.type !== 'many2one') throw new Error(`${f.model}: inverse field ${f.inverse} must be a many2one`);
    ownedBy.set(f.model, m);
  }
}

export function getModel(name: string): ModelDef | undefined {
  return models.get(name);
}

export function metadata(): Metadata {
  return {
    models: Object.fromEntries(models),
    menus: MODULES.flatMap((m) => m.menus),
  };
}
