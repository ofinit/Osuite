import { BrandMark } from '@osuite/ui';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Building2, CreditCard, Gauge, KeyRound, LogOut, Menu, Settings, Users, UsersRound, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { api, type StaffUser } from '../api.ts';

export function Layout({ me }: { me: StaffUser }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    qc.clear();
    window.location.assign('/');
  };

  return (
    <div className="flex h-full">
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-rule bg-paper transition-transform md:static md:translate-x-0',
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 px-4">
          <BrandMark withName />
          <span className="rounded bg-ink px-1.5 py-px text-[11px] font-semibold text-paper">Admin</span>
        </div>
        <nav className="flex-1 space-y-0.5 px-2" aria-label="Main">
          <Item to="/" icon={Gauge} label="Overview" end />
          <Item to="/licenses" icon={KeyRound} label="Licences" />
          <Item to="/customers" icon={Users} label="Customers" />
          <Item to="/plans" icon={CreditCard} label="Plans" />
          <Item to="/business" icon={Building2} label="Business details" />
          {me.role === 'owner' && <Item to="/team" icon={UsersRound} label="Team" />}
        </nav>
        <div className="border-t border-rule px-2 py-2">
          <Item to="/account" icon={Settings} label="My account" />
          <div className="mt-1 flex items-center gap-2 px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px]" title={me.email}>
              {me.name}
              <span className="block text-[12px] text-ink-3">{me.role === 'owner' ? 'Owner' : 'Staff'}</span>
            </span>
            <button className="btn-quiet h-7 px-1.5" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-black/20 md:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center border-b border-rule px-3 md:hidden">
          <button className="btn-quiet px-2" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <BrandMark withName className="ml-2" />
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function Item({ to, icon: Icon, label, end }: { to: string; icon: LucideIcon; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          'flex h-8 items-center gap-2.5 rounded-[5px] px-2 text-[13.5px]',
          isActive ? 'bg-sheet font-medium text-ink shadow-[inset_2px_0_0_var(--crimson)]' : 'text-ink-2 hover:bg-rule/60 hover:text-ink',
        )
      }
    >
      <Icon size={16} />
      {label}
    </NavLink>
  );
}
