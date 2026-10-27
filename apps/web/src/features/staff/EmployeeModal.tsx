import React, { useState } from 'react';
import { Modal } from '../../ui/Modal.js';
import { Button } from '../../ui/Button.js';
import { Input } from '../../ui/Input.js';
import { Select } from '../../ui/Select.js';
import { Field } from '../../ui/Field.js';

interface EmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    username: string;
    role: string;
    pin: string;
    salaryScheme: string;
    baseSalaryUsdCents: number;
  }) => Promise<void>;
}

export const EmployeeModal: React.FC<EmployeeModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('mesonero');
  const [pin, setPin] = useState('');
  const [salaryScheme, setSalaryScheme] = useState('SEMANAL');
  const [baseSalaryUsd, setBaseSalaryUsd] = useState('50.00');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('El nombre real del empleado es obligatorio');
      return;
    }

    const cleanUsername = username.trim() || name.trim().toLowerCase().replace(/\s+/g, '.');
    if (cleanUsername.length < 3) {
      setError('El usuario individual debe tener al menos 3 caracteres');
      return;
    }

    if (!/^\d{4,6}$/.test(pin.trim())) {
      setError('El PIN debe tener 4 o 6 dígitos numéricos');
      return;
    }

    const baseCents = Math.round((parseFloat(baseSalaryUsd) || 0) * 100);

    try {
      setIsSubmitting(true);
      await onSubmit({
        name: name.trim(),
        username: cleanUsername,
        role,
        pin: pin.trim(),
        salaryScheme,
        baseSalaryUsdCents: baseCents
      });
      setName('');
      setUsername('');
      setPin('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al crear trabajador');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Nuevo Empleado Individual"
      description="Crea una cuenta con nombre real, PIN y esquema salarial (sin cuentas genéricas)"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl text-xs font-bold text-danger">
            {error}
          </div>
        )}

        <Field label="Nombre Completo" required>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!username) {
                setUsername(e.target.value.toLowerCase().replace(/\s+/g, '.'));
              }
            }}
            placeholder="Ej: María Gómez"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Usuario Único" required hint="Para inicio de sesión">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
              placeholder="maria.gomez"
            />
          </Field>

          <Field label="Rol Inicial" required>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              options={[
                { value: 'mesonero', label: 'Mesero' },
                { value: 'cajera', label: 'Cajera' },
                { value: 'cocinero', label: 'Cocinero (Plancha)' },
                { value: 'despachador', label: 'Despacho' },
                { value: 'supervisor', label: 'Supervisor' }
              ]}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="PIN de Acceso (4 o 6 dígitos)" required hint="Clave privada del trabajador">
            <Input
              type="password"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
            />
          </Field>

          <Field label="Frecuencia de Nómina">
            <Select
              value={salaryScheme}
              onChange={(e) => setSalaryScheme(e.target.value)}
              options={[
                { value: 'DIARIO', label: 'Diario' },
                { value: 'SEMANAL', label: 'Semanal' },
                { value: 'QUINCENAL', label: 'Quincenal' }
              ]}
            />
          </Field>
        </div>

        <Field label="Salario Base por Período (USD)" hint="Monto fijo acordado">
          <Input
            type="number"
            step="0.01"
            min="0"
            value={baseSalaryUsd}
            onChange={(e) => setBaseSalaryUsd(e.target.value)}
            placeholder="50.00"
          />
        </Field>

        <div className="flex gap-2 justify-end pt-3 border-t border-border">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            Crear Empleado
          </Button>
        </div>
      </form>
    </Modal>
  );
};
