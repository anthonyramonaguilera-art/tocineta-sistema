import React, { useState } from 'react';
import { Card, Button, Badge, Money, Icon } from '../../ui/index.js';
import { useQuotesList, useQuoteDetail, useConvertToReservation, useDeleteQuote } from './useQuotesData.js';
import { QuoteModal } from './QuoteModal.js';
import { ReserveShoppingModal } from './ReserveShoppingModal.js';
import type { EventQuotation } from './types.js';

export const EventQuotesView: React.FC = () => {
  const { data, isLoading, refetch } = useQuotesList();
  const quotes = data?.quotes || [];

  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [isShoppingModalOpen, setIsShoppingModalOpen] = useState(false);

  const { data: detailData } = useQuoteDetail(selectedQuoteId);
  const convertMutation = useConvertToReservation();
  const deleteMutation = useDeleteQuote();

  // Filtros
  const filteredQuotes = quotes.filter((q) => {
    const qStr = search.toLowerCase();
    return q.customer_name.toLowerCase().includes(qStr) || q.quotation_number.toLowerCase().includes(qStr);
  });

  // Métricas
  const totalQuotedUsdCents = quotes.reduce((acc, q) => acc + q.total_price_usd_cents, 0);
  const totalReservedCount = quotes.filter((q) => q.status === 'RESERVADA').length;
  const projectedProfitUsdCents = quotes.reduce((acc, q) => acc + q.estimated_profit_usd_cents, 0);

  const handleOpenShoppingList = (quoteId: string) => {
    setSelectedQuoteId(quoteId);
    setIsShoppingModalOpen(true);
  };

  const handleConvertToReserve = async (quote: EventQuotation) => {
    if (!confirm(`¿Deseas confirmar la reserva para "${quote.customer_name}"? Se calculará la lista de compras necesaria.`)) {
      return;
    }
    try {
      await convertMutation.mutateAsync(quote.id);
      setSelectedQuoteId(quote.id);
      setIsShoppingModalOpen(true);
    } catch (err: any) {
      alert(err.message || 'Error al convertir en reserva');
    }
  };

  const handleDownloadPdf = (quoteId: string) => {
    window.open(`/api/quotes/${quoteId}/pdf`, '_blank');
  };

  const handleWhatsApp = async (quoteId: string) => {
    try {
      const res = await fetch(`/api/quotes/${quoteId}/whatsapp`);
      const d = await res.json();
      if (d.url) {
        window.open(d.url, '_blank');
      }
    } catch {
      alert('Error al abrir WhatsApp');
    }
  };

  const handleDelete = async (quote: EventQuotation) => {
    if (!confirm(`¿Eliminar la cotización ${quote.quotation_number} de ${quote.customer_name}?`)) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(quote.id);
    } catch (err: any) {
      alert(err.message || 'Error al eliminar');
    }
  };

  return (
    <div className="space-y-5 max-w-6xl mx-auto select-none pb-10">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface p-5 rounded-2xl border border-border shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black text-ink tracking-tight">
              Cotizador de Eventos y Catering
            </h1>
            <Badge variant="primary">F7 OFICIAL</Badge>
          </div>
          <p className="text-xs text-ink-muted mt-1">
            Presupuestos conectados a la carta real, simulador privado de utilidad y lista automática de compras.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setIsCreateOpen(true)}
            className="min-h-[48px] px-4 font-black shadow-md"
            leftIcon={<Icon name="Plus" size={18} />}
          >
            Nueva Cotización
          </Button>
        </div>
      </div>

      {/* Tarjetas de Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card variant="surface" className="p-4 border border-border flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">Cotizaciones</span>
            <span className="text-2xl font-black text-ink">{quotes.length}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Icon name="FileText" size={20} />
          </div>
        </Card>

        <Card variant="surface" className="p-4 border border-border flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">Reservas Confirmadas</span>
            <span className="text-2xl font-black text-success">{totalReservedCount}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center text-success">
            <Icon name="CalendarCheck" size={20} />
          </div>
        </Card>

        <Card variant="surface" className="p-4 border border-border flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">Total Cotizado</span>
            <span className="text-2xl font-black text-ink"><Money cents={totalQuotedUsdCents} /></span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Icon name="DollarSign" size={20} />
          </div>
        </Card>

        <Card variant="surface" className="p-4 border border-border flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">Utilidad Proyectada</span>
            <span className="text-2xl font-black text-success"><Money cents={projectedProfitUsdCents} /></span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center text-success">
            <Icon name="TrendingUp" size={20} />
          </div>
        </Card>
      </div>

      {/* Buscador */}
      <div className="flex items-center gap-3 bg-surface p-3 rounded-2xl border border-border shadow-xs">
        <Icon name="Search" size={18} className="text-ink-muted ml-2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente o número de cotización (ej. COT-2026-0001)..."
          className="flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-muted font-medium"
        />
        {search && (
          <button type="button" onClick={() => setSearch('')} className="text-ink-muted hover:text-ink text-xs font-bold mr-2">
            Limpiar
          </button>
        )}
      </div>

      {/* Listado de Cotizaciones */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-12 text-xs text-ink-muted">Cargando cotizaciones...</div>
        ) : filteredQuotes.length === 0 ? (
          <div className="text-center py-12 bg-surface rounded-2xl border border-dashed border-border p-6 space-y-2">
            <Icon name="FileSpreadsheet" size={36} className="mx-auto text-ink-muted opacity-50" />
            <h3 className="text-sm font-bold text-ink">No hay cotizaciones registradas</h3>
            <p className="text-xs text-ink-muted">Crea presupuestos para eventos corporativos, catering o celebraciones privadas.</p>
            <Button type="button" variant="primary" size="sm" onClick={() => setIsCreateOpen(true)} className="min-h-[44px] mt-2">
              Crear Primera Cotización
            </Button>
          </div>
        ) : (
          filteredQuotes.map((q) => {
            const isReserved = q.status === 'RESERVADA';
            return (
              <Card key={q.id} variant="surface" className="p-4 sm:p-5 border border-border space-y-4 hover:border-primary/50 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-extrabold text-primary">{q.quotation_number}</span>
                      <h3 className="font-extrabold text-sm sm:text-base text-ink">{q.customer_name}</h3>
                      <Badge variant={isReserved ? 'success' : 'primary'}>{q.status}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                      {q.event_date_ms && (
                        <span className="flex items-center gap-1">
                          <Icon name="Calendar" size={13} />
                          {new Date(q.event_date_ms).toLocaleDateString('es-VE')}
                        </span>
                      )}
                      {q.event_location && (
                        <span className="flex items-center gap-1">
                          <Icon name="MapPin" size={13} />
                          {q.event_location}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Icon name="Users" size={13} />
                        {q.guest_count} personas
                      </span>
                    </div>
                  </div>

                  {/* Precios y Utilidad */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between border-t sm:border-t-0 pt-2 sm:pt-0 border-border">
                    <div className="text-right">
                      <span className="text-[10px] text-ink-muted block uppercase font-bold">Total Cotizado</span>
                      <span className="text-base sm:text-lg font-black text-ink"><Money cents={q.total_price_usd_cents} /></span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-success font-bold">
                        Utilidad: <Money cents={q.estimated_profit_usd_cents} />
                      </span>
                    </div>
                  </div>
                </div>

                {/* Botonera de Acciones (Touch-First) */}
                <div className="pt-3 border-t border-border flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleWhatsApp(q.id)}
                      className="min-h-[44px] text-xs font-bold text-success hover:bg-success/10"
                      leftIcon={<Icon name="MessageCircle" size={16} />}
                    >
                      WhatsApp
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleDownloadPdf(q.id)}
                      className="min-h-[44px] text-xs font-bold"
                      leftIcon={<Icon name="Download" size={16} />}
                    >
                      PDF Cliente
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleOpenShoppingList(q.id)}
                      className="min-h-[44px] text-xs font-bold text-primary hover:bg-primary/10"
                      leftIcon={<Icon name="ShoppingCart" size={16} />}
                    >
                      Lista de Compras
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    {!isReserved ? (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => handleConvertToReserve(q)}
                        className="min-h-[44px] text-xs font-black shadow-xs"
                        leftIcon={<Icon name="CheckCircle2" size={16} />}
                      >
                        Convertir en Reserva
                      </Button>
                    ) : (
                      <span className="text-xs font-extrabold text-success flex items-center gap-1 px-3 py-1.5 rounded-xl bg-success/10">
                        <Icon name="Check" size={14} /> Reserva Confirmada
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(q)}
                      className="w-10 h-10 rounded-xl bg-surface-alt border border-border flex items-center justify-center text-ink-muted hover:text-danger hover:border-danger/40 transition-colors"
                      title="Eliminar cotización"
                    >
                      <Icon name="Trash2" size={15} />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Modal Nueva Cotización */}
      <QuoteModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={() => refetch()}
      />

      {/* Modal Lista Consolidada de Compras */}
      {isShoppingModalOpen && (
        <ReserveShoppingModal
          quotation={detailData?.quotation || null}
          onClose={() => {
            setIsShoppingModalOpen(false);
            setSelectedQuoteId(null);
          }}
        />
      )}
    </div>
  );
};
