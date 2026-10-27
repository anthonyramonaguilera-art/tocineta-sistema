import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useFinancesQueries(selectedLocation: string, startDateMs: number, selectedCustomerForStatement: string | null, userId: string) {
  const queryClient = useQueryClient();

  const { data: numbersData } = useQuery({
    queryKey: ['finances', 'owner-numbers', selectedLocation],
    queryFn: async () => {
      const res = await fetch(`/api/finances/owner-numbers?locationId=${selectedLocation}`);
      const json = await res.json();
      return json.data;
    }
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['finances', 'categories'],
    queryFn: async () => {
      const res = await fetch('/api/finances/categories');
      const json = await res.json();
      return json.data || [];
    }
  });

  const { data: expensesData, isLoading: loadingExpenses } = useQuery({
    queryKey: ['finances', 'expenses', selectedLocation, startDateMs],
    queryFn: async () => {
      const res = await fetch(`/api/finances/expenses?locationId=${selectedLocation}&startDateMs=${startDateMs}`);
      const json = await res.json();
      return json.data || [];
    }
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers', 'list'],
    queryFn: async () => {
      const res = await fetch('/api/menu/customers');
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    }
  });

  const { data: receivablesData, isLoading: loadingReceivables } = useQuery({
    queryKey: ['finances', 'receivables', selectedLocation],
    queryFn: async () => {
      const res = await fetch(`/api/finances/receivables?locationId=${selectedLocation}`);
      const json = await res.json();
      return json.data || [];
    }
  });

  const { data: payablesData, isLoading: loadingPayables } = useQuery({
    queryKey: ['finances', 'payables', selectedLocation],
    queryFn: async () => {
      const res = await fetch(`/api/finances/payables?locationId=${selectedLocation}`);
      const json = await res.json();
      return json.data || [];
    }
  });

  const { data: pnlData, isLoading: loadingPnl } = useQuery({
    queryKey: ['finances', 'pnl', selectedLocation, startDateMs],
    queryFn: async () => {
      const res = await fetch(`/api/finances/profit-loss?locationId=${selectedLocation}&startDateMs=${startDateMs}`);
      const json = await res.json();
      return json.data;
    }
  });

  const { data: cashFlowData, isLoading: loadingCashFlow } = useQuery({
    queryKey: ['finances', 'cashflow', selectedLocation, startDateMs],
    queryFn: async () => {
      const res = await fetch(`/api/finances/cash-flow?locationId=${selectedLocation}&startDateMs=${startDateMs}`);
      const json = await res.json();
      return json.data;
    }
  });

  const { data: closuresData, isLoading: loadingClosures } = useQuery({
    queryKey: ['finances', 'closures', selectedLocation],
    queryFn: async () => {
      const res = await fetch(`/api/finances/closures?locationId=${selectedLocation}`);
      const json = await res.json();
      return json.data || [];
    }
  });

  const { data: statementData } = useQuery({
    queryKey: ['finances', 'statement', selectedCustomerForStatement],
    queryFn: async () => {
      if (!selectedCustomerForStatement) return null;
      const res = await fetch(`/api/finances/customers/${selectedCustomerForStatement}/statement`);
      const json = await res.json();
      return json.data;
    },
    enabled: Boolean(selectedCustomerForStatement)
  });

  const saveExpenseMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/finances/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Error al guardar gasto');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finances'] })
  });

  const saveReceivableMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/finances/receivables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Error al crear cuenta por cobrar');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finances'] })
  });

  const saveReceivablePaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/finances/receivables/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Error al procesar abono');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finances'] })
  });

  const savePayablePaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/finances/payables/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Error al procesar pago al proveedor');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finances'] })
  });

  const createClosureMutation = useMutation({
    mutationFn: async ({ year, month, notes }: { year: number; month: number; notes?: string }) => {
      const res = await fetch('/api/finances/closures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, locationId: selectedLocation, userId, notes })
      });
      if (!res.ok) throw new Error('Error al crear cierre mensual');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finances', 'closures'] })
  });

  return {
    numbersData,
    categoriesData,
    expensesData,
    loadingExpenses,
    customersData,
    receivablesData,
    loadingReceivables,
    payablesData,
    loadingPayables,
    pnlData,
    loadingPnl,
    cashFlowData,
    loadingCashFlow,
    closuresData,
    loadingClosures,
    statementData,
    saveExpenseMutation,
    saveReceivableMutation,
    saveReceivablePaymentMutation,
    savePayablePaymentMutation,
    createClosureMutation
  };
}
