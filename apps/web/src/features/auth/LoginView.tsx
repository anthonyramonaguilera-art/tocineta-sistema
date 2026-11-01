import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { Card, Button, Input, Field, Icon } from '../../ui/index.js';
import { WorkerRegisterForm } from './WorkerRegisterForm.js';
import { ChangePinModal } from './ChangePinModal.js';
import { getRequiredPinLength } from './pin-utils.js';
import { apiFetch } from '../../api/client.js';

const QUICK_PROFILES = [
  { username: 'admin', label: 'ADMIN' },
  { username: 'cajera', label: 'CAJERA' },
  { username: 'mesero', label: 'MESERO' },
  { username: 'plancha', label: 'PLANCHA' },
  { username: 'despacho', label: 'DESPACHO' }
];

interface PublicUser {
  id: string;
  name: string;
  role: string;
  pinLength?: number;
}

export const LoginView: React.FC = () => {
  const { login, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Perfiles rápidos: solo si están activos en ajustes (por defecto apagado)
  const [quickLoginEnabled, setQuickLoginEnabled] = useState(false);

  // Usuarios públicos para determinar pinLength
  const [publicUsers, setPublicUsers] = useState<PublicUser[]>([]);

  // Registro de nuevo empleado
  const [isRegistering, setIsRegistering] = useState(false);

  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('tocineta_quick_login');
    if (saved === 'true') {
      setQuickLoginEnabled(true);
    }
  }, []);

  useEffect(() => {
    let unmounted = false;
    apiFetch('/api/auth/users-public')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!unmounted && data?.users && Array.isArray(data.users)) {
          setPublicUsers(data.users);
        }
      })
      .catch(() => {});
    return () => {
      unmounted = true;
    };
  }, []);

  const cleanUser = username.trim();
  const matchedUser = publicUsers.find(
    (u) =>
      u.name.toLowerCase() === cleanUser.toLowerCase() ||
      u.role.toLowerCase() === cleanUser.toLowerCase() ||
      u.id.toLowerCase() === cleanUser.toLowerCase()
  );

  const expectedPinLength = getRequiredPinLength(
    matchedUser || {
      role: cleanUser.toLowerCase() === 'admin' || cleanUser.toLowerCase() === 'supervisor' ? 'admin' : undefined
    }
  );

  const handleSelectQuickProfile = (profileUsername: string) => {
    setUsername(profileUsername);
    setPassword('');
    setErrorMessage(null);
    if (passwordInputRef.current) {
      passwordInputRef.current.focus();
    }
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Solo dígitos: filtra la entrada, no permite letras
    const cleanDigits = e.target.value.replace(/\D/g, '').slice(0, expectedPinLength);
    setPassword(cleanDigits);
    setErrorMessage(null);
  };

  const handlePasswordPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    // Solo dígitos: filtra lo pegado
    const cleanDigits = pasted.replace(/\D/g, '').slice(0, expectedPinLength);
    setPassword(cleanDigits);
    setErrorMessage(null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPass = password.trim();

    if (!cleanUser) {
      setErrorMessage('Por favor ingresa tu usuario.');
      return;
    }
    if (!cleanPass) {
      setErrorMessage('Por favor ingresa tu PIN de acceso.');
      return;
    }

    if (!/^\d+$/.test(cleanPass)) {
      setErrorMessage('El PIN debe contener únicamente dígitos numéricos.');
      return;
    }

    if (cleanPass.length !== expectedPinLength) {
      setErrorMessage(`El PIN debe tener exactamente ${expectedPinLength} dígitos.`);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const result = await login({
      username: cleanUser,
      password: cleanPass
    });

    setIsLoading(false);

    if (!result.success) {
      setErrorMessage(result.error || 'Credenciales incorrectas');
    }
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-center items-center p-4 sm:p-6 select-none">
      <div className="w-full max-w-md space-y-6">
        {/* Identidad de Marca Oficial */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            {/* Logo adaptativo: logo-light en tema claro, logo-dark en tema oscuro */}
            <picture>
              <source srcSet="/brand/logo-dark.png" media="(prefers-color-scheme: dark)" />
              <img
                src="/brand/logo-light.png"
                alt="TOCINETA"
                className="h-16 w-auto object-contain dark:hidden"
              />
            </picture>
            <img
              src="/brand/logo-dark.png"
              alt="TOCINETA"
              className="h-16 w-auto object-contain hidden dark:block"
            />
          </div>
          <h1 className="text-xl font-black text-ink tracking-tight uppercase">
            {isRegistering ? 'Solicitud de Personal' : 'Acceso al Sistema'}
          </h1>
          <p className="text-xs text-ink-muted font-medium">
            {isRegistering ? 'Completa tus datos para solicitar alta de usuario' : 'Sistema Operativo Gastronómico'}
          </p>
        </div>

        {/* Tarjeta de Formulario */}
        <Card variant="surface" className="p-6 sm:p-8 shadow-xl border border-border">
          {!isRegistering ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <Field label="Usuario" required error={undefined}>
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setPassword('');
                    setErrorMessage(null);
                  }}
                  placeholder="Ej: admin, cajera, mesero..."
                  autoCapitalize="none"
                  autoCorrect="off"
                  leftIcon={<Icon name="User" size={18} />}
                  autoFocus
                />
              </Field>

              {/* Perfiles Rápidos: Solo si están activados en ajustes */}
              {quickLoginEnabled && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider block">
                    Perfiles Rápidos:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_PROFILES.map((p) => {
                      const isSelected = cleanUser.toLowerCase() === p.username;
                      return (
                        <button
                          key={p.username}
                          type="button"
                          onClick={() => handleSelectQuickProfile(p.username)}
                          className={`min-h-[48px] px-3.5 py-1.5 rounded-xl text-xs font-black transition-all border ${
                            isSelected
                              ? 'bg-primary text-primary-ink border-primary shadow-sm'
                              : 'bg-surface-alt text-ink border-border hover:border-primary/50'
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <Field label={`PIN (${expectedPinLength} dígitos)`} required error={undefined}>
                <Input
                  ref={passwordInputRef}
                  type={showPassword ? 'text' : 'password'}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={expectedPinLength}
                  value={password}
                  onChange={handlePasswordChange}
                  onPaste={handlePasswordPaste}
                  placeholder={`Ingresa PIN de ${expectedPinLength} dígitos`}
                  leftIcon={<Icon name="Lock" size={18} />}
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-ink-muted hover:text-ink p-1 rounded transition-colors"
                      title={showPassword ? 'Ocultar PIN' : 'Ver PIN'}
                    >
                      <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={18} />
                    </button>
                  }
                />
              </Field>

              {errorMessage && (
                <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold text-center">
                  {errorMessage}
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={isLoading}
                className="min-h-[48px]"
                rightIcon={<Icon name="ArrowRight" size={18} />}
              >
                Iniciar Sesión
              </Button>

              <div className="pt-3 border-t border-border text-center">
                <button
                  type="button"
                  onClick={() => setIsRegistering(true)}
                  className="min-h-[48px] inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink font-bold transition-colors"
                >
                  <Icon name="UserPlus" size={15} />
                  <span>¿Nuevo empleado? Solicitar acceso</span>
                </button>
              </div>
            </form>
          ) : (
            <WorkerRegisterForm onBack={() => setIsRegistering(false)} />
          )}
        </Card>
      </div>

      {/* Modal Obligatorio y No Descartable de Cambio de PIN */}
      <ChangePinModal
        isOpen={Boolean(user?.mustChangePin)}
        initialCurrentPin={password}
      />
    </div>
  );
};

export default LoginView;
