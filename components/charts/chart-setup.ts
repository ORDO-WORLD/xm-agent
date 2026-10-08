import {
  ArcElement, BarElement, CategoryScale, Chart, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip,
  type ChartData, type ChartOptions, type Plugin, type ScriptableContext,
} from 'chart.js';

/** One registration for every chart: only the pieces we use are bundled. */
Chart.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip);

export const colors = {
  blue: '#0a3be0', cyan: '#14b8d4', navy: '#13317f', amber: '#f59e0b', red: '#ef4444', green: '#10b981',
  violet: '#7c3aed', pink: '#ec4899', teal: '#0d9488', orange: '#f97316', slate: '#64748b', ink: '#1e293b', grid: '#e8edf5',
};
export const categorical = [colors.blue, colors.cyan, colors.amber, colors.violet, colors.green, colors.pink, colors.orange, colors.teal, colors.slate];

const FONT = "'Plus Jakarta Sans Variable', ui-sans-serif, system-ui, sans-serif";

Chart.defaults.font.family = FONT;
Chart.defaults.font.size = 13;
Chart.defaults.color = '#475569';
// Mutate, never replace: Chart.js keeps resolver state on the defaults object.
Object.assign(Chart.defaults.animation as object, { duration: 700, easing: 'easeOutQuart' });

export function tooltip(extra: Record<string, unknown> = {}) {
  return {
    backgroundColor: '#0f1b3d', titleColor: '#ffffff', bodyColor: '#e2e8f0', padding: 12, cornerRadius: 12, boxPadding: 5,
    titleFont: { family: FONT, size: 14, weight: 700 }, bodyFont: { family: FONT, size: 14 }, displayColors: true, usePointStyle: true,
    ...extra,
  } as const;
}

export function legend(display = true) {
  return { display, position: 'bottom' as const, labels: { usePointStyle: true, pointStyle: 'circle' as const, boxWidth: 8, boxHeight: 8, padding: 18, font: { family: FONT, size: 13, weight: 600 as const } } };
}

/** Soft area under a line, fading to transparent. */
export function areaGradient(color: string) {
  return (context: ScriptableContext<'line'>) => {
    const { chart } = context;
    if (!chart.chartArea) return `${color}22`;
    const gradient = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
    gradient.addColorStop(0, `${color}44`);
    gradient.addColorStop(1, `${color}00`);
    return gradient;
  };
}

export const axisStyle = {
  x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 14, font: { family: FONT, size: 12.5 } } },
  y: { beginAtZero: true, grid: { color: colors.grid }, border: { display: false, dash: [4, 4] as number[] }, ticks: { precision: 0, padding: 8, font: { family: FONT, size: 12.5 } } },
};

/** Writes a big number (and a caption) in the hole of a doughnut. */
export const centerText: Plugin<'doughnut'> = {
  id: 'centerText',
  afterDraw(chart, _args, options) {
    const { text, caption } = (options ?? {}) as { text?: string; caption?: string };
    if (!text) return;
    const { ctx, chartArea } = chart;
    const x = (chartArea.left + chartArea.right) / 2;
    const y = (chartArea.top + chartArea.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.ink;
    ctx.font = `800 28px ${FONT}`;
    ctx.fillText(text, x, y - (caption ? 8 : 0));
    if (caption) {
      ctx.fillStyle = '#64748b';
      ctx.font = `600 13px ${FONT}`;
      ctx.fillText(caption, x, y + 18);
    }
    ctx.restore();
  },
};

export type { ChartData, ChartOptions };
