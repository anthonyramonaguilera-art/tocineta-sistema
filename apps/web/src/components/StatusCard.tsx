import React from 'react';

interface StatusCardProps {
  title: string;
  icon: React.ReactNode;
  badge?: {
    text: string;
    variant: 'success' | 'warning' | 'info' | 'yellow';
  };
  children: React.ReactNode;
}

export const StatusCard: React.FC<StatusCardProps> = ({ title, icon, badge, children }) => {
  const badgeClasses = {
    success: 'bg-tocineta-green/10 text-tocineta-green border-tocineta-green/20',
    warning: 'bg-tocineta-amber/10 text-tocineta-amber border-tocineta-amber/20',
    info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    yellow: 'bg-tocineta-yellow/10 text-tocineta-yellow border-tocineta-yellow/30'
  };

  return (
    <div className="bg-tocineta-card border border-tocineta-border rounded-xl p-5 hover:border-tocineta-border-light transition-colors shadow-lg">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-tocineta-border/60">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-[#0B0D11] border border-tocineta-border text-tocineta-yellow">
            {icon}
          </div>
          <h2 className="font-bold text-sm text-white tracking-wide uppercase">
            {title}
          </h2>
        </div>
        {badge && (
          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${badgeClasses[badge.variant]}`}>
            {badge.text}
          </span>
        )}
      </div>
      <div className="space-y-2.5">
        {children}
      </div>
    </div>
  );
};

interface MetricRowProps {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}

export const MetricRow: React.FC<MetricRowProps> = ({ label, value, highlight }) => {
  return (
    <div className="flex items-center justify-between text-xs py-1 border-b border-white/[0.04] last:border-b-0">
      <span className="text-tocineta-muted">{label}</span>
      <span className={`font-mono font-medium ${highlight ? 'text-tocineta-yellow font-bold' : 'text-white'}`}>
        {value}
      </span>
    </div>
  );
};
