import React from 'react';
import { InfoCallout } from '../ui/InfoCallout.js';

export interface PedagogicalGuideBannerProps {
  title: string;
  description: string;
  storageKey: string;
}

/**
 * PedagogicalGuideBanner - Delegado unificado hacia InfoCallout (WCAG AA).
 * Elimina estilos oscuros/marrones sobre texto amarillo inaccesibles.
 */
export const PedagogicalGuideBanner: React.FC<PedagogicalGuideBannerProps> = ({
  title,
  description,
  storageKey,
}) => {
  return (
    <div className="mb-4">
      <InfoCallout
        title={title}
        description={description}
        storageKey={storageKey}
        variant="info"
        icon="Lightbulb"
        dismissible={true}
        dismissLabel="Entendido, ocultar guía"
      />
    </div>
  );
};

export default PedagogicalGuideBanner;
