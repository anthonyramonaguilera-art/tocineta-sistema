import React from 'react';

export interface FieldProps {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}

export const Field: React.FC<FieldProps> = ({
  label,
  error,
  hint,
  required = false,
  htmlFor,
  children,
  className = ''
}) => {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-sm font-semibold text-ink flex items-center justify-between"
        >
          <span>
            {label}
            {required && <span className="text-danger ml-1 font-bold">*</span>}
          </span>
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs font-semibold text-danger mt-0.5 flex items-center gap-1">
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-muted mt-0.5">{hint}</p>
      ) : null}
    </div>
  );
};
