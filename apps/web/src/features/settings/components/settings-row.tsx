import type { ReactNode } from "react";

export const SettingsRow = ({
  action,
  label,
  value,
}: {
  action: ReactNode;
  label: string;
  value: ReactNode;
}) => (
  <div className="flex flex-col items-start justify-between gap-4 border-b border-border/70 py-5 last:border-b-0 md:flex-row md:items-center">
    <div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="mt-1 text-sm text-muted-foreground">{value}</div>
    </div>
    <div className="shrink-0">{action}</div>
  </div>
);
