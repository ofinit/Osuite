import clsx from 'clsx';
import { TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { useSession } from '../lib/session.ts';

export function LicenseBanner() {
  const { license, user } = useSession();
  if (license.state === 'active' || license.state === 'dev') return null;
  const readonly = !license.writable;
  return (
    <div
      role="status"
      className={clsx(
        'flex items-center gap-2 border-b px-4 py-2 text-[13px]',
        readonly ? 'border-crimson/30 bg-crimson-soft text-crimson' : 'border-amber/30 bg-amber-soft text-amber',
      )}
    >
      <TriangleAlert size={15} className="shrink-0" />
      <span className="flex-1">
        {readonly && <strong className="font-semibold">Read-only. </strong>}
        {license.message}
      </span>
      {user.isAdmin && (
        <Link to="/settings/license" className="font-medium underline underline-offset-2">
          Manage licence
        </Link>
      )}
    </div>
  );
}
