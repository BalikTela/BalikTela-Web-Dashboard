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
import { toTons } from '../../shared/metrics';
import type { CategoryShare, Facility, RegionActivity, WastePoint } from '../types';

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
  return (
    <Line
      options={chartOptions}
      data={{
        labels: data.map((item) => item.month),
        datasets: [
          { label: 'Recorded (t)', data: data.map((item) => toTons(item.recorded)), borderColor: '#34423d', backgroundColor: 'rgba(52, 66, 61, 0.05)', tension: 0.35, fill: true, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
          { label: 'Collected (t)', data: data.map((item) => toTons(item.collected)), borderColor: '#27775c', backgroundColor: 'transparent', tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
          { label: 'Recycled (t)', data: data.map((item) => toTons(item.recycled)), borderColor: '#3e8c91', backgroundColor: 'transparent', tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
          { label: 'Reused (t)', data: data.map((item) => toTons(item.reused)), borderColor: '#bd7a2f', backgroundColor: 'transparent', tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
        ],
      }}
    />
  );
}

export function CategoryDoughnut({ data }: { data: CategoryShare[] }) {
  return (
    <Doughnut
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: tick, boxWidth: 10, boxHeight: 10, usePointStyle: true } } },
        cutout: '68%',
      }}
      data={{
        labels: data.map((item) => item.category),
        datasets: [{ label: 'Collected (t)', data: data.map((item) => toTons(item.kilograms)), backgroundColor: ['#27775c', '#3e8c91', '#bd7a2f', '#65736e', '#7a8f55', '#a95e68'], borderWidth: 3, borderColor: '#ffffff' }],
      }}
    />
  );
}

export function RegionalBarChart({ data }: { data: RegionActivity[] }) {
  return (
    <Bar
      options={chartOptions}
      data={{
        labels: data.map((item) => item.region),
        datasets: [
          { label: 'Collected (t)', data: data.map((item) => toTons(item.collectionKg)), backgroundColor: '#27775c', borderRadius: 3 },
          { label: 'Recycled (t)', data: data.map((item) => toTons(item.recyclingKg)), backgroundColor: '#9bc6b6', borderRadius: 3 },
        ],
      }}
    />
  );
}

export function FacilityUtilizationChart({ data }: { data: Facility[] }) {
  return (
    <Bar
      options={{ ...chartOptions, indexAxis: 'y' as const }}
      data={{
        labels: data.map((item) => item.name.replace(' Cooperative', '').replace(' Center', '')),
        datasets: [{ label: 'Utilization %', data: data.map((item) => item.capacityKg > 0 ? item.utilization : null), backgroundColor: '#27775c', borderRadius: 3 }],
      }}
    />
  );
}

export function ForecastChart({ data }: { data: Array<{ month: string; historical: number | null; forecast: number | null }> }) {
  return (
    <Line
      options={chartOptions}
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
