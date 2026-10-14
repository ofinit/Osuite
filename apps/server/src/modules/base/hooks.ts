import { isValidGstin, type FieldErrors } from '@osuite/kernel';
import type { HookMap } from '../../services/hooks.ts';

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PIN_RE = /^[1-9][0-9]{5}$/;

const upper = (v: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (typeof v[k] === 'string') v[k] = (v[k] as string).toUpperCase();
};

export const hooks: HookMap = {
  'base.contact': {
    normalize(v) {
      upper(v, 'gstin', 'pan');
    },
    validate(v, existing) {
      const errors: FieldErrors = {};
      const get = (k: string) => (k in v ? v[k] : existing?.[k]);
      const gstin = get('gstin');
      const stateCode = get('stateCode');
      if (typeof gstin === 'string' && gstin) {
        if (!isValidGstin(gstin)) errors.gstin = 'Invalid GSTIN (format or check digit)';
        else if (typeof stateCode === 'string' && stateCode && gstin.slice(0, 2) !== stateCode)
          errors.stateCode = `GSTIN is registered in state ${gstin.slice(0, 2)}`;
        const pan = get('pan');
        if (typeof pan === 'string' && pan && gstin.slice(2, 12) !== pan) errors.pan = 'PAN does not match GSTIN';
      }
      const pan = v.pan;
      if (typeof pan === 'string' && pan && !PAN_RE.test(pan)) errors.pan = 'Invalid PAN';
      const pin = v.pincode;
      if (typeof pin === 'string' && pin && !PIN_RE.test(pin)) errors.pincode = 'PIN code must be 6 digits';
      if (existing && v.parentId !== undefined && v.parentId === existing.id)
        errors.parentId = 'A contact cannot be its own company';
      return errors;
    },
  },
  'base.product': {
    normalize(v) {
      upper(v, 'sku');
    },
    validate(v) {
      const hsn = v.hsnCode;
      if (typeof hsn === 'string' && hsn && !/^\d{4}(\d{2}){0,2}$/.test(hsn))
        return { hsnCode: 'HSN/SAC must be 4, 6 or 8 digits' };
      return undefined;
    },
  },
};
