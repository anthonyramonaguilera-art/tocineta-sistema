import React from 'react';
import { usdToBsCents } from '@tocineta/shared';

export interface MoneyProps {
  amountCents?: number;
  cents?: number;
  rateMicroBs?: number;
  rate?: string | number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showBs?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
  prefix?: string;
}

export const Money: React.FC<MoneyProps> = ({
  amountCents,
  cents,
  rateMicroBs,
  rate,
  size = 'md',
  showBs = true,
  align = 'left',
  className = '',
  prefix = ''
}) => {
  const actualCents = cents ?? amountCents ?? 0;

  let calculatedRateMicroBs = rateMicroBs ?? 40000000;
  if (rate !== undefined) {
    if (typeof rate === 'number') {
      calculatedRateMicroBs = rate > 100000 ? rate : Math.round(rate * 1_000_000);
    } else if (typeof rate === 'string') {
      const parsed = parseFloat(rate.replace(',', '.'));
      calculatedRateMicroBs = isNaN(parsed) ? 40000000 : Math.round(parsed * 1_000_000);
    }
  }

  const usdDollars = (Math.abs(actualCents) / 100).toFixed(2);
  const sign = actualCents < 0 ? '-' : '';

  let bsFormatted = '';
  if (showBs && calculatedRateMicroBs > 0) {
    const bsCents = usdToBsCents(Math.abs(actualCents), calculatedRateMicroBs);
    const bsNumber = (bsCents / 100).toLocaleString('es-VE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    bsFormatted = `Bs. ${bsNumber}`;
  }

  const alignClasses = {
    left: 'items-start text-left',
    right: 'items-end text-right',
    center: 'items-center text-center'
  };

  const usdSizeClasses = {
    sm: 'text-xs sm:text-sm font-bold',
    md: 'text-sm sm:text-base font-extrabold',
    lg: 'text-lg sm:text-xl font-black tracking-tight',
    xl: 'text-2xl sm:text-3xl font-black tracking-tight'
  };

  const bsSizeClasses = {
    sm: 'text-[10px] text-ink-muted font-medium font-mono',
    md: 'text-xs text-ink-muted font-medium font-mono',
    lg: 'text-xs sm:text-sm text-ink-muted font-semibold font-mono',
    xl: 'text-sm sm:text-base text-ink-muted font-semibold font-mono'
  };

  return (
    <div className={`inline-flex flex-col leading-tight ${alignClasses[align]} ${className}`.trim()}>
      <span className={`text-ink ${usdSizeClasses[size]}`}>
        {prefix}{sign}${usdDollars}
      </span>
      {showBs && bsFormatted && (
        <span className={bsSizeClasses[size]}>
          {sign}{bsFormatted}
        </span>
      )}
    </div>
  );
};

export default Money;
