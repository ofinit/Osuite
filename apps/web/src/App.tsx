import { lazy, Suspense, useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { BrandMark } from '@osuite/ui';
import { Shell } from './components/Shell.tsx';
import { useBootstrap } from './lib/session.ts';
import { ActivateView } from './views/ActivateView.tsx';
import { BalanceSheetView, Gstr1View, Gstr3bView, ProfitLossView, TrialBalanceView } from './views/AccountingReports.tsx';
import { AgeingView } from './views/AgeingView.tsx';
import { BackupView } from './views/BackupView.tsx';
import { EInvoiceSettingsView } from './views/EInvoiceSettingsView.tsx';
import { BankView, ReconcileStatementView } from './views/BankView.tsx';
import { ClosingView } from './views/ClosingView.tsx';
import { CompanyView } from './views/CompanyView.tsx';
import { HomeView } from './views/HomeView.tsx';
import { LicenseView } from './views/LicenseView.tsx';
import { ListView } from './views/ListView.tsx';
import { DayBookView, LedgerView, StatementPrintView } from './views/LedgerView.tsx';
import { LoginView } from './views/LoginView.tsx';
import { SetupView } from './views/SetupView.tsx';
import { UsersView } from './views/UsersView.tsx';

const PrintView = lazy(() => import('./views/PrintView.tsx').then((m) => ({ default: m.PrintView })));

const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomeView /> },
      { path: 'm/:model', element: <ListView /> },
      { path: 'bank', element: <BankView /> },
      { path: 'closing', element: <ClosingView /> },
      { path: 'bank/:id', element: <ReconcileStatementView /> },
      { path: 'reports/trial-balance', element: <TrialBalanceView /> },
      { path: 'reports/profit-loss', element: <ProfitLossView /> },
      { path: 'reports/balance-sheet', element: <BalanceSheetView /> },
      { path: 'reports/gstr-3b', element: <Gstr3bView /> },
      { path: 'reports/gstr-1', element: <Gstr1View /> },
      { path: 'reports/ledger', element: <LedgerView /> },
      { path: 'reports/day-book', element: <DayBookView /> },
      { path: 'reports/:kind', element: <AgeingView /> },
      { path: 'settings/company', element: <CompanyView /> },
      { path: 'settings/users', element: <UsersView /> },
      { path: 'settings/license', element: <LicenseView /> },
      { path: 'settings/backups', element: <BackupView /> },
      { path: 'settings/einvoice', element: <EInvoiceSettingsView /> },
    ],
  },
  { path: '/print/statement/:partnerId', element: <StatementPrintView /> },
  {
    path: '/print/:model/:id',
    element: (
      <Suspense fallback={null}>
        <PrintView />
      </Suspense>
    ),
  },
]);

export function App() {
  const { data, error, refetch } = useBootstrap();
  const [browseReadOnly, setBrowseReadOnly] = useState(false);

  if (error)
    return (
      <Splash>
        <p className="text-ink-2">{error.message}</p>
        <button className="btn-outline mt-4" onClick={() => void refetch()}>
          Try again
        </button>
      </Splash>
    );
  if (!data) return <Splash />;
  if (data.needsSetup) return <SetupView />;
  if (!data.user) return <LoginView company={data.company?.name} />;
  if (data.license.state === 'unlicensed' && data.user.isAdmin && !browseReadOnly)
    return <ActivateView onSkip={() => setBrowseReadOnly(true)} />;
  return <RouterProvider router={router} />;
}

function Splash({ children }: { children?: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="text-center">
        <BrandMark className="mx-auto mb-4" />
        {children}
      </div>
    </div>
  );
}
