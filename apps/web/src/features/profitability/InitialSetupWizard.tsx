import React, { useState } from 'react';
import { Card, Button, Input, Field, Icon, Badge } from '../../ui/index.js';
import { CsvDataImportCard } from './components/CsvDataImportCard.js';
import { ResetProductionModals } from './components/ResetProductionModals.js';

interface InitialSetupWizardProps {
  onFinish?: () => void;
  activeLocationId: string;
}

const STEPS = [
  { step: 1, label: 'Insumos', desc: 'Unidades y factores' },
  { step: 2, label: 'Proveedores', desc: 'Directorio de compras' },
  { step: 3, label: 'Recetas', desc: 'Modos y rendimientos' },
  { step: 4, label: 'Costos', desc: 'Márgenes objetivo' },
  { step: 5, label: 'Stock Inicial', desc: 'Carga por sede' }
];

export const InitialSetupWizard: React.FC<InitialSetupWizardProps> = ({
  onFinish,
  activeLocationId
}) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);

  // Paso 1: Insumo rápido
  const [quickSupplyName, setQuickSupplyName] = useState('');
  const [quickPurchaseUnit, setQuickPurchaseUnit] = useState('paquete');
  const [quickUsageUnit, setQuickUsageUnit] = useState('und');
  const [quickFactor, setQuickFactor] = useState('1');
  const [quickCostUsd, setQuickCostUsd] = useState('2.50');

  // Paso 2: Proveedor rápido
  const [quickSupplierName, setQuickSupplierName] = useState('');
  const [quickSupplierRif, setQuickSupplierRif] = useState('');

  // Paso 4: Margen objetivo global
  const [globalTargetMargin, setGlobalTargetMargin] = useState('65');

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Cabecera del Asistente */}
      <div className="bg-surface p-4 rounded-2xl border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon name="Sparkles" size={20} className="text-primary" />
            <h2 className="text-sm font-bold text-ink uppercase tracking-wider">
              Asistente: Configura tu Negocio
            </h2>
          </div>
          <p className="text-xs text-ink-muted mt-0.5">
            Carga inicial guiada de insumos, proveedores, recetas, márgenes y stock.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsResetModalOpen(true)}
            leftIcon={<Icon name="Trash2" size={14} className="text-danger" />}
          >
            Limpiar BD (Prod)
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsDemoModalOpen(true)}
            leftIcon={<Icon name="PlayCircle" size={14} />}
          >
            Sembrar Demo
          </Button>
        </div>
      </div>

      {/* Indicador de 5 Pasos */}
      <div className="grid grid-cols-5 gap-1.5 bg-surface-alt p-1.5 rounded-2xl border border-border">
        {STEPS.map((s) => (
          <button
            key={s.step}
            type="button"
            onClick={() => setCurrentStep(s.step)}
            className={`p-2 rounded-xl text-left transition-all ${
              currentStep === s.step
                ? 'bg-surface shadow-xs border border-border text-ink'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider block">
              Paso {s.step}
            </div>
            <div className="text-xs font-bold truncate">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Contenido Dinámico por Paso */}
      <Card className="p-5 space-y-4">
        {currentStep === 1 && (
          <div className="space-y-4">
            <div className="border-b border-border pb-3">
              <h3 className="text-sm font-bold text-ink">Paso 1: Catálogo de Insumos</h3>
              <p className="text-xs text-ink-muted">
                Configura los insumos comprados (ej: caja, kg) y su conversión a unidad de uso (ej: unidad, g).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Nombre del Insumo">
                <Input
                  value={quickSupplyName}
                  onChange={(e) => setQuickSupplyName(e.target.value)}
                  placeholder="Ej: Pan Brioche Artesanal"
                />
              </Field>

              <Field label="Costo Estimado USD">
                <Input
                  type="number"
                  step="0.01"
                  value={quickCostUsd}
                  onChange={(e) => setQuickCostUsd(e.target.value)}
                  placeholder="2.50"
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Unidad Compra">
                <Input
                  value={quickPurchaseUnit}
                  onChange={(e) => setQuickPurchaseUnit(e.target.value)}
                  placeholder="paquete"
                />
              </Field>
              <Field label="Unidad Uso">
                <Input
                  value={quickUsageUnit}
                  onChange={(e) => setQuickUsageUnit(e.target.value)}
                  placeholder="und"
                />
              </Field>
              <Field label="Factor Conversión">
                <Input
                  type="number"
                  value={quickFactor}
                  onChange={(e) => setQuickFactor(e.target.value)}
                  placeholder="10"
                />
              </Field>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-4">
            <div className="border-b border-border pb-3">
              <h3 className="text-sm font-bold text-ink">Paso 2: Directorio de Proveedores</h3>
              <p className="text-xs text-ink-muted">
                Registra tus aliados comerciales para compras de contado o a crédito.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Razón Social / Nombre">
                <Input
                  value={quickSupplierName}
                  onChange={(e) => setQuickSupplierName(e.target.value)}
                  placeholder="Ej: Distribuidora Avícola Bolívar"
                />
              </Field>
              <Field label="RIF / Identificación Fiscal">
                <Input
                  value={quickSupplierRif}
                  onChange={(e) => setQuickSupplierRif(e.target.value)}
                  placeholder="J-50182736-1"
                />
              </Field>
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-4">
            <div className="border-b border-border pb-3">
              <h3 className="text-sm font-bold text-ink">Paso 3: Fichas Técnicas de Recetas</h3>
              <p className="text-xs text-ink-muted">
                Vincula los productos de la carta a sus insumos para descuento automático al cobrar.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-surface-alt border border-border flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-ink block">
                  Gestión Rápida de Recetas
                </span>
                <span className="text-[11px] text-ink-muted">
                  Puedes configurar las recetas completas desde la pestaña de Recetas o importar por Excel.
                </span>
              </div>
              <Badge variant="brand">3 Modos Activos</Badge>
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-4">
            <div className="border-b border-border pb-3">
              <h3 className="text-sm font-bold text-ink">Paso 4: Costeo y Margen Objetivo</h3>
              <p className="text-xs text-ink-muted">
                Establece la política de rentabilidad. El sistema calculará el precio sugerido automáticamente.
              </p>
            </div>

            <Field label="Margen Bruto Objetivo Global (%)" required>
              <Input
                type="number"
                step="1"
                value={globalTargetMargin}
                onChange={(e) => setGlobalTargetMargin(e.target.value)}
                placeholder="65"
              />
            </Field>

            <div className="p-3 rounded-xl bg-surface-alt text-xs text-ink-muted">
              Si un plato cuesta $3.50 en insumos y tu margen es 65%, el precio sugerido será:{' '}
              <strong className="text-ink ml-1 font-mono">${(3.5 / 0.35).toFixed(2)} USD</strong>.
            </div>
          </div>
        )}

        {currentStep === 5 && (
          <div className="space-y-4">
            <div className="border-b border-border pb-3">
              <h3 className="text-sm font-bold text-ink">Paso 5: Carga de Stock Inicial</h3>
              <p className="text-xs text-ink-muted">
                Establece las existencias físicas para iniciar operaciones en Sede A y Sede B.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-surface-alt border border-border flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-ink block">
                  Inventario Inicial por Sede
                </span>
                <span className="text-[11px] text-ink-muted">
                  Usa la carga masiva CSV abajo o la pantalla de inventario para registrar ajustes iniciales.
                </span>
              </div>
              <Badge variant="neutral">Inmutable</Badge>
            </div>
          </div>
        )}

        {/* Carga Masiva CSV */}
        <CsvDataImportCard activeLocationId={activeLocationId} />

        {/* Botones de Navegación del Asistente */}
        <div className="flex justify-between items-center pt-3 border-t border-border">
          <Button
            variant="ghost"
            disabled={currentStep === 1}
            onClick={() => setCurrentStep((s) => s - 1)}
          >
            ← Anterior
          </Button>

          {currentStep < 5 ? (
            <Button
              variant="primary"
              onClick={() => setCurrentStep((s) => s + 1)}
            >
              Siguiente →
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={onFinish}
            >
              Finalizar Asistente
            </Button>
          )}
        </div>
      </Card>

      {/* Modales de Producción y Demo */}
      <ResetProductionModals
        isResetOpen={isResetModalOpen}
        onCloseReset={() => setIsResetModalOpen(false)}
        isDemoOpen={isDemoModalOpen}
        onCloseDemo={() => setIsDemoModalOpen(false)}
      />
    </div>
  );
};

export default InitialSetupWizard;
