import React from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Header } from './components/Header.js';
import { SystemHealthDashboard } from './components/SystemHealthDashboard.js';
import { fetchSystemHealth } from './api/client.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 2000
    }
  }
});

const AppContent: React.FC = () => {
  const { data, isSuccess } = useQuery({
    queryKey: ['systemHealthHeader'],
    queryFn: fetchSystemHealth,
    refetchInterval: 3000
  });

  return (
    <div className="min-h-screen bg-tocineta-bg text-white flex flex-col font-sans">
      <Header
        localTimeCaracas={data?.systemTime.localTimeCaracas}
        isOnline={isSuccess}
      />
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <SystemHealthDashboard />
      </main>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
};

export default App;
