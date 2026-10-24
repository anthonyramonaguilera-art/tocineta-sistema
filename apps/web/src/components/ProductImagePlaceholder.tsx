import React, { useState } from 'react';

interface ProductImagePlaceholderProps {
  imageUrl?: string | null;
  name: string;
  station?: string;
  className?: string;
}

export const ProductImagePlaceholder: React.FC<ProductImagePlaceholderProps> = ({
  imageUrl,
  name,
  station: _station,
  className = 'w-full h-32'
}) => {
  const [imageError, setImageError] = useState(false);

  // Obtener 2 letras iniciales estilo RePOS
  const getInitials = (text: string) => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return (text.slice(0, 2) || 'TS').toUpperCase();
  };

  if (imageUrl && !imageError) {
    return (
      <div className={`${className} rounded-2xl overflow-hidden bg-slate-100 dark:bg-neutral-950 border border-slate-200 dark:border-neutral-800 relative shadow-inner group`}>
        <img
          src={imageUrl}
          alt={name}
          onError={() => setImageError(true)}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-30 group-hover:opacity-10 transition-opacity" />
      </div>
    );
  }

  const initials = getInitials(name);

  return (
    <div className={`${className} rounded-2xl overflow-hidden bg-gradient-to-br from-blue-50 to-slate-100 dark:from-[#0B1528] dark:to-[#161922] border border-blue-100 dark:border-blue-900/40 flex flex-col items-center justify-center p-3 relative shadow-inner select-none transition-all`}>
      {/* Insignia con Iniciales Grandes en Azul Estilo RePOS */}
      <div className="w-16 h-16 rounded-2xl bg-[#005A9C]/10 border-2 border-[#005A9C]/30 flex items-center justify-center shadow-md mb-1 transition-transform duration-300 hover:scale-105">
        <span className="text-2xl font-black text-[#005A9C] dark:text-[#38BDF8] tracking-wider font-mono">
          {initials}
        </span>
      </div>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#005A9C] dark:bg-[#38BDF8] animate-pulse" />
        <span className="text-[10px] font-extrabold tracking-wider uppercase text-slate-500 dark:text-neutral-400">
          Tocineta Sonríe
        </span>
      </div>
    </div>
  );
};
