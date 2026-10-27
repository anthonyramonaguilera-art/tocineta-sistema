import React, { useState } from 'react';
import { Card, Button, Badge, Icon } from '../../ui/index.js';

interface OperationalManualsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OperationalManualsModal: React.FC<OperationalManualsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'admin' | 'cajera' | 'mesonero' | 'contingencia'>('admin');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-ink/40 backdrop-blur-xs select-none animate-in fade-in duration-200">
      <Card variant="surface" className="w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl border-2 border-border">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Icon name="BookOpen" size={22} />
            </div>
            <div>
              <h3 className="text-base font-black text-ink">Manuales Operativos de 1 Página</h3>
              <p className="text-xs text-ink-muted">Procedimientos estándar blindados por rol dentro de la aplicación.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg bg-surface-alt flex items-center justify-center text-ink-muted hover:text-ink">
            <Icon name="X" size={16} />
          </button>
        </div>

        {/* Pestañas por Rol */}
        <div className="flex border-b border-border bg-surface-alt/40 p-1.5 gap-1.5 overflow-x-auto text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('admin')}
            className={`min-h-[44px] px-4 rounded-xl font-bold flex items-center gap-2 transition-all ${
              activeTab === 'admin' ? 'bg-surface text-primary shadow-xs font-black' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Icon name="Shield" size={16} /> Administradora
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cajera')}
            className={`min-h-[44px] px-4 rounded-xl font-bold flex items-center gap-2 transition-all ${
              activeTab === 'cajera' ? 'bg-surface text-primary shadow-xs font-black' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Icon name="DollarSign" size={16} /> Cajera
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mesonero')}
            className={`min-h-[44px] px-4 rounded-xl font-bold flex items-center gap-2 transition-all ${
              activeTab === 'mesonero' ? 'bg-surface text-primary shadow-xs font-black' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Icon name="Utensils" size={16} /> Mesonero y Cocina
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('contingencia')}
            className={`min-h-[44px] px-4 rounded-xl font-bold flex items-center gap-2 transition-all ${
              activeTab === 'contingencia' ? 'bg-surface text-danger shadow-xs font-black' : 'text-ink-muted hover:text-ink'
            }`}
          >
            <Icon name="AlertTriangle" size={16} /> Apagón y Respaldo
          </button>
        </div>

        {/* Contenido de 1 Página */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 text-xs text-ink space-y-4 leading-relaxed">
          {activeTab === 'admin' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <h4 className="font-black text-sm uppercase tracking-wide text-ink">Manual Operativo: Administradora</h4>
                <Badge variant="primary">1 PÁGINA</Badge>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border space-y-1.5">
                  <span className="font-extrabold text-ink block">1. Inicio de Jornada y Tasa Oficial</span>
                  <p className="text-ink-muted text-[11px]">
                    Verifica la apertura de turno desde el POS o Cierre Z. La tasa del BCV se sincroniza automáticamente a las 13:00 hrs o puede ajustarse con un clic en caso de variación cambiaria.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border space-y-1.5">
                  <span className="font-extrabold text-ink block">2. Supervisión de Costos y Carta</span>
                  <p className="text-ink-muted text-[11px]">
                    En "Carta y Precios", activa o desactiva disponibilidad según stock en bodega. Si un plato se marca sin stock, desaparece de inmediato del Menú QR público.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border space-y-1.5">
                  <span className="font-extrabold text-ink block">3. Liquidación de Nómina y Propinas</span>
                  <p className="text-ink-muted text-[11px]">
                    El módulo de Personal calcula: <em>Neto = Base + Bonos − Adelantos − Consumos</em>. Selecciona cuáles consumos cobrar o perdonar y emite el comprobante oficial en PDF.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border space-y-1.5">
                  <span className="font-extrabold text-ink block">4. Respaldo Diario al Cerrar Turno</span>
                  <p className="text-ink-muted text-[11px]">
                    Al completar el Cierre Z, descarga la copia de respaldo cifrada en pendrive o nube. Garantiza cero pérdida de datos fiscales y contables.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'cajera' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <h4 className="font-black text-sm uppercase tracking-wide text-ink">Manual Operativo: Cajera</h4>
                <Badge variant="primary">1 PÁGINA</Badge>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border space-y-1.5">
                  <span className="font-extrabold text-ink block">1. Cobro Multimoneda Blindado</span>
                  <p className="text-ink-muted text-[11px]">
                    El sistema permite cobros divididos en Dólares Efectivo y Bolívares (Pago Móvil / Punto). Cada pedido congela la tasa oficial con la que fue creado.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border space-y-1.5">
                  <span className="font-extrabold text-ink block">2. Impresión Inmediata de Comanda</span>
                  <p className="text-ink-muted text-[11px]">
                    Al procesar el cobro, el ticket de turno con número gigante se imprime automáticamente en 58mm y la comanda viaja a la estación de cocina (Plancha/Hot Dogs).
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border space-y-1.5">
                  <span className="font-extrabold text-ink block">3. Cuadre Ciego de Caja</span>
                  <p className="text-ink-muted text-[11px]">
                    Al finalizar el turno, ingresa el dinero físico contado sin ver el monto esperado del sistema. El Cierre Z comparará automáticamente y generará el acta auditada.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'mesonero' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <h4 className="font-black text-sm uppercase tracking-wide text-ink">Manual Operativo: Mesonero y Cocina</h4>
                <Badge variant="primary">1 PÁGINA</Badge>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border space-y-1.5">
                  <span className="font-extrabold text-ink block">1. Toma de Pedido Touch-First (POS)</span>
                  <p className="text-ink-muted text-[11px]">
                    Usa botones grandes táctiles. Selecciona mesa o para llevar, agrega platos con modificadores (ej. SIN cebolla, EXTRA queso) y presiona "Enviar a Cocina".
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border space-y-1.5">
                  <span className="font-extrabold text-ink block">2. KDS Pantalla Táctil en Cocina</span>
                  <p className="text-ink-muted text-[11px]">
                    Los pedidos aparecen agrupados por estación (Hamburguesas / Hot Dogs / Bebidas). Toca la tarjeta de la orden para marcarla "En Preparación" o "Lista para Despacho".
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border space-y-1.5">
                  <span className="font-extrabold text-ink block">3. Despacho y Entrega por Turno</span>
                  <p className="text-ink-muted text-[11px]">
                    Llama al comensal por el número de turno impreso en su nota de entrega. Al entregar, presiona "Cerrar Orden" en la pantalla de despacho.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'contingencia' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <h4 className="font-black text-sm uppercase tracking-wide text-danger">Protocolo ante Apagón y Restauración</h4>
                <Badge variant="danger">EMERGENCIA</Badge>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-danger/10 border border-danger/30 space-y-1.5">
                  <span className="font-extrabold text-danger block">1. Corte de Luz o Falla Total (Sin Sistema)</span>
                  <p className="text-ink text-[11px]">
                    Usa el Talonario de Papel de Emergencia preimpreso (disponible en /emergencia). Cada boleta tiene número correlativo único. Anota plato, monto cobrado y método en físico.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border space-y-1.5">
                  <span className="font-extrabold text-ink block">2. Recuperación al Restablecerse la Energía</span>
                  <p className="text-ink-muted text-[11px]">
                    Abre el módulo "Talonario Contingencia" y transcribe las boletas físicas en orden numérico. El sistema recalcula ingresos, cuadra caja y actualiza stock sin alterar cierres anteriores.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-surface-alt/50 border border-border space-y-1.5">
                  <span className="font-extrabold text-ink block">3. Restauración de Respaldo por CLI</span>
                  <p className="text-ink-muted text-[11px]">
                    En caso de daño en disco duro, ejecuta en PowerShell: <code className="bg-surface px-1.5 py-0.5 rounded font-mono font-bold">pnpm run restore:cli --backup=C:\ruta\backup.tar.gz</code>. El motor valida integridad SQLite y la cadena de bloques antes de restaurar.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex items-center justify-end bg-surface-alt/30">
          <Button type="button" variant="primary" size="md" onClick={onClose} className="min-h-[48px] px-6 font-black">
            Cerrar Manual
          </Button>
        </div>
      </Card>
    </div>
  );
};
