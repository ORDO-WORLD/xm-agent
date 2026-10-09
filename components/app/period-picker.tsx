'use client';

import { useEffect, useState } from 'react';
import { Button, Popover } from '@heroui/react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { id as idLocale } from 'react-day-picker/locale';
import { prettyRange } from '@/lib/format';
import { cn } from '@/lib/utils';

export type Period = { preset: string; from: string; to: string };
export type Preset = { id: string; label: string; range: () => { from: string; to: string } };

const pad = (value: number) => String(value).padStart(2, '0');
const toIso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromIso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

/**
 * Pick a day or a range. Days that carry something (new matches, posts) can show a count,
 * which makes it obvious where to look.
 */
export function RangeButton({ value, onChange, max, markers, onMonthChange, active, label = 'Pilih tanggal' }: {
  value: { from: string; to: string };
  onChange: (range: { from: string; to: string }) => void;
  max?: string;
  markers?: Record<string, number>;
  onMonthChange?: (monthStartIso: string) => void;
  active?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState(2);
  useEffect(() => {
    const update = () => setMonths(window.innerWidth >= 900 ? 2 : 1);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const [draft, setDraft] = useState<DateRange | undefined>();
  const [month, setMonth] = useState<Date>(() => (value.to ? fromIso(value.to) : new Date()));
  const maxDate = max ? fromIso(max) : undefined;
  // The saved range is only highlighted; selection state starts empty so the first tap always starts a new range.
  const saved = value.from && value.to && !draft ? { from: fromIso(value.from), to: fromIso(value.to) } : undefined;

  function changeMonth(next: Date) {
    setMonth(next);
    onMonthChange?.(toIso(new Date(next.getFullYear(), next.getMonth(), 1)));
  }
  function pick(day: Date) {
    if (!draft?.from || draft.to) { setDraft({ from: day, to: undefined }); return; }
    const [from, to] = day < draft.from ? [day, draft.from] : [draft.from, day];
    onChange({ from: toIso(from), to: toIso(to) });
    setOpen(false);
  }

  return (
    <Popover isOpen={open} onOpenChange={(next) => { setOpen(next); if (next) setDraft(undefined); }}>
      <Popover.Trigger>
        <Button variant={active ? 'primary' : 'secondary'} className="shrink-0" aria-label={`Pilih tanggal. Saat ini: ${active ? prettyRange(value.from, value.to) : 'belum dipilih'}`}>
          <CalendarDays className="size-4" aria-hidden="true" />
          {active && value.from ? prettyRange(value.from, value.to) : label}
        </Button>
      </Popover.Trigger>
      <Popover.Content placement="bottom start" className="max-w-[calc(100vw-1rem)]">
        <Popover.Dialog className="p-3 sm:p-4">
          <DayPicker
            mode="range"
            locale={idLocale}
            weekStartsOn={1}
            numberOfMonths={months}
            month={month}
            onMonthChange={changeMonth}
            selected={draft}
            onDayClick={pick}
            modifiers={{ saved: saved ?? [] }}
            modifiersClassNames={{ saved: 'rounded-full bg-accent-soft font-bold text-accent' }}
            disabled={maxDate ? { after: maxDate } : undefined}
            endMonth={maxDate}
            classNames={{
              root: 'xm-daypicker',
              months: 'relative flex flex-col gap-6 sm:flex-row',
              month: 'w-[17.5rem] space-y-2',
              month_caption: 'flex h-11 items-center justify-center text-base font-bold capitalize',
              nav: 'absolute inset-x-0 top-0 flex h-11 items-center justify-between',
              button_previous: 'flex size-11 items-center justify-center rounded-full hover:bg-default disabled:opacity-30',
              button_next: 'flex size-11 items-center justify-center rounded-full hover:bg-default disabled:opacity-30',
              month_grid: 'w-full border-collapse',
              weekday: 'h-9 w-10 text-center text-sm font-semibold text-muted',
              day: 'relative size-10 p-0 text-center',
              day_button: 'relative flex size-10 w-full items-center justify-center rounded-full text-base font-medium hover:bg-default',
              today: 'font-extrabold text-accent',
              outside: 'text-muted/50',
              disabled: 'text-muted/40 line-through',
              selected: 'bg-accent-soft',
              range_start: 'rounded-l-full bg-accent-soft [&>button]:bg-accent [&>button]:text-accent-foreground',
              range_end: 'rounded-r-full bg-accent-soft [&>button]:bg-accent [&>button]:text-accent-foreground',
              range_middle: 'rounded-none',
            }}
            components={{
              Chevron: ({ orientation }) => (orientation === 'left' ? <ChevronLeft className="size-5" aria-hidden="true" /> : <ChevronRight className="size-5" aria-hidden="true" />),
              DayButton: ({ day, modifiers, children, ...rest }) => {
                void modifiers;
                const count = markers?.[toIso(day.date)];
                return (
                  <button type="button" {...rest}>
                    {children}
                    {!!count && <span aria-label={`${count} data`} className="absolute -top-1 -right-1 min-w-4 rounded-full bg-success px-1 text-center text-[0.65rem] leading-4 font-bold text-success-foreground">{count > 99 ? '99+' : count}</span>}
                  </button>
                );
              },
            }}
          />
          <p className="mt-3 max-w-[36rem] text-sm text-muted">Ketuk tanggal awal, lalu tanggal akhir. Untuk satu hari saja, ketuk tanggal yang sama dua kali.</p>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

/** Quick periods as big pill buttons plus a free date range. Scrolls sideways on a phone. */
export function PeriodPicker({ value, onChange, presets, max, markers, onMonthChange, className, label = 'Periode' }: {
  value: Period; onChange: (period: Period) => void; presets: Preset[]; max?: string;
  markers?: Record<string, number>; onMonthChange?: (monthStartIso: string) => void; className?: string; label?: string;
}) {
  return (
    <fieldset aria-label={label} className={cn('xm-scroll-x m-0 -mx-4 flex min-w-0 gap-2 border-0 px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0', className)}>
      {presets.map((preset) => {
        const selected = value.preset === preset.id;
        return (
          <Button key={preset.id} variant={selected ? 'primary' : 'secondary'} className="shrink-0" aria-pressed={selected}
            onPress={() => onChange({ preset: preset.id, ...preset.range() })}>{preset.label}</Button>
        );
      })}
      <RangeButton value={value} active={value.preset === 'custom'} max={max} markers={markers} onMonthChange={onMonthChange}
        onChange={(range) => onChange({ preset: 'custom', ...range })} />
    </fieldset>
  );
}
