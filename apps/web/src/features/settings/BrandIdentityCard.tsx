import React, { useState, useRef } from 'react';
import { Card, Button, Icon } from '../../ui/index.js';
import { apiFetch } from '../../api/client.js';

interface BrandIdentityCardProps {
  businessName: string;
  onChangeBusinessName: (val: string) => void;
  rif: string;
  onChangeRif: (val: string) => void;
  slogan: string;
  onChangeSlogan: (val: string) => void;
  primaryColor: string;
  onChangePrimaryColor: (val: string) => void;
  logoUrl: string;
  onChangeLogoUrl: (val: string) => void;
  disabled?: boolean;
}

export const BrandIdentityCard: React.FC<BrandIdentityCardProps> = ({
  businessName,
  onChangeBusinessName,
  rif,
  onChangeRif,
  slogan,
  onChangeSlogan,
  primaryColor,
  onChangePrimaryColor,
  logoUrl,
  onChangeLogoUrl,
  disabled = false
}) => {
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [logoStatus, setLogoStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setLogoStatus('Formato no soportado. Debe ser JPG, PNG o WEBP.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setLogoStatus('El archivo excede el tamaño máximo permitido de 2 MB.');
      return;
    }

    setLogoStatus(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      setLogoPreview(base64);
      setIsUploading(true);
      try {
        const res = await apiFetch('/api/business-settings/logo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64 })
        });
        const resData = await res.json();
        if (!res.ok || !resData.success) {
          throw new Error(resData.error || resData.message || 'Error al subir logo');
        }
        const uploadedUrl = resData.logo_url || resData.imageUrl;
        onChangeLogoUrl(uploadedUrl);
        setLogoStatus('Guardado');
        setTimeout(() => setLogoStatus(null), 3500);
      } catch (err: any) {
        setLogoStatus(err?.message || 'Error al subir imagen');
        setLogoPreview(null);
      } finally {
        setIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <Card variant="surface" className="p-5 border border-border space-y-4">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <Icon name="Building2" size={18} className="text-primary" />
        <h3 className="font-extrabold text-sm text-ink uppercase tracking-wide">
          1. Identidad de Marca y Eslogan
        </h3>
      </div>

      {/* Cargador de Logo Web / QR */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl border border-border bg-surface-alt/40">
        <div className="w-20 h-20 rounded-xl border border-border bg-surface flex items-center justify-center overflow-hidden shrink-0">
          {logoPreview || logoUrl ? (
            <img
              src={logoPreview || logoUrl}
              alt="Logo para Menú Web y QR"
              className="w-full h-full object-contain"
            />
          ) : (
            <Icon name="Building2" size={28} className="text-ink-muted" />
          )}
        </div>

        <div className="flex-1 space-y-1">
          <span className="font-extrabold text-xs text-ink block">
            Logo para Menú Web y QR
          </span>
          <p className="text-[11px] text-ink-muted">
            JPG, PNG o WEBP (máx. 2 MB). No afecta el logotipo monocromático del ticket térmico.
          </p>
          {logoStatus && (
            <div className={`text-xs font-bold flex items-center gap-1.5 mt-1 ${logoStatus === 'Guardado' ? 'text-success' : 'text-danger'}`}>
              <Icon name={logoStatus === 'Guardado' ? 'CheckCircle' : 'AlertCircle'} size={14} />
              <span>{logoStatus}</span>
            </div>
          )}
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png, image/jpeg, image/webp"
            onChange={handleLogoSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={isUploading || disabled}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[48px] px-4 text-xs font-bold"
            leftIcon={<Icon name={isUploading ? 'Upload' : 'Camera'} size={16} />}
          >
            {isUploading ? 'Subiendo logo...' : (logoUrl ? 'Cambiar Logo' : 'Subir Logo')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
        <div>
          <label className="block text-[11px] font-bold text-ink-muted mb-1">Nombre Comercial de la Marca *</label>
          <input
            type="text"
            required
            value={businessName}
            onChange={(e) => onChangeBusinessName(e.target.value)}
            placeholder="TOCINETA"
            className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-black uppercase"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-ink-muted mb-1">Registro de Información Fiscal (RIF)</label>
          <input
            type="text"
            value={rif}
            onChange={(e) => onChangeRif(e.target.value)}
            placeholder="V-17040918-0"
            className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-mono font-bold"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11px] font-bold text-ink-muted mb-1">Eslogan Oficial</label>
          <input
            type="text"
            value={slogan}
            onChange={(e) => onChangeSlogan(e.target.value)}
            placeholder="Cocinamos con amor y servimos como mereces"
            className="w-full min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs text-ink outline-none focus:border-primary font-medium"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-ink-muted mb-1">Color Corporativo</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={primaryColor}
              onChange={(e) => onChangePrimaryColor(e.target.value)}
              className="w-11 h-11 rounded-xl border border-border cursor-pointer bg-surface p-1"
            />
            <input
              type="text"
              value={primaryColor}
              onChange={(e) => onChangePrimaryColor(e.target.value)}
              className="w-28 min-h-[44px] rounded-xl border border-border bg-surface px-3 text-xs font-mono font-bold text-ink"
            />
          </div>
        </div>
      </div>
    </Card>
  );
};
