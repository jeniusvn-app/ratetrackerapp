import { type ReactNode } from 'react';

interface BtnProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold' | 'subtle';
  size?: 'sm' | 'md';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}

const variants: Record<string, string> = {
  primary: 'bg-navy-700 text-white hover:bg-navy-600 border border-navy-700',
  secondary: 'bg-white text-navy-800 border border-navy-200 hover:bg-navy-50',
  ghost: 'bg-transparent text-navy-600 hover:bg-navy-50 border border-transparent',
  danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
  gold: 'bg-gold-500 text-white hover:bg-gold-600 border border-gold-500 shadow-sm',
  subtle: 'bg-navy-50 text-navy-700 hover:bg-navy-100 border border-navy-100',
};

const sizes: Record<string, string> = {
  sm: 'text-xs px-2.5 py-1.5 rounded-md gap-1.5',
  md: 'text-sm px-4 py-2 rounded-lg gap-2',
};

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  type = 'button',
  className = '',
  title,
}: BtnProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center font-medium transition-colors select-none ${variants[variant]} ${sizes[size]} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
    >
      {children}
    </button>
  );
}

interface FieldProps {
  label: string;
  children: ReactNode;
  className?: string;
  hint?: string;
}

export function Field({ label, children, className = '', hint }: FieldProps) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-medium text-navy-700 mb-1.5 uppercase tracking-wide">
        {label}
      </span>
      {children}
      {hint && <span className="block text-xs text-navy-400 mt-1">{hint}</span>}
    </label>
  );
}

export function Select({
  value,
  onChange,
  children,
  disabled,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full appearance-none bg-white border border-navy-200 rounded-lg pl-3 pr-9 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-400 focus:border-navy-400 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        {children}
      </select>
      {/* No arrow icon per spec — subtle line indicator */}
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-navy-300 text-xs"
      >
        ▾
      </span>
    </div>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  className = '',
  onEnter,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  className?: string;
  onEnter?: () => void;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) onEnter();
      }}
      className={`w-full bg-white border border-navy-200 rounded-lg px-3 py-2 text-sm text-navy-800 placeholder:text-navy-300 focus:outline-none focus:ring-2 focus:ring-navy-400 focus:border-navy-400 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl shadow-card border border-navy-100 ${className}`}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'gold' | 'green' | 'red' | 'amber' | 'navy';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-navy-50 text-navy-700 border-navy-100',
    gold: 'bg-gold-500/10 text-gold-600 border-gold-500/20',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    navy: 'bg-navy-700 text-white border-navy-700',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-navy-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl shadow-pop w-full ${maxWidth} fade-in max-h-[90vh] overflow-auto thin-scroll`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-navy-100">
          <h3 className="text-base font-semibold text-navy-800">{title}</h3>
          <button
            onClick={onClose}
            className="text-navy-400 hover:text-navy-700 text-lg leading-none w-7 h-7 rounded-md hover:bg-navy-50"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-12 text-center text-navy-400 text-sm border border-dashed border-navy-100 rounded-xl bg-navy-50/30">
      {message}
    </div>
  );
}
