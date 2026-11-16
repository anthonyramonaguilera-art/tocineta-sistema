import React from 'react';
import { Badge, Card, EmptyState, Icon, InfoCallout } from '../../ui/index.js';

type Quadrant = 'ESTRELLA' | 'CABALLO_DE_BATALLA' | 'PUZZLE' | 'PERRO';
type SampleStatus = 'DATOS_INSUFICIENTES' | 'MUESTRA_VALIDA';

interface KasavanaDish {
  productId: string;
  productName: string;
  unitsSold: number;
  popularityIndex: number;
  unitContributionMarginUsdCents: number;
  recipeCostUsdCents: number;
  quadrant: Quadrant;
  recommendation: string;
}

interface KasavanaCategory {
  categoryId: string;
  categoryName: string;
  totalUnitsSold: number;
  dishCount: number;
  popularityThreshold: number;
  weightedAverageMarginUsdCents: number;
  sampleStatus: SampleStatus;
  missingDays: number;
  missingUnits: number;
  dishes: KasavanaDish[];
}

export interface KasavanaMatrixReport {
  totalUnitsSold: number;
  sampleStatus: SampleStatus;
  missingDays: number;
  missingUnits: number;
  categories: KasavanaCategory[];
}

interface KasavanaMatrixProps {
  report: KasavanaMatrixReport;
  error?: string;
  className?: string;
}

const QUADRANT_ORDER: Quadrant[] = ['ESTRELLA', 'CABALLO_DE_BATALLA', 'PUZZLE', 'PERRO'];

const QUADRANT_META: Record<
  Quadrant,
  { label: string; badge: 'success' | 'primary' | 'warning' | 'danger'; container: string }
> = {
  ESTRELLA: {
    label: 'ESTRELLA',
    badge: 'success',
    container: 'bg-success/10 border-success/30'
  },
  CABALLO_DE_BATALLA: {
    label: 'CABALLO_DE_BATALLA',
    badge: 'primary',
    container: 'bg-primary/10 border-primary/30'
  },
  PUZZLE: {
    label: 'PUZZLE',
    badge: 'warning',
    container: 'bg-warning/10 border-warning/30'
  },
  PERRO: {
    label: 'PERRO',
    badge: 'danger',
    container: 'bg-danger/10 border-danger/30'
  }
};

const formatUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const sortDishes = (dishes: KasavanaDish[]): KasavanaDish[] =>
  [...(dishes || [])].sort((a, b) => {
    const byQuadrant = QUADRANT_ORDER.indexOf(a.quadrant) - QUADRANT_ORDER.indexOf(b.quadrant);
    if (byQuadrant !== 0) return byQuadrant;
    return b.unitsSold - a.unitsSold;
  });

export const KasavanaMatrix: React.FC<KasavanaMatrixProps> = ({ report, error, className = '' }) => {
  if (!report) return null;

  return (
    <Card className={`p-4 space-y-3 bg-surface ${className}`.trim()}>
      {/* Cabecera: título, estado de muestra y leyenda de los 4 cuadrantes */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
        <div>
          <h4 className="text-xs font-black text-ink uppercase tracking-wider">
            Matriz Kasavana & Smith (Popularidad vs. Margen)
          </h4>
          <p className="text-[11px] text-ink-muted">
            Clasificación de platos del menú para optimización de rentabilidad.
          </p>
        </div>
        <Badge variant="neutral" className="text-[10px] font-black uppercase self-start">
          {report.sampleStatus}
        </Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
        <div className="p-3 bg-success/10 border border-success/30 rounded-xl">
          <span className="text-[10px] font-black text-success uppercase block">Estrellas</span>
          <span className="text-[11px] text-ink-muted">Alta Popularidad + Alto Margen</span>
        </div>
        <div className="p-3 bg-primary/10 border border-primary/30 rounded-xl">
          <span className="text-[10px] font-black text-primary uppercase block">Caballos de Batalla</span>
          <span className="text-[11px] text-ink-muted">Alta Popularidad + Bajo Margen</span>
        </div>
        <div className="p-3 bg-warning/10 border border-warning/30 rounded-xl">
          <span className="text-[10px] font-black text-warning uppercase block">Puzzles (Rompecabezas)</span>
          <span className="text-[11px] text-ink-muted">Baja Popularidad + Alto Margen</span>
        </div>
        <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl">
          <span className="text-[10px] font-black text-danger uppercase block">Perros</span>
          <span className="text-[11px] text-ink-muted">Baja Popularidad + Bajo Margen</span>
        </div>
      </div>

      {error && (
        <InfoCallout
          variant="warning"
          title="No se pudo calcular la matriz de ingeniería de menú"
          description={error}
          dismissible={false}
        />
      )}

      {report.totalUnitsSold === 0 ? (
        <EmptyState
          icon="BarChart2"
          title="Aún no hay ventas en el período seleccionado"
          description={
            error
              ? 'La matriz no se pudo calcular; el resto del Estado de Resultados sigue vigente.'
              : 'Cuando registres ventas, aquí verás cada plato clasificado por popularidad y margen.'
          }
        />
      ) : (
        <div className="space-y-4">
          {report.categories.map(category => (
            <div
              key={category.categoryId}
              className="p-3 rounded-2xl border border-border bg-surface-alt space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-black text-ink block">{category.categoryName}</span>
                  <span className="text-[11px] text-ink-muted block">
                    {category.totalUnitsSold} unidades vendidas · {category.dishCount} plato(s) ·
                    Umbral de popularidad {formatPercent(category.popularityThreshold)}
                  </span>
                </div>
                <Badge
                  variant={category.sampleStatus === 'MUESTRA_VALIDA' ? 'success' : 'warning'}
                  size="sm"
                  className="uppercase self-start"
                >
                  {category.sampleStatus === 'MUESTRA_VALIDA' ? 'Muestra válida' : 'Datos insuficientes'}
                </Badge>
              </div>

              {category.sampleStatus === 'DATOS_INSUFICIENTES' && (
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-warning/10 border border-warning/30 text-warning text-[11px] font-bold leading-snug">
                  <Icon name="AlertTriangle" size={14} className="shrink-0 mt-0.5" />
                  <span>
                    Muestra pequeña: faltan {category.missingDays} días y {category.missingUnits}{' '}
                    unidades para que la clasificación sea confiable.
                  </span>
                </div>
              )}

              <div className="space-y-2">
                {sortDishes(category.dishes).map(dish => {
                  const meta = QUADRANT_META[dish.quadrant] ?? QUADRANT_META.PERRO;
                  return (
                    <div key={dish.productId} className={`p-3 rounded-2xl border ${meta.container}`}>
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-sm font-black text-ink block break-words">
                            {dish.productName}
                          </span>
                          <span className="text-[11px] text-ink-muted block">
                            {dish.unitsSold} uds vendidas · {formatPercent(dish.popularityIndex)} de
                            popularidad
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <Badge variant={meta.badge} size="sm">
                            {meta.label}
                          </Badge>
                          {dish.recipeCostUsdCents === 0 && (
                            <Badge variant="warning" size="sm">
                              Sin receta: margen no confiable
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] font-bold">
                        <span className="text-ink-muted">
                          Margen unitario:{' '}
                          <span className="text-ink">
                            {formatUsd(dish.unitContributionMarginUsdCents)}
                          </span>
                        </span>
                        <span className="text-ink-muted">
                          Costo receta: <span className="text-ink">{formatUsd(dish.recipeCostUsdCents)}</span>
                        </span>
                      </div>

                      <p className="mt-2 text-[11px] text-ink-muted leading-relaxed">
                        {dish.recommendation}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default KasavanaMatrix;
