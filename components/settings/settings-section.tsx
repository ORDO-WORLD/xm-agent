'use client';

import type { ReactNode } from 'react';
import { Info, type LucideIcon } from 'lucide-react';
import { useSectionSearchLabel } from '@/lib/section-search';

export function SettingsLabel({ children, tab }: { children: string; tab: string }) {
  const label = useSectionSearchLabel(children, tab);
  return <span id={label.id}>{label.content}</span>;
}

export function SettingsNote({ children, tone }: { children: ReactNode; tone?: 'danger' | 'success' }) {
  return <p className="general-note" data-tone={tone} role={tone === 'danger' ? 'alert' : undefined}><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span>{children}</span></p>;
}

export function SettingsSection({ title, description, icon: Icon, tab, action, children }: {
  title: string; description: string; icon: LucideIcon; tab: string; action?: ReactNode; children: ReactNode;
}) {
  const label = useSectionSearchLabel(title, tab);
  return (
    <section className="general-section" aria-labelledby={label.id}>
      <div>
        <h2 id={label.id} className="flex items-center gap-2 text-[0.9375rem] font-medium text-foreground"><Icon className="size-4 shrink-0" aria-hidden="true" /><span>{label.content}</span></h2>
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">{description}</p>
      </div>
      <div className="general-section-controls">
        {action && <div className="flex flex-wrap justify-end gap-2">{action}</div>}
        {children}
      </div>
    </section>
  );
}
