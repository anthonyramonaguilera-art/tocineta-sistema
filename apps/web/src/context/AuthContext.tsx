import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

export interface UserSession {
  id: string;
  name: string;
  role: 'admin' | 'supervisor' | 'cajera' | 'mesonero' | 'cocinero' | 'despachador';
  mustChangePin?: boolean;
}

interface AuthContextType {
  user: UserSession | null;
  token: string | null;
  currency: 'USD' | 'BS';
  setCurrency: (c: 'USD' | 'BS') => void;
  isSensitiveLocked: boolean;
  login: (userId: string, pin: string) => Promise<{ success: boolean; error?: string }>;
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
  const [isSensitiveLocked, setIsSensitiveLocked] = useState(false);

  const lastActivityRef = useRef<number>(Date.now());
  const timerRef = useRef<any>(null);

  const recordUserActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // Monitor de Auto-Lock por 2 minutos de inactividad (120,000 ms)
  useEffect(() => {
    if (!user || (user.role !== 'admin' && user.role !== 'supervisor')) {
      return;
    }

    const checkInactivity = () => {
      const now = Date.now();
      const elapsed = now - lastActivityRef.current;
      if (elapsed >= 120_000 && !isSensitiveLocked) {
        setIsSensitiveLocked(true);
      }
    };

    timerRef.current = setInterval(checkInactivity, 5000);

    const onActivity = () => {
      if (!isSensitiveLocked) {
        lastActivityRef.current = Date.now();
      }
    };

    window.addEventListener('mousemove', onActivity);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('touchstart', onActivity);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('touchstart', onActivity);
    };
  }, [user, isSensitiveLocked]);

  const login = async (userId: string, pin: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, pin })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'Error al iniciar sesión' };
      }

      setUser(data.user);
      setToken(data.token);
      localStorage.setItem('tocineta_user', JSON.stringify(data.user));
      localStorage.setItem('tocineta_token', data.token);
      setIsSensitiveLocked(false);
      lastActivityRef.current = Date.now();

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
    setIsSensitiveLocked(false);
    localStorage.removeItem('tocineta_user');
    localStorage.removeItem('tocineta_token');
  };

  const unlockSensitive = async (pin: string) => {
    if (!user) return { success: false, error: 'No hay usuario autenticado' };

    try {
      const res = await fetch('/api/auth/verify-action-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorizerUserId: user.id,
          pin,
          action: 'UNLOCK_SENSITIVE_VIEW'
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'PIN incorrecto' };
      }

      setIsSensitiveLocked(false);
      lastActivityRef.current = Date.now();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error al verificar PIN' };
    }
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
