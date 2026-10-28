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
    success: 'bg-success-subtle text-success border-success/30',
    warning: 'bg-warning-subtle text-warning border-warning/30',
    info: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30',
    yellow: 'bg-primary text-primary-ink border-border font-black'
  };

  return (
    <div className="bg-surface border border-border rounded-2xl p-5 transition-colors shadow-xs">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-surface-alt border border-border text-ink">
            {icon}
          </div>
          <h2 className="font-black text-sm text-ink tracking-wide uppercase">
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
    <div className="flex items-center justify-between text-xs py-1.5 border-b border-border/60 last:border-b-0">
      <span className="text-ink-muted">{label}</span>
      <span
        className={`font-mono text-xs ${
          highlight
            ? 'font-black bg-primary text-primary-ink px-1.5 py-0.5 rounded-md'
            : 'font-bold text-ink'
        }`}
      >
        {value}
      </span>
    </div>
  );
};

export default StatusCard;
