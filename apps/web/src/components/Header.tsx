import React from 'react';
import { Clock } from 'lucide-react';

interface HeaderProps {
  localTimeCaracas?: string;
  isOnline: boolean;
}

export const Header: React.FC<HeaderProps> = ({ localTimeCaracas, isOnline }) => {
  return (
    <header className="border-b border-tocineta-border bg-[#0B0D11]/90 backdrop-blur sticky top-0 z-50 px-4 py-3 sm:px-6">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Marca y Logotipo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-tocineta-yellow flex items-center justify-center font-black text-black text-xl shadow-[0_0_15px_rgba(255,230,0,0.3)]">
            🥓
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-black text-lg sm:text-xl tracking-tight text-white uppercase">
                TOCINETA
              </h1>
              <span className="bg-tocineta-yellow text-black text-[11px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                M0 PROCESO ÚNICO
              </span>
            </div>
            <p className="text-xs text-tocineta-muted">
              Sistema Operativo Local de Food Truck • HP Laptop Localhost
            </p>
          </div>
        </div>

        {/* Estado y Reloj Caracas */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2 bg-tocineta-card px-3 py-1.5 rounded-lg border border-tocineta-border">
            <Clock className="w-3.5 h-3.5 text-tocineta-yellow" />
            <span className="font-mono text-white font-semibold">
              {localTimeCaracas || 'Cargando hora...'}
            </span>
          </div>

          <div className="flex items-center gap-2 bg-tocineta-card px-3 py-1.5 rounded-lg border border-tocineta-border">
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-tocineta-green animate-pulse' : 'bg-tocineta-red'}`} />
            <span className="font-semibold text-white">
              {isOnline ? 'EN VIVO (LAN)' : 'DESCONECTADO'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
