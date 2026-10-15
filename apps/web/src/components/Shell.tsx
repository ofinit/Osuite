import type { MenuItem } from '@osuite/kernel';
import clsx from 'clsx';
import { BookOpen, Building2, ChevronDown, DatabaseBackup, FileBadge, KeyRound, LayoutGrid, LogOut, Menu, Package, ReceiptText, Search, ShoppingCart, Users, UserCog, Warehouse, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { menuHref } from '../lib/menus.ts';
import { useMeta, useSession, useSignOut } from '../lib/session.ts';
import { BrandMark } from '@osuite/ui';
import { CommandPalette } from './CommandPalette.tsx';
import { LicenseBanner } from './LicenseBanner.tsx';

const ICONS: Record<string, LucideIcon> = { users: Users, package: Package, receipt: ReceiptText, cart: ShoppingCart, warehouse: Warehouse, book: BookOpen };

export function Shell() {
  const { user, company } = useSession();
  const { data: meta } = useMeta();
  const signOut = useSignOut();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full">
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-rule bg-paper transition-transform md:static md:translate-x-0',
          navOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center px-4">
          <BrandMark withName />
        </div>
        <div className="truncate px-4 pb-3 text-[13px] text-ink-2" title={company?.name}>
          {company?.name}
        </div>

        <button
          onClick={() => setPaletteOpen(true)}
          className="mx-3 mb-3 flex h-9 items-center gap-2 rounded-[5px] border border-rule-strong bg-sheet px-2.5 text-ink-3 hover:border-ink-3"
        >
          <Search size={15} />
          <span className="flex-1 text-left">Search…</span>
          <span className="kbd">Ctrl K</span>
        </button>

        <nav className="flex-1 overflow-y-auto px-2" aria-label="Main">
          {meta?.menus.map((m) => <NavEntry key={m.id} item={m} />)}
        </nav>

        <div className="border-t border-rule px-2 py-2">
          {user.isAdmin && (
            <>
              <SideLink to="/settings/company" icon={Building2} label="Company" />
              <SideLink to="/settings/users" icon={UserCog} label="Users" />
              <SideLink to="/settings/einvoice" icon={FileBadge} label="E-invoicing" />
              <SideLink to="/settings/backups" icon={DatabaseBackup} label="Backups" />
              <SideLink to="/settings/license" icon={KeyRound} label="Licence" />
            </>
          )}
          <div className="mt-1 flex items-center gap-2 px-2 py-1.5">
            <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{user.name}</span>
            <button className="btn-quiet h-7 px-1.5" onClick={() => void signOut()} title="Sign out" aria-label="Sign out">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-20 bg-black/20 md:hidden" onClick={() => setNavOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center border-b border-rule px-3 md:hidden">
          <button className="btn-quiet px-2" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <BrandMark withName className="ml-2" />
        </div>
        <LicenseBanner />
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

const COLLAPSED_KEY = 'osuite.nav.collapsed';

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function NavEntry({ item }: { item: MenuItem }) {
  const Icon = (item.icon && ICONS[item.icon]) || LayoutGrid;
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => readCollapsed().has(item.id));
  const href = menuHref(item);
  if (href) return <SideLink to={href} icon={Icon} label={item.label} />;

  // The group holding the current page is always open.
  const containsCurrent = (item.children ?? []).some((c) => {
    const h = menuHref(c);
    return h && location.pathname === h.split('?')[0];
  });
  const open = !collapsed || containsCurrent;
  const toggle = () => {
    const next = readCollapsed();
    if (collapsed) next.delete(item.id);
    else next.add(item.id);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      // storage unavailable: the choice lasts for this session only
    }
    setCollapsed(!collapsed);
  };

  return (
    <div className="mt-2 first:mt-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-[5px] px-2 py-1 text-[12px] font-medium text-ink-3 hover:text-ink"
      >
        <Icon size={14} />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown size={13} className={clsx('transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <div className="ml-[17px] border-l border-rule pl-1.5">
          {item.children?.map((c) => {
            const h = menuHref(c);
            return h ? <SideLink key={c.id} to={h} label={c.label} /> : null;
          })}
        </div>
      )}
    </div>
  );
}

function SideLink({ to, label, icon: Icon }: { to: string; label: string; icon?: LucideIcon }) {
  const location = useLocation();
  // Two menu entries can share a path with different filters (payments received/made).
  const [path, query = ''] = to.split('?');
  const wanted = new URLSearchParams(query);
  const current = new URLSearchParams(location.search);
  const filtersMatch = [...current.keys(), ...wanted.keys()]
    .filter((k) => k.startsWith('f.'))
    .every((k) => current.get(k) === wanted.get(k));
  return (
    <NavLink
      to={to}
      className={({ isActive: pathActive }) => {
        const isActive = pathActive && location.pathname === path && filtersMatch;
        return clsx(
          'flex h-8 items-center gap-2.5 rounded-[5px] px-2 text-[13.5px]',
          isActive ? 'bg-sheet font-medium text-ink shadow-[inset_2px_0_0_var(--crimson)]' : 'text-ink-2 hover:bg-rule/60 hover:text-ink',
        );
      }}
    >
      {Icon && <Icon size={16} />}
      {label}
    </NavLink>
  );
}
