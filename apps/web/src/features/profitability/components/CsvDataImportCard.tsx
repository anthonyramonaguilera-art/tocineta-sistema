import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Icon } from '../../../ui/index.js';

interface CsvDataImportCardProps {
  activeLocationId: string;
}

export const CsvDataImportCard: React.FC<CsvDataImportCardProps> = ({ activeLocationId }) => {
  const queryClient = useQueryClient();
  const [csvContent, setCsvContent] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/fase3/setup-wizard/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvContent,
          locationId: activeLocationId === 'ALL' ? 'loc_alta_vista' : activeLocationId
        })
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setImportStatus(`EXITO: ${data.importedSupplies} insumos y ${data.importedRecipes} recetas importadas.`);
        queryClient.invalidateQueries({ queryKey: ['fase3Supplies'] });
        queryClient.invalidateQueries({ queryKey: ['fase3Recipes'] });
        setCsvContent('');
      } else {
        setImportStatus(`Error: ${data.error || 'Fallo en la importación'}`);
      }
    }
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCsvContent(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div>
          <h4 className="text-xs font-bold text-ink uppercase tracking-wider">
            Carga Masiva por CSV / Excel
          </h4>
          <p className="text-[11px] text-ink-muted">
            Descarga la plantilla oficial, complétala y súbela para cargar todo en 1 segundo.
          </p>
        </div>

        <div className="flex gap-2">
          <a
            href="/api/fase3/setup-wizard/template?type=supplies"
            download="plantilla_insumos.csv"
            className="px-3 py-1.5 rounded-xl bg-surface border border-border text-xs font-bold text-ink hover:bg-surface-alt transition-colors inline-flex items-center gap-1.5"
          >
            <Icon name="Download" size={14} />
            <span>Plantilla</span>
          </a>
          <a
            href="/api/fase3/setup-wizard/export"
            download="inventario_tocineta.csv"
            className="px-3 py-1.5 rounded-xl bg-surface border border-border text-xs font-bold text-ink hover:bg-surface-alt transition-colors inline-flex items-center gap-1.5"
          >
            <Icon name="Share" size={14} />
            <span>Exportar</span>
          </a>
        </div>
      </div>

      <div className="space-y-2">
        <input
          type="file"
          accept=".csv,.txt"
          onChange={handleFileUpload}
          className="text-xs text-ink-muted file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-primary file:text-primary-ink hover:file:opacity-90"
        />

        {csvContent && (
          <div className="space-y-2">
            <textarea
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              rows={4}
              className="w-full p-2.5 rounded-xl bg-surface-alt border border-border font-mono text-[11px] text-ink"
              placeholder="Contenido CSV..."
            />
            <Button
              variant="primary"
              size="sm"
              loading={importMutation.isPending}
              onClick={() => importMutation.mutate()}
              leftIcon={<Icon name="Upload" size={14} />}
            >
              Procesar e Importar CSV
            </Button>
          </div>
        )}

        {importStatus && (
          <div
            className={`p-2.5 rounded-xl text-xs font-bold ${
              importStatus.startsWith('EXITO:')
                ? 'bg-success/10 text-success border border-success/30'
                : 'bg-danger/10 text-danger border border-danger/30'
            }`}
          >
            {importStatus}
          </div>
        )}
      </div>
    </div>
  );
};
