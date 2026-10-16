import { allows, modelAccess, type AccessLevel, type Area } from '@osuite/kernel';
import { useSession } from './session.ts';

/** What the signed-in user's role allows. The server enforces the same rules; this only hides what would be refused. */
export function useAccess() {
  const { user, license } = useSession();
  return {
    /** At least `need` on a model's records. */
    can: (model: string, need: AccessLevel) => allows(modelAccess(user, model), need),
    /** At least `need` on a model, and the licence allows changes (for edit and above). */
    canChange: (model: string, need: AccessLevel = 'edit') => license.writable && allows(modelAccess(user, model), need),
    area: (area: Area, need: AccessLevel = 'view') => user.isAdmin || allows(user.access[area], need),
  };
}
