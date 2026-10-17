import React, { useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { AuthScreen } from './components/AuthScreen.js';
import { AppLayout } from './components/AppLayout.js';
import { PosView } from './components/PosView.js';
import { MenuAdminView } from './components/MenuAdminView.js';
import { SystemHealthDashboard } from './components/SystemHealthDashboard.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5000
    }
  }
});

const MainNavigator: React.FC = () => {
  const { user } = useAuth();
  const [currentTab, setCurrentTab] = useState<'pos' | 'menu-admin' | 'health'>('pos');

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
      {currentTab === 'menu-admin' && <MenuAdminView />}
      {currentTab === 'health' && <SystemHealthDashboard />}
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
