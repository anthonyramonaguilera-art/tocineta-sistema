import React, { useState, Suspense, Component, type ErrorInfo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { RefreshCw, WifiOff, ArrowLeft } from 'lucide-react';
import { canUserProcessPayments } from '@tocineta/shared';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { AuthScreen } from './components/AuthScreen.js';
import { AppLayout } from './components/AppLayout.js';
import { PosView } from './components/PosView.js';

// SUG-01: Code-splitting con React.lazy() para vistas secundarias/administrativas.
// El Comandero Móvil (PosView) se mantiene en el bundle principal para carga inmediata en teléfonos Android.
const CashierView = React.lazy(() => import('./features/cashier/CashierView.js').then(m => ({ default: m.CashierView })));
const KdsView = React.lazy(() => import('./features/kds/KdsView.js').then(m => ({ default: m.KdsView })));
const MenuAdminView = React.lazy(() => import('./components/MenuAdminView.js').then(m => ({ default: m.MenuAdminView })));
const SystemHealthDashboard = React.lazy(() => import('./components/SystemHealthDashboard.js').then(m => ({ default: m.SystemHealthDashboard })));
const DeferredPaperView = React.lazy(() => import('./features/emergency/DeferredPaperView.js').then(m => ({ default: m.DeferredPaperView })));
const ProfitabilityDashboard = React.lazy(() => import('./features/profitability/ProfitabilityDashboard.js').then(m => ({ default: m.ProfitabilityDashboard })));

export type TabType = 'pos' | 'cashier' | 'kds' | 'menu-admin' | 'health' | 'emergency' | 'profitability';

// Mapa canónico de pestañas permitidas y por defecto por rol (Hito M18 RBAC)
export const ALLOWED_TABS_BY_ROLE: Record<string, TabType[]> = {
  mesonero: ['pos', 'kds', 'health'],
  cocinero: ['kds', 'health'],
  cajera: ['cashier', 'pos', 'kds', 'emergency', 'health'],
  supervisor: ['pos', 'cashier', 'kds', 'menu-admin', 'health', 'emergency', 'profitability'],
  admin: ['pos', 'cashier', 'kds', 'menu-admin', 'health', 'emergency', 'profitability']
};

export const DEFAULT_TAB_BY_ROLE: Record<string, TabType> = {
  mesonero: 'pos',
  cocinero: 'kds',
  cajera: 'cashier',
  supervisor: 'cashier',
  admin: 'pos'
};

export { canUserProcessPayments };

interface ErrorBoundaryProps {
  children: ReactNode;
  onFallbackToPos: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ViewErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ViewErrorBoundary] Error al cargar módulo diferido:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-md mx-auto my-12 p-6 bg-tocineta-card border border-tocineta-yellow/30 rounded-2xl text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400">
            <WifiOff className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-white uppercase tracking-tight">
            Módulo Temporalmente No Disponible
          </h3>
          <p className="text-xs text-tocineta-muted leading-relaxed">
            No se pudo descargar la vista seleccionada. Si el dispositivo perdió la señal Wi-Fi del Food Truck, el Comandero sigue 100% operativo sin interrupción.
          </p>
          <div className="flex gap-2 justify-center pt-2">
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#1A1F2B] border border-tocineta-border hover:border-tocineta-yellow text-white rounded-xl text-xs font-bold uppercase transition"
            >
              <RefreshCw className="w-3.5 h-3.5 text-tocineta-yellow" />
              Reintentar
            </button>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                this.props.onFallbackToPos();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-tocineta-yellow hover:bg-tocineta-yellow-hover text-black rounded-xl text-xs font-bold uppercase transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Volver al Comandero
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const ViewLoadingFallback: React.FC = () => (
  <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
    <RefreshCw className="w-7 h-7 text-tocineta-yellow animate-spin" />
    <span className="text-xs font-semibold text-tocineta-muted uppercase tracking-wider">
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
  userRole?: string;
  onRedirect: (tab: TabType) => void;
}> = ({ userRole, onRedirect }) => {
  React.useEffect(() => {
    if (!canUserProcessPayments(userRole)) {
      const fallbackTab: TabType = userRole === 'cocinero' ? 'kds' : 'pos';
      onRedirect(fallbackTab);
    }
  }, [userRole, onRedirect]);

  if (!canUserProcessPayments(userRole)) {
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

  // Reseteo limpio de pestaña y caché al cambiar de usuario o hacer logout
  React.useEffect(() => {
    if (!user) {
      queryClient.clear();
      setCurrentTab('pos');
      return;
    }
    const defaultTab = DEFAULT_TAB_BY_ROLE[user.role] || 'pos';
    const allowed = ALLOWED_TABS_BY_ROLE[user.role] || ['pos'];
    if (!allowed.includes(currentTab)) {
      queryClient.clear();
      setCurrentTab(defaultTab);
    }
  }, [user?.id, user?.role]);

  // Guardia activa para redireccionar si se intenta entrar a caja sin permisos
  React.useEffect(() => {
    if (currentTab === 'cashier' && user && !canUserProcessPayments(user.role)) {
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

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <AppLayout
      currentTab={currentTab}
      onTabChange={setCurrentTab}
      formattedRate={menuData?.formattedRate}
    >
      {currentTab === 'pos' && <PosView />}
      {currentTab !== 'pos' && (
        <ViewErrorBoundary onFallbackToPos={() => setCurrentTab('pos')}>
          <Suspense fallback={<ViewLoadingFallback />}>
            {currentTab === 'cashier' && (
              <CashierRoleGuard userRole={user?.role} onRedirect={setCurrentTab} />
            )}
            {currentTab === 'kds' && <KdsView />}
            {currentTab === 'menu-admin' && <MenuAdminView />}
            {currentTab === 'health' && <SystemHealthDashboard />}
            {currentTab === 'emergency' && <DeferredPaperView />}
            {currentTab === 'profitability' && <ProfitabilityDashboard />}
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
