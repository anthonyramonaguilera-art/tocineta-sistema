import React, { useState, useEffect, Suspense } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { RefreshCw, ArrowLeft } from 'lucide-react';
import { canUserProcessPayments } from '@tocineta/shared';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { AuthScreen } from './components/AuthScreen.js';
import { AppLayout } from './components/AppLayout.js';
import { PosView } from './components/PosView.js';
import { ViewErrorBoundary } from './components/ViewErrorBoundary.js';

// Vistas Lazy
const CashierView = React.lazy(() => import('./features/cashier/CashierView.js').then(m => ({ default: m.CashierView })));
const KdsView = React.lazy(() => import('./features/kds/KdsView.js').then(m => ({ default: m.KdsView })));
const MenuAdminView = React.lazy(() => import('./components/MenuAdminView.js').then(m => ({ default: m.MenuAdminView })));
const SystemHealthDashboard = React.lazy(() => import('./components/SystemHealthDashboard.js').then(m => ({ default: m.SystemHealthDashboard })));
const DeferredPaperView = React.lazy(() => import('./features/emergency/DeferredPaperView.js').then(m => ({ default: m.DeferredPaperView })));
const ProfitabilityDashboard = React.lazy(() => import('./features/profitability/ProfitabilityDashboard.js').then(m => ({ default: m.ProfitabilityDashboard })));
const StaffManagementView = React.lazy(() => import('./features/staff/StaffManagementView.js').then(m => ({ default: m.StaffManagementView })));
const QrMenuWebAdminView = React.lazy(() => import('./components/QrMenuWebAdminView.js').then(m => ({ default: m.QrMenuWebAdminView })));
const HomeView = React.lazy(() => import('./features/home/HomeView.js').then(m => ({ default: m.HomeView })));
const UiKitView = React.lazy(() => import('./features/uikit/UiKitView.js').then(m => ({ default: m.UiKitView })));
const AccessQrView = React.lazy(() => import('./features/access/AccessQrView.js').then(m => ({ default: m.AccessQrView })));
const OwnerDashboardView = React.lazy(() => import('./features/owner/OwnerDashboardView.js').then(m => ({ default: m.OwnerDashboardView })));
const FinancesDashboardView = React.lazy(() => import('./features/finances/FinancesDashboardView.js').then(m => ({ default: m.FinancesDashboardView })));
const EventQuotesView = React.lazy(() => import('./features/quotes/EventQuotesView.js').then(m => ({ default: m.EventQuotesView })));
const PartnersManagementView = React.lazy(() => import('./features/partners/PartnersManagementView.js').then(m => ({ default: m.PartnersManagementView })));
const BusinessSettingsView = React.lazy(() => import('./features/settings/BusinessSettingsView.js').then(m => ({ default: m.BusinessSettingsView })));

export type TabType = 'home' | 'pos' | 'cashier' | 'kds' | 'menu-admin' | 'health' | 'emergency' | 'profitability' | 'staff' | 'qr-menu' | 'owner' | 'finances' | 'quotes' | 'partners' | 'settings';

// Mapa canónico de pestañas permitidas y por defecto por rol (Hito M18/M20 RBAC + F1 + F7)
export const ALLOWED_TABS_BY_ROLE: Record<string, TabType[]> = {
  mesonero: ['pos', 'kds', 'health'],
  cocinero: ['kds', 'health'],
  cajera: ['cashier', 'pos', 'kds', 'emergency', 'health'],
  supervisor: ['home', 'pos', 'cashier', 'kds', 'menu-admin', 'staff', 'health', 'emergency', 'profitability', 'qr-menu', 'owner', 'finances', 'quotes', 'partners', 'settings'],
  admin: ['home', 'pos', 'cashier', 'kds', 'menu-admin', 'staff', 'health', 'emergency', 'profitability', 'qr-menu', 'owner', 'finances', 'quotes', 'partners', 'settings']
};

export const DEFAULT_TAB_BY_ROLE: Record<string, TabType> = {
  mesonero: 'pos',
  cocinero: 'kds',
  cajera: 'pos',
  supervisor: 'home',
  admin: 'home'
};

export { canUserProcessPayments };

const ViewLoadingFallback: React.FC = () => (
  <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
    <RefreshCw className="w-7 h-7 text-primary animate-spin" />
    <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
      Cargando módulo...
    </span>
  </div>
);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5000
    }
  }
});

// Guardia de Renderizado para Caja
const CashierRoleGuard: React.FC<{
  user?: any;
  onRedirect: (tab: TabType) => void;
}> = ({ user, onRedirect }) => {
  React.useEffect(() => {
    if (!canUserProcessPayments(user)) {
      const fallbackTab: TabType = user?.role === 'cocinero' ? 'kds' : 'pos';
      onRedirect(fallbackTab);
    }
  }, [user, onRedirect]);

  if (!canUserProcessPayments(user)) {
    return null;
  }

  return <CashierView />;
};

const MainNavigator: React.FC = () => {
  const { user } = useAuth();
  const [currentTab, setCurrentTab] = useState<TabType>(() => {
    if (!user) return 'pos';
    return DEFAULT_TAB_BY_ROLE[user.role] || 'pos';
  });

  const [routeHash, setRouteHash] = useState<string>(() => window.location.hash || window.location.pathname);

  useEffect(() => {
    const handleHashChange = () => {
      const hashStr = window.location.hash || window.location.pathname;
      setRouteHash(hashStr);
      const cleanTab = hashStr.replace(/^[#/]+/, '') as TabType;
      if (['home', 'pos', 'cashier', 'kds', 'profitability', 'menu-admin', 'staff', 'health', 'emergency', 'qr-menu', 'owner', 'finances', 'quotes', 'partners', 'settings'].includes(cleanTab)) {
        setCurrentTab(cleanTab);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handleHashChange);
    handleHashChange();
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('popstate', handleHashChange);
    };
  }, []);

  // Reseteo limpio de pestaña y caché al cambiar de usuario o hacer logout
  React.useEffect(() => {
    if (!user) {
      queryClient.clear();
      setCurrentTab('pos');
      return;
    }
    const defaultTab = DEFAULT_TAB_BY_ROLE[user.role] || 'pos';
    const allowed = [...(ALLOWED_TABS_BY_ROLE[user.role] || ['pos'])];
    if (canUserProcessPayments(user) && !allowed.includes('cashier')) {
      allowed.push('cashier');
    }

    if (!allowed.includes(currentTab)) {
      queryClient.clear();
      setCurrentTab(defaultTab);
    }
  }, [user?.id, user?.role, user?.permissions]);

  // Guardia activa para redireccionar si se intenta entrar a caja sin permisos
  React.useEffect(() => {
    if (currentTab === 'cashier' && user && !canUserProcessPayments(user)) {
      const fallback = user.role === 'cocinero' ? 'kds' : 'pos';
      setCurrentTab(fallback);
    }
  }, [currentTab, user]);

  const { data: menuData } = useQuery<{ formattedRate?: string }>({
    queryKey: ['posMenu'],
    queryFn: async () => {
      const res = await fetch('/api/menu/pos');
      return res.json();
    },
    staleTime: 10000
  });

  // Ruta especial de Desarrollo: /ui-kit o #ui-kit
  if (routeHash === '#ui-kit' || routeHash === '/ui-kit') {
    return (
      <Suspense fallback={<ViewLoadingFallback />}>
        <UiKitView />
      </Suspense>
    );
  }

  // Ruta especial de Acceso Rápido / QR: /acceso o #acceso
  if (routeHash === '#acceso' || routeHash === '/acceso') {
    return (
      <div className="min-h-screen bg-surface-alt p-4">
        <div className="max-w-xl mx-auto mb-4">
          <button
            type="button"
            onClick={() => {
              window.location.hash = '';
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface border border-border text-xs font-bold text-ink hover:bg-surface-alt transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Volver al Sistema</span>
          </button>
        </div>
        <Suspense fallback={<ViewLoadingFallback />}>
          <AccessQrView />
        </Suspense>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <AppLayout
      currentTab={currentTab}
      onTabChange={setCurrentTab}
      formattedRate={menuData?.formattedRate}
    >
      {currentTab === 'home' && (
        <Suspense fallback={<ViewLoadingFallback />}>
          <HomeView
            onNavigate={setCurrentTab}
            formattedRate={menuData?.formattedRate}
            userName={user?.name}
          />
        </Suspense>
      )}
      {currentTab === 'pos' && <PosView />}
      {currentTab !== 'pos' && currentTab !== 'home' && (
        <ViewErrorBoundary
          onFallbackToPos={() => setCurrentTab('pos')}
          viewName={currentTab}
          userId={user?.id}
          userRole={user?.role}
        >
          <Suspense fallback={<ViewLoadingFallback />}>
            {currentTab === 'cashier' && (
              <CashierRoleGuard user={user} onRedirect={setCurrentTab} />
            )}
            {currentTab === 'kds' && <KdsView />}
            {currentTab === 'menu-admin' && <MenuAdminView />}
            {currentTab === 'staff' && <StaffManagementView />}
            {currentTab === 'health' && <SystemHealthDashboard />}
            {currentTab === 'emergency' && <DeferredPaperView />}
            {currentTab === 'profitability' && <ProfitabilityDashboard />}
            {currentTab === 'qr-menu' && <QrMenuWebAdminView />}
            {currentTab === 'owner' && <OwnerDashboardView />}
            {currentTab === 'finances' && <FinancesDashboardView />}
            {currentTab === 'quotes' && <EventQuotesView />}
            {currentTab === 'partners' && <PartnersManagementView />}
            {currentTab === 'settings' && <BusinessSettingsView />}
          </Suspense>
        </ViewErrorBoundary>
      )}
    </AppLayout>
  );
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MainNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
