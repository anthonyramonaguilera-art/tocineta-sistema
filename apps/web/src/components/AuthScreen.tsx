import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { FaithBanner } from './FaithBanner.js';
import { User, Lock, Eye, EyeOff, UserPlus, ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';

const QUICK_PROFILES = [
  { username: 'admin', label: 'ADMIN', color: 'hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400' },
  { username: 'cajera', label: 'CAJERA', color: 'hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400' },
  { username: 'mesero', label: 'MESERO', color: 'hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400' },
  { username: 'plancha', label: 'PLANCHA', color: 'hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400' },
  { username: 'despacho', label: 'DESPACHO', color: 'hover:border-purple-500 hover:text-purple-600 dark:hover:text-purple-400' }
];

export const AuthScreen: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Registro de nuevo trabajador
  const [isRegistering, setIsRegistering] = useState(false);
  const [registeredSuccess, setRegisteredSuccess] = useState(false);
  const [regName, setRegName] = useState('');
  const [regCedula, setRegCedula] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  const passwordInputRef = useRef<HTMLInputElement>(null);

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
      setErrorMessage('Por favor ingresa tu usuario o selecciona un perfil rápido.');
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

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regCedula.trim() || !regPassword.trim()) {
      setRegError('Por favor completa tu nombre, cédula y contraseña.');
      return;
    }
    setRegLoading(true);
    setRegError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName.trim(),
          cedula: regCedula.trim(),
          phone: regPhone.trim(),
          password: regPassword.trim()
        })
      });
      const resData = await res.json();
      if (!res.ok || !resData.success) {
        setRegError(resData.message || resData.error || 'Error al procesar el registro');
        return;
      }
      setRegisteredSuccess(true);
    } catch {
      setRegError('Error de conexión local con el servidor');
    } finally {
      setRegLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0D11] text-slate-900 dark:text-slate-100 flex flex-col select-none transition-colors duration-200">
      <FaithBanner />

      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md">
          {/* Encabezado e Identidad Oficial */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2.5 bg-white dark:bg-[#161922] px-5 py-2.5 rounded-full border border-slate-200 dark:border-neutral-800 shadow-sm mb-3">
              <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 11a8 8 0 0 1 16 0H4z" />
                  <path d="M4 14h16" />
                  <rect x="4" y="18" width="16" height="3" rx="1.5" />
                </svg>
              </div>
              <span className="font-black text-base tracking-widest text-slate-900 dark:text-amber-400">TOCINETA</span>
              <span className="bg-slate-100 dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 px-2 py-0.5 rounded-md text-[10px] text-slate-600 dark:text-slate-300 font-mono font-bold">
                POS
              </span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {isRegistering ? 'Solicitud de Personal' : 'Inicio de Sesión'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
              {isRegistering ? 'Ingresa tus datos para solicitar acceso a la sede' : 'Sistema Operativo Gastronómico'}
            </p>
          </div>

          {/* Tarjeta Central del Formulario */}
          <div className="bg-white dark:bg-[#161922] border border-slate-200 dark:border-neutral-800 rounded-3xl p-6 sm:p-8 shadow-xl shadow-slate-200/50 dark:shadow-black/50">
            {!isRegistering ? (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                {/* Campo Usuario */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">
                    Usuario
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        setErrorMessage(null);
                      }}
                      placeholder="Ej: admin, cajera, mesero..."
                      autoCapitalize="none"
                      autoCorrect="off"
                      className="w-full min-h-[48px] pl-10 pr-4 rounded-xl bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 text-slate-900 dark:text-white text-sm font-bold focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all"
                      autoFocus
                    />
                  </div>

                  {/* Botones de Autocompletado Rápido en 1 Toque */}
                  <div className="mt-2.5">
                    <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                      Perfiles Rápidos:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_PROFILES.map((p) => {
                        const isSelected = username.toLowerCase() === p.username;
                        return (
                          <button
                            key={p.username}
                            type="button"
                            onClick={() => handleSelectQuickProfile(p.username)}
                            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-black transition-all border ${
                              isSelected
                                ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-sm'
                                : `bg-slate-100 dark:bg-neutral-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-neutral-700 ${p.color}`
                            }`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Campo Contraseña */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wide">
                    Contraseña / Clave de Acceso
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                    <input
                      ref={passwordInputRef}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setErrorMessage(null);
                      }}
                      placeholder="Ingresa tu clave o PIN"
                      className="w-full min-h-[48px] pl-10 pr-11 rounded-xl bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 text-slate-900 dark:text-white text-sm font-mono font-bold focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md transition-colors"
                      title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Mensaje de Error */}
                {errorMessage && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-semibold text-center">
                    {errorMessage}
                  </div>
                )}

                {/* Botón Principal de Inicio de Sesión */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full min-h-[52px] mt-2 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-slate-950 font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isLoading ? (
                    <span>Verificando...</span>
                  ) : (
                    <>
                      <span>Iniciar Sesión</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {/* Enlace para solicitar registro */}
                <div className="pt-3 border-t border-slate-100 dark:border-neutral-800 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setIsRegistering(true);
                      setRegisteredSuccess(false);
                      setRegError(null);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 font-bold transition-colors"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>¿Eres nuevo empleado? Solicitar acceso</span>
                  </button>
                </div>
              </form>
            ) : registeredSuccess ? (
              <div className="text-center py-4 space-y-4">
                <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 dark:text-white text-base">Solicitud Registrada</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                    Tu cuenta está en espera de aprobación por parte de la administración. Una vez aprobada podrás ingresar directamente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsRegistering(false)}
                  className="min-h-[46px] w-full rounded-xl bg-slate-100 dark:bg-neutral-800 hover:bg-slate-200 dark:hover:bg-neutral-700 text-slate-800 dark:text-slate-200 font-bold text-xs uppercase transition-all"
                >
                  Volver al Inicio de Sesión
                </button>
              </div>
            ) : (
              <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Nombre Completo
                  </label>
                  <input
                    type="text"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Ej: Juan Pérez"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 text-slate-900 dark:text-white text-xs font-bold focus:border-amber-500 outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Cédula de Identidad
                  </label>
                  <input
                    type="text"
                    value={regCedula}
                    onChange={(e) => setRegCedula(e.target.value)}
                    placeholder="Ej: 12345678"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 text-slate-900 dark:text-white text-xs font-mono font-bold focus:border-amber-500 outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Teléfono (Opcional)
                  </label>
                  <input
                    type="text"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    placeholder="Ej: 04141234567"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 text-slate-900 dark:text-white text-xs font-mono font-bold focus:border-amber-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Contraseña / PIN Deseado
                  </label>
                  <input
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Mínimo 4 caracteres o números"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 text-slate-900 dark:text-white text-xs font-mono font-bold focus:border-amber-500 outline-none"
                    required
                  />
                </div>

                {regError && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-semibold text-center">
                    {regError}
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsRegistering(false)}
                    className="flex-1 min-h-[48px] rounded-xl border border-slate-200 dark:border-neutral-700 text-slate-700 dark:text-slate-300 font-bold text-xs uppercase hover:bg-slate-50 dark:hover:bg-neutral-800 transition-all flex items-center justify-center gap-1.5"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Volver</span>
                  </button>
                  <button
                    type="submit"
                    disabled={regLoading}
                    className="flex-1 min-h-[48px] rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20 transition-all disabled:opacity-50"
                  >
                    {regLoading ? 'Enviando...' : 'Registrar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};