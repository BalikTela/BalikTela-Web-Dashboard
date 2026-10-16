import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler, type ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { PredictiveReport } from '../../shared/predictive';
import { toTons } from '../../shared/metrics';
import { useChartMotion } from '../hooks/useChartMotion';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

export function ForecastPlot({ report, target }: { report: PredictiveReport; target: 'collected' | 'declared' }) {
  const motion = useChartMotion<'line'>();
  const key = target === 'collected' ? 'collectedKg' : 'declaredKg';
  const lower = target === 'collected' ? 'collectedLowerKg' : 'declaredLowerKg';
  const upper = target === 'collected' ? 'collectedUpperKg' : 'declaredUpperKg';
  const labels = [...report.history.map(point => point.weekStart), ...report.forecast.map(point => point.weekStart)];
  const blanks = report.history.map(() => null);
  const last = report.history[report.history.length - 1];
  const options: ChartOptions<'line'> = {
    responsive: true, maintainAspectRatio: false,
    animation: motion.animation,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        filter: item => item.dataset.label !== 'Range ceiling',
        callbacks: {
          title: items => `Week of ${items[0]?.label}`,
          label: item => {
            const point = report.forecast[item.dataIndex - report.history.length];
            const mass = (value: number) => toTons(value).toLocaleString('en-PH', { maximumFractionDigits: 3 });
            if (item.dataset.label === '80% empirical range lower' && point) return `80% empirical range: ${mass(point[lower])} - ${mass(point[upper])} t`;
            return `${item.dataset.label}: ${Number(item.parsed.y).toLocaleString('en-PH', { maximumFractionDigits: 3 })} t`;
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxTicksLimit: 7, maxRotation: 0, color: '#69766f', font: { size: 11 }, callback: function (value) { return this.getLabelForValue(Number(value)).slice(5); } } },
      y: { beginAtZero: true, title: { display: true, text: 'Metric tons / week', color: '#69766f', font: { size: 11 } }, grid: { color: '#edf1ef' }, ticks: { maxTicksLimit: 6, color: '#69766f', font: { size: 11 } }, border: { display: false } },
    },
  };
  return <Line ref={motion.ref} aria-label={`${target === 'collected' ? 'Collection' : 'Declared waste'}: synthetic observed history and four-week forecast in metric tons`} role="img" options={options} data={{ labels, datasets: [
    { label: 'Range ceiling', data: [...blanks, ...report.forecast.map(point => toTons(point[upper]))], borderWidth: 0, pointRadius: 0, backgroundColor: 'transparent' },
    { label: '80% empirical range lower', data: [...blanks, ...report.forecast.map(point => toTons(point[lower]))], borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(180, 117, 31, 0.13)' },
    { label: 'Synthetic observed', data: [...report.history.map(point => toTons(point[key])), ...report.forecast.map(() => null)], borderColor: '#22634e', borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.15 },
    { label: 'Forecast', data: [...blanks.slice(1), toTons(last[key]), ...report.forecast.map(point => toTons(point[key]))], borderColor: '#a36a19', borderWidth: 2, borderDash: [5, 4], pointRadius: context => context.dataIndex >= report.history.length ? 3 : 0, pointBackgroundColor: '#a36a19', tension: 0 },
  ] }} />;
}

export function RateSparkline({ values }: { values: Array<number | null> }) {
  const segments: string[] = [];
  let drawing = false;
  values.forEach((value, index) => {
    if (value === null) { drawing = false; return; }
    segments.push(`${drawing ? 'L' : 'M'}${2 + index * 8},${30 - value * 26}`);
    drawing = true;
  });
  return <svg viewBox="0 0 94 34" width="94" height="34" role="img" aria-label="Observed selection rate over the last 12 weeks"><path d="M2,30H90" stroke="#e4eae7" fill="none" /><path className="sparkline-line" pathLength={1} d={segments.join(' ')} fill="none" stroke="#22634e" strokeWidth="1.5" /></svg>;
}
