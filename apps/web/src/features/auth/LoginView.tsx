import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { Card, Button, Input, Field, Icon, Modal } from '../../ui/index.js';
import { WorkerRegisterForm } from './WorkerRegisterForm.js';

const QUICK_PROFILES = [
  { username: 'admin', label: 'ADMIN' },
  { username: 'cajera', label: 'CAJERA' },
  { username: 'mesero', label: 'MESERO' },
  { username: 'plancha', label: 'PLANCHA' },
  { username: 'despacho', label: 'DESPACHO' }
];

export const LoginView: React.FC = () => {
  const { login, user, changePin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Perfiles rápidos: solo si están activos en ajustes (por defecto apagado)
  const [quickLoginEnabled, setQuickLoginEnabled] = useState(false);

  // Modal para cambio obligatorio de clave / PIN semilla
  const [showChangePinModal, setShowChangePinModal] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [changePinError, setChangePinError] = useState<string | null>(null);
  const [changingPin, setChangingPin] = useState(false);

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
    if (user?.mustChangePin) {
      setShowChangePinModal(true);
    }
  }, [user?.mustChangePin]);

  const handleSelectQuickProfile = (profileUsername: string) => {
    setUsername(profileUsername);
    setErrorMessage(null);
    if (passwordInputRef.current) {
      passwordInputRef.current.focus();
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = username.trim();
    const cleanPass = password.trim();

    if (!cleanUser) {
      setErrorMessage('Por favor ingresa tu usuario.');
      return;
    }
    if (!cleanPass) {
      setErrorMessage('Por favor ingresa tu contraseña o clave de acceso.');
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

  const handleChangePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePinError(null);

    if (newPin.length < 4) {
      setChangePinError('La nueva clave o PIN debe tener al menos 4 caracteres.');
      return;
    }
    if (newPin !== confirmPin) {
      setChangePinError('Las claves no coinciden.');
      return;
    }

    setChangingPin(true);
    const result = await changePin(currentPin || password, newPin);
    setChangingPin(false);

    if (result.success) {
      setShowChangePinModal(false);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } else {
      setChangePinError(result.error || 'Error al actualizar clave.');
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
                      const isSelected = username.toLowerCase() === p.username;
                      return (
                        <button
                          key={p.username}
                          type="button"
                          onClick={() => handleSelectQuickProfile(p.username)}
                          className={`min-h-[34px] px-3 py-1 rounded-xl text-xs font-black transition-all border ${
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

              <Field label="Contraseña / PIN" required error={undefined}>
                <Input
                  ref={passwordInputRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrorMessage(null);
                  }}
                  placeholder="Ingresa tu clave de acceso"
                  leftIcon={<Icon name="Lock" size={18} />}
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-ink-muted hover:text-ink p-1 rounded transition-colors"
                      title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
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
                rightIcon={<Icon name="ArrowRight" size={18} />}
              >
                Iniciar Sesión
              </Button>

              <div className="pt-3 border-t border-border text-center">
                <button
                  type="button"
                  onClick={() => setIsRegistering(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink font-bold transition-colors"
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

      {/* Modal Obligatorio: Primer inicio obliga a cambiar clave semilla */}
      <Modal
        isOpen={showChangePinModal}
        onClose={() => {}}
        title="Cambio Obligatorio de Clave"
      >
        <form onSubmit={handleChangePinSubmit} className="space-y-4">
          <p className="text-xs text-ink-muted">
            Por seguridad de la sede, tu cuenta requiere cambiar la contraseña inicial antes de operar el sistema.
          </p>

          <Field label="Nueva Clave o PIN" required>
            <Input
              type="password"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder="Mínimo 4 dígitos o letras"
              required
            />
          </Field>

          <Field label="Confirmar Nueva Clave" required>
            <Input
              type="password"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              placeholder="Repite la nueva clave"
              required
            />
          </Field>

          {changePinError && (
            <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold text-center">
              {changePinError}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={changingPin}
          >
            Actualizar Clave y Continuar
          </Button>
        </form>
      </Modal>
    </div>
  );
};

export default LoginView;
