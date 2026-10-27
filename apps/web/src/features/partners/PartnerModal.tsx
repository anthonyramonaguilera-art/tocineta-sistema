import React, { useState } from 'react';
import { Card, Button, Icon } from '../../ui/index.js';
import { useCreatePartner } from './usePartnersData.js';

interface PartnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const PartnerModal: React.FC<PartnerModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const createMutation = useCreatePartner();

  const [name, setName] = useState('');
  const [docId, setDocId] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sharePercentage, setSharePercentage] = useState(25);
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('El nombre del socio es obligatorio');
      return;
    }
    if (sharePercentage <= 0 || sharePercentage > 100) {
      alert('El porcentaje de participación debe estar entre 0.1% y 100%');
      return;
    }

    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        docId: docId.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        sharePercentage,
        notes: notes.trim() || undefined
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Error al guardar socio');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-xs select-none animate-in fade-in duration-200">
      <Card variant="surface" className="w-full max-w-md shadow-2xl border-2 border-border">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Icon name="UserPlus" size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-ink">Registrar Nuevo Socio</h3>
              <p className="text-xs text-ink-muted">Aporte de capital y reparto por porcentaje.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-alt flex items-center justify-center text-ink-muted hover:text-ink">
            <Icon name="X" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          <div>
            <label className="block text-[11px] font-bold text-ink-muted mb-1">Nombre Completo del Socio *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Socio Capitalista A"
              className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-bold"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-ink-muted mb-1">Cédula / RIF</label>
              <input
                type="text"
                value={docId}
                onChange={(e) => setDocId(e.target.value)}
                placeholder="V-12345678"
                className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink-muted mb-1">% de Participación *</label>
              <div className="relative">
                <input
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  required
                  value={sharePercentage}
                  onChange={(e) => setSharePercentage(parseFloat(e.target.value) || 0)}
                  className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 pr-7 text-xs text-ink outline-none focus:border-primary font-extrabold text-primary"
                />
                <span className="absolute right-3 top-3 font-bold text-ink-muted">%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-ink-muted mb-1">Teléfono</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="04141234567"
                className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink-muted mb-1">Correo Electrónico</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="socio@correo.com"
                className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-ink-muted mb-1">Notas / Observaciones</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Condiciones del aporte o acuerdos societarios..."
              className="w-full rounded-xl border border-border bg-surface p-2 text-xs text-ink outline-none focus:border-primary resize-none"
            />
          </div>

          <div className="pt-2 border-t border-border flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="md" onClick={onClose} className="min-h-[48px]">
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={createMutation.isPending}
              className="min-h-[48px] px-5 font-black"
              leftIcon={<Icon name="Check" size={18} />}
            >
              {createMutation.isPending ? 'Guardando...' : 'Registrar Socio'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
