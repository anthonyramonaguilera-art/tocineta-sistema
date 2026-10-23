import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.js';
import { Receipt, Printer, ShieldCheck, FileEdit } from 'lucide-react';

interface ProductItem {
  id: string;
  name: string;
  priceUsdCents: number;
  station: string;
}

export const DeferredPaperView: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [slipNumber, setSlipNumber] = useState('');
  const [realDate, setRealDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [realTime, setRealTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [fulfillmentType, setFulfillmentType] = useState<'salon' | 'para_llevar' | 'delivery'>('salon');
  const [tableNumber, setTableNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [orderLines, setOrderLines] = useState<Array<{ productId: string; name: string; quantity: number; unitPriceUsdCents: number }>>([]);

  const [paymentMethod, setPaymentMethod] = useState<'cash_usd' | 'cash_bs' | 'pago_movil' | 'ubii' | 'binance'>('cash_usd');
  const [paidAmountUsd, setPaidAmountUsd] = useState('');
  const [refCode, setRefCode] = useState('');

  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Cargar catálogo para seleccionar productos (soporta data.products y data.categories.flatMap)
  const { data: menuData } = useQuery<any>({
    queryKey: ['posProducts'],
    queryFn: async () => {
      const res = await fetch('/api/menu/pos');
      return res.json();
    }
  });

  // Cargar historial de comandas diferidas ya cargadas
  const { data: deferredData, refetch: refetchDeferred } = useQuery<{ orders: any[] }>({
    queryKey: ['deferredOrders'],
    queryFn: async () => {
      const res = await fetch('/api/emergency/deferred-orders');
      return res.json();
    }
  });

  const products: ProductItem[] = React.useMemo(() => {
    if (!menuData) return [];
    if (Array.isArray(menuData.products) && menuData.products.length > 0) {
      return menuData.products.map((p: any) => ({
        id: p.id,
        name: p.name,
        priceUsdCents: p.priceUsdCents ?? p.price_usd_cents ?? 0,
        station: p.station || 'hot_dogs'
      }));
    }
    if (Array.isArray(menuData.categories)) {
      return menuData.categories.flatMap((cat: any) =>
        (cat.products || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          priceUsdCents: p.priceUsdCents ?? p.price_usd_cents ?? 0,
          categoryName: cat.name,
          station: p.station || 'hot_dogs'
        }))
      );
    }
    return [];
  }, [menuData]);

  const handleAddLine = () => {
    if (!selectedProductId) return;
    const prod = products.find((p) => p.id === selectedProductId);
    if (!prod) return;

    setOrderLines((prev) => [
      ...prev,
      {
        productId: prod.id,
        name: prod.name,
        quantity: Math.max(1, quantity),
        unitPriceUsdCents: prod.priceUsdCents
      }
    ]);
    setSelectedProductId('');
    setQuantity(1);
  };

  const handleRemoveLine = (idx: number) => {
    setOrderLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const totalUsdCents = orderLines.reduce((sum, l) => sum + l.unitPriceUsdCents * l.quantity, 0);

  // Mutación para transcribir comanda de papel
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!slipNumber.trim()) {
        throw new Error('Debe indicar el número de comanda física (ej. #EMG-001)');
      }
      if (orderLines.length === 0) {
        throw new Error('Debe agregar al menos un producto a la comanda');
      }

      const realTimestamp = new Date(`${realDate}T${realTime}:00`).getTime();
      if (isNaN(realTimestamp)) {
        throw new Error('La fecha y hora indicada no es válida');
      }

      const parsedPaid = parseFloat(paidAmountUsd);
      const paidCents = !isNaN(parsedPaid) && parsedPaid > 0 ? Math.round(parsedPaid * 100) : totalUsdCents;

      const payload = {
        emergencySlipNumber: slipNumber.trim(),
        realCreatedAtMs: realTimestamp,
        fulfillmentType,
        tableNumber: tableNumber || null,
        customerName: customerName || null,
        notes: notes || null,
        lines: orderLines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity
        })),
        tenders: [
          {
            method: paymentMethod,
            amountCents: paidCents,
            referenceCode: refCode || undefined
          }
        ]
      };

      const res = await fetch('/api/emergency/deferred-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al transcribir comanda');
      }
      return data;
    },
    onSuccess: (data) => {
      setStatusMessage({
        type: 'success',
        text: `Comanda ${data.data?.slipNumber} transcrita exitosamente (Orden #${data.data?.order?.order_number}) y auditada como 'deferred_paper_entry'.`
      });
      // Limpiar formulario
      setSlipNumber('');
      setTableNumber('');
      setCustomerName('');
      setNotes('');
      setOrderLines([]);
      setPaidAmountUsd('');
      setRefCode('');
      refetchDeferred();
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err: any) => {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Error en la transcripción'
      });
    }
  });

  // Mutación para respaldar ahora con age
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const handleBackupNow = async () => {
    try {
      setBackupStatus('Cifrando y exportando respaldo...');
      const res = await fetch('/api/backups/export-encrypted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al respaldar');
      setBackupStatus(`Respaldo cifrado exitoso: ${data.backup?.filename} (${(data.backup?.fileSizeBytes / 1024).toFixed(1)} KB)`);
    } catch (e: any) {
      setBackupStatus(`Error: ${e.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Encabezado y Acciones de Contingencia */}
      <div className="bg-tocineta-card border border-tocineta-border p-5 rounded-2xl flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div>
          <div className="flex items-center gap-2">
            <Receipt className="w-7 h-7 text-amber-400" />
            <h1 className="text-xl font-black text-white tracking-wide">
              MODO EMERGENCIA Y CARGA DIFERIDA DE PAPEL
            </h1>
          </div>
          <p className="text-sm text-tocineta-muted mt-1">
            Transcripción post-apagón por {user?.name || 'Personal Autorizado'} de comandas numeradas (#EMG-001 a #EMG-200) con hora real y auditoría estricta.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Botón Descargar PDF Talonario */}
          <a
            href="/api/emergency/slips-pdf?count=200"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2.5 bg-tocineta-bg border border-tocineta-yellow/50 text-tocineta-yellow hover:bg-tocineta-yellow hover:text-tocineta-bg rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow-sm"
          >
            <Printer className="w-4 h-4" />
            <span>Descargar 200 Comandas (PDF)</span>
          </a>

          {/* Botón Respaldar Ahora */}
          <button
            onClick={handleBackupNow}
            className="px-4 py-2.5 bg-tocineta-green/20 border border-tocineta-green/50 text-tocineta-green hover:bg-tocineta-green hover:text-tocineta-bg rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow-sm"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Respaldar Ahora (age USB)</span>
          </button>
        </div>
      </div>

      {backupStatus && (
        <div className="p-3 rounded-xl bg-tocineta-bg border border-tocineta-border text-xs text-tocineta-yellow font-mono">
          {backupStatus}
        </div>
      )}

      {statusMessage && (
        <div
          className={`p-4 rounded-xl text-sm font-bold flex items-center justify-between ${
            statusMessage.type === 'success'
              ? 'bg-tocineta-green/20 border border-tocineta-green text-tocineta-green'
              : 'bg-red-500/20 border border-red-500 text-red-300'
          }`}
        >
          <span>{statusMessage.text}</span>
          <button onClick={() => setStatusMessage(null)} className="text-xs underline ml-4">
            Cerrar
          </button>
        </div>
      )}

      {/* Cuadrícula Principal: Formulario de Carga Diferida e Historial */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Formulario de Carga */}
        <div className="lg:col-span-2 bg-tocineta-card border border-tocineta-border rounded-2xl p-6 shadow-md space-y-5">
          <h2 className="text-base font-extrabold text-tocineta-yellow flex items-center gap-2 border-b border-tocineta-border pb-3">
            <FileEdit className="w-5 h-5 text-tocineta-yellow" />
            <span>Transcribir Comanda Física de Papel</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Número de comanda */}
            <div>
              <label className="block text-xs font-bold text-tocineta-muted mb-1">
                Número de Comanda *
              </label>
              <input
                type="text"
                placeholder="Ej. #EMG-001 o 1"
                value={slipNumber}
                onChange={(e) => setSlipNumber(e.target.value)}
                className="w-full bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl px-3 py-2 text-sm text-white font-mono font-bold"
              />
            </div>

            {/* Fecha real */}
            <div>
              <label className="block text-xs font-bold text-tocineta-muted mb-1">
                Fecha del Suceso *
              </label>
              <input
                type="date"
                value={realDate}
                onChange={(e) => setRealDate(e.target.value)}
                className="w-full bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl px-3 py-2 text-sm text-white"
              />
            </div>

            {/* Hora real */}
            <div>
              <label className="block text-xs font-bold text-tocineta-muted mb-1">
                Hora Real del Pedido *
              </label>
              <input
                type="time"
                value={realTime}
                onChange={(e) => setRealTime(e.target.value)}
                className="w-full bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl px-3 py-2 text-sm text-white font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-tocineta-muted mb-1">
                Tipo de Pedido
              </label>
              <select
                value={fulfillmentType}
                onChange={(e) => setFulfillmentType(e.target.value as any)}
                className="w-full bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl px-3 py-2 text-sm text-white"
              >
                <option value="salon">Salón</option>
                <option value="para_llevar">Para Llevar</option>
                <option value="delivery">Delivery</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-tocineta-muted mb-1">
                Mesa / Cliente
              </label>
              <input
                type="text"
                placeholder="Mesa 3 / Carlos"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                className="w-full bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl px-3 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-tocineta-muted mb-1">
                Nombre Cliente (Opcional)
              </label>
              <input
                type="text"
                placeholder="Nombre o teléfono"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl px-3 py-2 text-sm text-white"
              />
            </div>
          </div>

          {/* Selector de Renglones de Productos */}
          <div className="border border-tocineta-border rounded-xl p-4 bg-tocineta-bg/50 space-y-3">
            <label className="block text-xs font-bold text-tocineta-yellow">
              Agregar Productos de la Comanda
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="flex-1 min-w-[200px] bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl px-3 py-2 text-sm text-white"
              >
                <option value="">-- Seleccionar Producto --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — ${(p.priceUsdCents / 100).toFixed(2)}
                  </option>
                ))}
              </select>

              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
                className="w-20 bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl px-3 py-2 text-sm text-white text-center font-bold"
              />

              <button
                type="button"
                onClick={handleAddLine}
                className="px-4 py-2 bg-tocineta-yellow text-tocineta-bg font-extrabold text-xs rounded-xl hover:bg-yellow-400 transition-colors"
              >
                + Agregar
              </button>
            </div>

            {/* Lista de productos agregados */}
            {orderLines.length > 0 ? (
              <div className="mt-3 divide-y divide-tocineta-border/60">
                {orderLines.map((line, idx) => (
                  <div key={idx} className="py-2 flex items-center justify-between text-sm">
                    <div>
                      <span className="font-bold text-white">{line.quantity}x </span>
                      <span>{line.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-tocineta-yellow">
                        ${((line.unitPriceUsdCents * line.quantity) / 100).toFixed(2)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(idx)}
                        className="text-red-400 hover:text-red-300 text-xs font-bold"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}

                <div className="pt-2 flex justify-between font-extrabold text-base">
                  <span>TOTAL ESTIMADO:</span>
                  <span className="text-tocineta-yellow font-mono">
                    ${(totalUsdCents / 100).toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-tocineta-muted italic pt-1">
                No hay productos agregados a la comanda todavía.
              </p>
            )}
          </div>

          {/* Método de Pago y Monto */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-tocineta-border pt-4">
            <div>
              <label className="block text-xs font-bold text-tocineta-muted mb-1">
                Método de Pago Usado
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as any)}
                className="w-full bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl px-3 py-2 text-sm text-white"
              >
                <option value="cash_usd">Efectivo Dólares (USD)</option>
                <option value="cash_bs">Efectivo Bolívares (Bs)</option>
                <option value="pago_movil">Pago Móvil (Banesco)</option>
                <option value="ubii">Punto Ubii</option>
                <option value="binance">Binance Pay</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-tocineta-muted mb-1">
                Monto Pagado (USD)
              </label>
              <input
                type="number"
                step="0.01"
                placeholder={(totalUsdCents / 100).toFixed(2)}
                value={paidAmountUsd}
                onChange={(e) => setPaidAmountUsd(e.target.value)}
                className="w-full bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl px-3 py-2 text-sm text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-tocineta-muted mb-1">
                Referencia / Comprobante
              </label>
              <input
                type="text"
                placeholder="Ej. 123456"
                value={refCode}
                onChange={(e) => setRefCode(e.target.value)}
                className="w-full bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl px-3 py-2 text-sm text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-tocineta-muted mb-1">
              Notas Adicionales de la Comanda
            </label>
            <input
              type="text"
              placeholder="Detalles sobre modificaciones o instrucciones del cliente"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-tocineta-bg border border-tocineta-border focus:border-tocineta-yellow rounded-xl px-3 py-2 text-sm text-white"
            />
          </div>

          <button
            type="button"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending}
            className="w-full py-3.5 bg-tocineta-yellow text-tocineta-bg font-black rounded-xl text-sm hover:bg-yellow-400 active:scale-[0.99] transition-all shadow-lg flex items-center justify-center gap-2"
          >
            <span>📝</span>
            <span>
              {submitMutation.isPending ? 'Registrando en Auditoría...' : 'GUARDAR Y AUDITAR COMANDA DE PAPEL'}
            </span>
          </button>
        </div>

        {/* Panel Lateral: Comandas Diferidas Ya Cargadas */}
        <div className="bg-tocineta-card border border-tocineta-border rounded-2xl p-5 shadow-md flex flex-col">
          <div className="flex items-center justify-between border-b border-tocineta-border pb-3 mb-4">
            <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
              <span>🗂️</span>
              <span>Comandas de Papel Transcritas</span>
            </h3>
            <span className="text-xs bg-tocineta-bg border border-tocineta-border px-2 py-0.5 rounded font-mono text-tocineta-yellow">
              {deferredData?.orders?.length || 0}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 max-h-[500px]">
            {deferredData?.orders && deferredData.orders.length > 0 ? (
              deferredData.orders.map((ord: any) => (
                <div
                  key={ord.id}
                  className="p-3 bg-tocineta-bg border border-tocineta-border/80 rounded-xl space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-tocineta-yellow text-sm font-mono">
                      {ord.emergency_slip_number}
                    </span>
                    <span className="text-[11px] text-tocineta-green font-bold">
                      Orden #{ord.order_number}
                    </span>
                  </div>

                  <div className="text-xs text-tocineta-muted flex items-center justify-between">
                    <span>Ocurrió:</span>
                    <span className="text-white font-mono">
                      {new Date(ord.created_at_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="text-xs text-tocineta-muted flex items-center justify-between">
                    <span>Monto Total:</span>
                    <span className="font-bold text-white font-mono">
                      ${(ord.total_to_collect_usd_cents / 100).toFixed(2)}
                    </span>
                  </div>

                  <div className="text-[10px] text-tocineta-muted pt-1 border-t border-tocineta-border/40 flex items-center justify-between">
                    <span>Transcribió: {ord.transcribed_by_name || 'Personal'}</span>
                    <span className="text-tocineta-yellow">Auditoría OK</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-tocineta-muted italic text-center py-8">
                No hay comandas de papel cargadas aún.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
