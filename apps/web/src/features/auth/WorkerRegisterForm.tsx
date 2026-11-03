import React, { useState } from 'react';
import { Button, Input, Field, Icon } from '../../ui/index.js';
import { apiFetch } from '../../api/client.js';

interface WorkerRegisterFormProps {
  onBack: () => void;
}

export const WorkerRegisterForm: React.FC<WorkerRegisterFormProps> = ({ onBack }) => {
  const [registeredSuccess, setRegisteredSuccess] = useState(false);
  const [regName, setRegName] = useState('');
  const [regCedula, setRegCedula] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPin, setRegPin] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regCedula.trim() || !regPassword.trim() || !regPin.trim()) {
      setRegError('Por favor completa tu nombre, cédula, contraseña y PIN de 4 dígitos.');
      return;
    }
    setRegLoading(true);
    setRegError(null);
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName.trim(),
          cedula: regCedula.trim(),
          phone: regPhone.trim(),
          password: regPassword.trim(),
          pin: regPin.trim()
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

  if (registeredSuccess) {
    return (
      <div className="text-center py-4 space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-success/20 border border-success/30 flex items-center justify-center text-success">
          <Icon name="ShieldCheck" size={24} />
        </div>
        <div className="space-y-1">
          <h3 className="font-black text-ink text-base">Solicitud Enviada</h3>
          <p className="text-xs text-ink-muted leading-relaxed">
            Tu usuario está pendiente de aprobación por el Administrador.
          </p>
        </div>
        <Button variant="secondary" fullWidth onClick={onBack}>
          Volver al Acceso
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleRegisterSubmit} className="space-y-3">
      <Field label="Nombre Completo" required>
        <Input
          value={regName}
          onChange={(e) => setRegName(e.target.value)}
          placeholder="Ej: Juan Pérez"
          required
        />
      </Field>
      <Field label="Cédula de Identidad" required>
        <Input
          value={regCedula}
          onChange={(e) => setRegCedula(e.target.value)}
          placeholder="Ej: 12345678"
          required
        />
      </Field>
      <Field label="Teléfono (Opcional)">
        <Input
          value={regPhone}
          onChange={(e) => setRegPhone(e.target.value)}
          placeholder="Ej: 04141234567"
        />
      </Field>
      <Field label="Contraseña Deseada" required>
        <Input
          type="password"
          value={regPassword}
          onChange={(e) => setRegPassword(e.target.value)}
          placeholder="Mínimo 4 caracteres"
          required
        />
      </Field>
      <Field label="PIN de Acceso (4 dígitos)" required>
        <Input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={regPin}
          onChange={(e) => setRegPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="Ej: 5824"
          className="min-h-[48px]"
          required
        />
      </Field>

      {regError && (
        <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-bold text-center">
          {regError}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          className="flex-1"
          onClick={onBack}
          leftIcon={<Icon name="ArrowLeft" size={16} />}
        >
          Volver
        </Button>
        <Button
          type="submit"
          variant="primary"
          className="flex-1"
          loading={regLoading}
        >
          Registrar
        </Button>
      </div>
    </form>
  );
};

export default WorkerRegisterForm;
