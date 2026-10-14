import { RecordError } from '../../services/errors.ts';
import type { HookMap, Values } from '../../services/hooks.ts';
import { nextDocumentNumber } from '../../services/numbering.ts';
import { adjustmentLines, postJournal, reverseJournal } from '../account/journal.ts';
import { defaultWarehouseId, postMoves, reverseMoves } from './service.ts';

const source = (r: Values) => ({ date: String(r.date), reference: String(r.number), refModel: 'stock.adjustment', refId: r.id as number });

export const hooks: HookMap = {
  'stock.warehouse': {
    normalize(v) {
      if (typeof v.code === 'string') v.code = v.code.trim().toUpperCase();
    },
  },
  'stock.adjustment': {
    async compute({ tx }, record) {
      if (!record.warehouseId) record.warehouseId = await defaultWarehouseId(tx);
    },
    actions: {
      async post({ tx }, record, lines) {
        const rows = (lines.lines ?? []) as Values[];
        if (!rows.length) throw new RecordError(422, 'Add at least one product before posting.');
        if (rows.some((l) => Number(l.qty) === 0)) throw new RecordError(422, 'Remove lines with a zero quantity change.');
        const number = await nextDocumentNumber(tx, 'ADJ', String(record.date));
        const src = source({ ...record, number });
        const { value } = await postMoves(
          tx,
          src,
          rows.map((l) => ({
            productId: l.productId as number,
            warehouseId: record.warehouseId as number,
            qty: String(l.qty),
            unitCost: l.unitCost === null || l.unitCost === undefined ? undefined : String(l.unitCost),
            kind: record.reason === 'opening' ? ('opening' as const) : ('adjustment' as const),
          })),
        );
        await postJournal(tx, { ...src, narration: `Stock adjustment ${number}` }, adjustmentLines(record, value));
        return { state: 'posted', number };
      },
      async cancel({ tx }, record) {
        await reverseMoves(tx, source(record));
        await reverseJournal(tx, source(record));
        return { state: 'cancelled' };
      },
    },
  },
};
