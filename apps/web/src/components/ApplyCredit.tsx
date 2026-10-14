import { money, type Many2oneValue, type ModelDef, type RecordData } from '@osuite/kernel';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { formatDecimal } from '../lib/format.ts';

const SIDES: Record<string, { direction: 'inbound' | 'outbound'; partnerField: string }> = {
  'sales.invoice': { direction: 'inbound', partnerField: 'customerId' },
  'purchase.bill': { direction: 'outbound', partnerField: 'vendorId' },
};

/** "Apply ₹X credit" on a posted invoice/bill whose party has credit available. */
export function ApplyCredit({
  model,
  record,
  onResult,
}: {
  model: ModelDef;
  record: RecordData;
  onResult: (kind: 'ok' | 'error', text: string) => void;
}) {
  const side = SIDES[model.name];
  const partner = side ? (record[side.partnerField] as Many2oneValue | null) : null;
  const eligible = !!side && !!partner && record.state === 'posted' && Number(record.amountDue) > 0;
  const qc = useQueryClient();
  const { data: credits = [] } = useQuery({
    queryKey: ['credits', side?.direction, partner?.id],
    queryFn: () => api.credits(side!.direction, partner!.id),
    enabled: eligible,
  });
  const available = money.add(...credits.map((c) => c.remaining));
  const apply = useMutation({
    mutationFn: () => api.applyCredit({ direction: side!.direction, partnerId: partner!.id, docId: record.id }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['record', model.name, record.id] });
      void qc.invalidateQueries({ queryKey: ['credits'] });
      void qc.invalidateQueries({ queryKey: ['list', model.name] });
      onResult('ok', `₹${formatDecimal(r.applied)} of credit applied`);
    },
    onError: (e) => onResult('error', e.message),
  });
  if (!eligible || !money.isPositive(available)) return null;
  const amount = money.min(available, record.amountDue as string);
  return (
    <button
      className="btn-outline"
      disabled={apply.isPending}
      title={`From ${credits.map((c) => c.number).join(', ')}`}
      onClick={() => apply.mutate()}
    >
      Apply ₹{formatDecimal(amount)} credit
    </button>
  );
}
