import React, { useState } from 'react';
import { Utensils } from 'lucide-react';

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
  className = 'w-full h-28'
}) => {
  const [imageError, setImageError] = useState(false);

  if (imageUrl && !imageError) {
    return (
      <div className={`${className} rounded-2xl overflow-hidden bg-neutral-950 border border-neutral-800/80 relative shadow-inner group`}>
        <img
          src={imageUrl}
          alt={name}
          onError={() => setImageError(true)}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-40 group-hover:opacity-20 transition-opacity" />
      </div>
    );
  }

  return (
    <div className={`${className} rounded-2xl overflow-hidden bg-gradient-to-b from-[#14171F] to-[#0B0D11] border border-neutral-800 flex flex-col items-center justify-center p-3 relative shadow-inner select-none`}>
      <div className="w-14 h-14 rounded-2xl bg-[#FFE600]/10 border border-[#FFE600]/25 flex items-center justify-center shadow-lg shadow-[#FFE600]/5 mb-1.5 transition-transform duration-300 hover:scale-105">
        <Utensils className="w-10 h-10 text-[#FFE600]" />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#FFE600] animate-pulse" />
        <span className="text-[10px] font-black tracking-widest uppercase text-neutral-400">
          Tocineta Sonríe
        </span>
      </div>
    </div>
  );
};
