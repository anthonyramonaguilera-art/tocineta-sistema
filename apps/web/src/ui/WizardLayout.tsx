import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from './Button.js';

export interface WizardLayoutProps {
  currentStep: number;
  totalSteps: number;
  stepTitle?: string;
  title?: string;
  stepDescription?: string;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  backLabel?: string;
  isNextDisabled?: boolean;
  nextDisabled?: boolean;
  isNextLoading?: boolean;
  nextLoading?: boolean;
  canGoBack?: boolean;
  footerExtra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const WizardLayout: React.FC<WizardLayoutProps> = ({
  currentStep,
  totalSteps,
  stepTitle,
  title,
  stepDescription,
  onBack,
  onNext,
  nextLabel = 'Siguiente',
  backLabel = 'Atrás',
  isNextDisabled = false,
  nextDisabled = false,
  isNextLoading = false,
  nextLoading = false,
  canGoBack = true,
  footerExtra,
  children,
  className = ''
}) => {
  const displayTitle = title || stepTitle || '';
  const disabledNext = isNextDisabled || nextDisabled;
  const loadingNext = isNextLoading || nextLoading;
  const progressPercent = Math.min(100, Math.round((currentStep / totalSteps) * 100));

  return (
    <div className={`flex flex-col min-h-screen bg-surface text-ink ${className}`.trim()}>
      {/* Wizard Header */}
      <header className="sticky top-0 z-20 bg-surface/95 backdrop-blur-md border-b border-border px-4 py-3">
        <div className="max-w-2xl mx-auto flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-muted">
              Paso {currentStep} de {totalSteps}
            </span>
            <span className="text-xs font-semibold text-ink-muted">
              {progressPercent}% completado
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-border h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-primary h-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div>
            <h1 className="text-xl font-bold text-ink leading-tight">{displayTitle}</h1>
            {stepDescription && (
              <p className="text-xs text-ink-muted mt-0.5">{stepDescription}</p>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-2xl w-full mx-auto p-4 pb-28">
        {children}
      </main>

      {/* Fixed Sticky Footer */}
      <footer className="fixed bottom-0 left-0 right-0 z-20 bg-surface/95 backdrop-blur-md border-t border-border p-3.5 shadow-lg">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          {footerExtra && (
            <div className="flex-1 min-w-0">
              {footerExtra}
            </div>
          )}

          <div className="flex items-center gap-2.5 ml-auto">
            {canGoBack && onBack && (
              <Button
                type="button"
                variant="secondary"
                onClick={onBack}
                iconStart={<ArrowLeft className="w-5 h-5" />}
              >
                {backLabel}
              </Button>
            )}

            {onNext && (
              <Button
                type="button"
                variant="primary"
                onClick={onNext}
                disabled={disabledNext}
                isLoading={loadingNext}
                iconEnd={<ArrowRight className="w-5 h-5" />}
              >
                {nextLabel}
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};

export default WizardLayout;
