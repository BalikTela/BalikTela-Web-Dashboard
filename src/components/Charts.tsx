import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { MATERIAL_METRIC_LABELS, toTons } from '../../shared/metrics';
import type { CategoryShare, RegionActivity, WastePoint } from '../types';
import { useChartMotion } from '../hooks/useChartMotion';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler);

const grid = 'rgba(111, 128, 121, 0.13)';
const tick = '#66736e';

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        boxWidth: 8,
        boxHeight: 8,
        color: tick,
        usePointStyle: true,
        font: { family: 'Inter, ui-sans-serif, system-ui', size: 11 },
      },
    },
  },
  scales: {
    x: { grid: { display: false }, border: { display: false }, ticks: { color: tick, font: { size: 11 } } },
    y: { grid: { color: grid }, border: { display: false }, ticks: { color: tick, font: { size: 11 } } },
  },
};

export function WasteTrendChart({ data }: { data: WastePoint[] }) {
  const motion = useChartMotion<'line'>();
  return (
    <Line
      ref={motion.ref}
      options={{ ...chartOptions, animation: motion.animation }}
      data={{
        labels: data.map((item) => item.month),
        datasets: [
          { label: `${MATERIAL_METRIC_LABELS.declared} (t)`, data: data.map((item) => toTons(item.recorded)), borderColor: '#34423d', backgroundColor: 'rgba(52, 66, 61, 0.05)', tension: 0.35, fill: true, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
          { label: `${MATERIAL_METRIC_LABELS.received} (t)`, data: data.map((item) => item.hasCollectionEvidence === false ? null : toTons(item.collected)), borderColor: '#27775c', backgroundColor: 'transparent', tension: 0.35, pointRadius: 2, pointHoverRadius: 4, borderWidth: 2 },
          { label: 'Confirmed recycling (t)', data: data.map((item) => item.hasRecyclingEvidence === false ? null : toTons(item.recycled)), borderColor: '#3e8c91', backgroundColor: 'transparent', tension: 0.35, pointRadius: 2, pointHoverRadius: 4, borderWidth: 2 },
          { label: 'Confirmed reuse (t)', data: data.map((item) => item.hasReuseEvidence === false ? null : toTons(item.reused)), borderColor: '#bd7a2f', backgroundColor: 'transparent', tension: 0.35, pointRadius: 2, pointHoverRadius: 4, borderWidth: 2 },
        ],
      }}
    />
  );
}

export function CategoryDoughnut({ data }: { data: CategoryShare[] }) {
  const motion = useChartMotion<'doughnut'>();
  return (
    <Doughnut
      ref={motion.ref}
      options={{
        animation: motion.animation,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: tick, boxWidth: 10, boxHeight: 10, usePointStyle: true } } },
        cutout: '68%',
      }}
      data={{
        labels: data.map((item) => item.category),
        datasets: [{ label: `${MATERIAL_METRIC_LABELS.received} (t)`, data: data.map((item) => toTons(item.kilograms)), backgroundColor: ['#27775c', '#3e8c91', '#bd7a2f', '#65736e', '#7a8f55', '#a95e68'], borderWidth: 3, borderColor: '#ffffff' }],
      }}
    />
  );
}

export function RegionalBarChart({ data }: { data: RegionActivity[] }) {
  const motion = useChartMotion<'bar'>();
  return (
    <Bar
      ref={motion.ref}
      options={{ ...chartOptions, animation: motion.animation }}
      data={{
        labels: data.map((item) => item.region),
        datasets: [
          { label: `${MATERIAL_METRIC_LABELS.received} (t)`, data: data.map((item) => item.collectionAvailable === false ? null : toTons(item.collectionKg)), backgroundColor: '#27775c', borderRadius: 3 },
          { label: 'Confirmed recycling (t)', data: data.map((item) => item.recyclingAvailable === false ? null : toTons(item.recyclingKg)), backgroundColor: '#9bc6b6', borderRadius: 3 },
        ],
      }}
    />
  );
}

export function FacilityUtilizationChart({ data }: { data: Array<{ name: string; capacityKg: number; utilization: number | null }> }) {
  const motion = useChartMotion<'bar'>();
  return (
    <Bar
      ref={motion.ref}
      options={{ ...chartOptions, indexAxis: 'y' as const, animation: motion.animation }}
      data={{
        labels: data.map((item) => item.name.replace(' Cooperative', '').replace(' Center', '')),
        datasets: [{ label: 'Utilization %', data: data.map((item) => item.capacityKg > 0 ? item.utilization : null), backgroundColor: '#27775c', borderRadius: 3 }],
      }}
    />
  );
}

export function ForecastChart({ data }: { data: Array<{ month: string; historical: number | null; forecast: number | null }> }) {
  const motion = useChartMotion<'line'>();
  return (
    <Line
      ref={motion.ref}
      options={{ ...chartOptions, animation: motion.animation }}
      data={{
        labels: data.map((item) => item.month),
        datasets: [
          { label: 'Historical waste (t)', data: data.map((item) => item.historical == null ? null : toTons(item.historical)), borderColor: '#334155', backgroundColor: 'rgba(51, 65, 85, 0.08)', tension: 0.35 },
          { label: 'Demo forecast (t)', data: data.map((item) => item.forecast == null ? null : toTons(item.forecast)), borderColor: '#d97706', borderDash: [6, 6], backgroundColor: 'rgba(217, 119, 6, 0.08)', tension: 0.35 },
        ],
      }}
    />
  );
}
