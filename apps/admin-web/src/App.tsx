import { useQuery } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { api, ApiError, type StaffUser } from './api.ts';
import { Layout } from './components/Layout.tsx';
import { AccountPage } from './pages/AccountPage.tsx';
import { CustomerPage } from './pages/CustomerPage.tsx';
import { CustomersPage } from './pages/CustomersPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { LicensePage } from './pages/LicensePage.tsx';
import { LicensesPage } from './pages/LicensesPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { BusinessPage } from './pages/BusinessPage.tsx';
import { PlansPage } from './pages/PlansPage.tsx';
import { TeamPage } from './pages/TeamPage.tsx';

function routerFor(me: StaffUser) {
  return createBrowserRouter([
    {
      path: '/',
      element: <Layout me={me} />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'licenses', element: <LicensesPage /> },
        { path: 'licenses/:id', element: <LicensePage /> },
        { path: 'customers', element: <CustomersPage /> },
        { path: 'customers/:id', element: <CustomerPage /> },
        { path: 'plans', element: <PlansPage me={me} /> },
        { path: 'business', element: <BusinessPage me={me} /> },
        { path: 'team', element: <TeamPage me={me} /> },
        { path: 'account', element: <AccountPage me={me} /> },
      ],
    },
  ]);
}

let router: ReturnType<typeof routerFor> | null = null;

export function App() {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.me().catch((e) => (e instanceof ApiError && e.status === 401 ? null : Promise.reject(e))),
  });
  if (me.isPending) return null;
  if (me.isError) return <p className="p-8 text-crimson">{me.error.message}</p>;
  if (!me.data) return <LoginPage />;
  router ??= routerFor(me.data);
  return <RouterProvider router={router} />;
}
