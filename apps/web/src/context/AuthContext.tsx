import React, { createContext, useContext, useState, useCallback } from 'react';

export interface UserSession {
  id: string;
  name: string;
  role: 'admin' | 'supervisor' | 'cajera' | 'mesonero' | 'cocinero' | 'despachador';
  mustChangePin?: boolean;
  cedula?: string;
  phone?: string;
  permissions?: string[];
  approvalStatus?: string;
}

interface AuthContextType {
  user: UserSession | null;
  token: string | null;
  currency: 'USD' | 'BS';
  setCurrency: (c: 'USD' | 'BS') => void;
  isSensitiveLocked: boolean;
  login: (credentialsOrUserId: string | { userId?: string; pin?: string; cedula?: string; password?: string }, maybePin?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  unlockSensitive: (pin: string) => Promise<{ success: boolean; error?: string }>;
  changePin: (currentPin: string, newPin: string) => Promise<{ success: boolean; error?: string }>;
  recordUserActivity: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserSession | null>(() => {
    const saved = localStorage.getItem('tocineta_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('tocineta_token');
  });

  const [currency, setCurrency] = useState<'USD' | 'BS'>('USD');
  const isSensitiveLocked = false;

  const recordUserActivity = useCallback(() => {
    // Inactividad deshabilitada: la pantalla jamás se bloquea automáticamente
  }, []);

  const login = async (credentialsOrUserId: string | { userId?: string; pin?: string; cedula?: string; password?: string }, maybePin?: string) => {
    try {
      const payload = typeof credentialsOrUserId === 'string'
        ? { userId: credentialsOrUserId, pin: maybePin }
        : credentialsOrUserId;

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        return {
          success: false,
          error: data.message || data.error || 'Error al iniciar sesión'
        };
      }

      setUser(data.user);
      setToken(data.token);
      localStorage.setItem('tocineta_user', JSON.stringify(data.user));
      localStorage.setItem('tocineta_token', data.token);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error de conexión LAN con el servidor' };
    }
  };

  const logout = async () => {
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` }
        });
      } catch {}
    }

    setUser(null);
    setToken(null);
    localStorage.removeItem('tocineta_user');
    localStorage.removeItem('tocineta_token');
  };

  const unlockSensitive = async (_pin: string) => {
    return { success: true };
  };

  const changePin = async (currentPin: string, newPin: string) => {
    if (!token) return { success: false, error: 'No hay sesión activa' };

    try {
      const res = await fetch('/api/auth/change-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ currentPin, newPin })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'Error al cambiar PIN' };
      }

      if (user) {
        const updatedUser = { ...user, mustChangePin: false };
        setUser(updatedUser);
        localStorage.setItem('tocineta_user', JSON.stringify(updatedUser));
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error al cambiar PIN' };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        currency,
        setCurrency,
        isSensitiveLocked,
        login,
        logout,
        unlockSensitive,
        changePin,
        recordUserActivity
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider');
  }
  return context;
};
