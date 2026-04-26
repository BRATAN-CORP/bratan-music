import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-3">
      <div style={{ color: 'var(--color-text-subtle)' }}>{icon}</div>
      <p className="text-lg font-medium">{title}</p>
      {description && (
        <p className="text-sm max-w-xs" style={{ color: 'var(--color-text-muted)' }}>
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
