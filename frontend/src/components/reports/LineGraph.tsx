import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { formatCurrency } from '../../utils/currency';
import type { SpendingTrend, TimeGranularity } from '../../services/analytics/analytics.service';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface LineGraphProps {
  data: SpendingTrend[];
  granularity: TimeGranularity; // Used for potential future customization
  currency?: string;
}

export const LineGraph = ({ data, currency = 'CAD' }: LineGraphProps) => {
  const chartData: ChartData<'line'> = {
    labels: data.map((item) => item.label),
    datasets: [
      {
        label: 'Spending',
        data: data.map((item) => item.amount),
        borderColor: '#0ea5e9',
        backgroundColor: 'rgba(14, 165, 233, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.parsed.y;
            if (value === null || value === undefined) return formatCurrency(0, currency);
            return formatCurrency(value, currency);
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: (value) => {
            const numValue = typeof value === 'number' ? value : parseFloat(String(value));
            return formatCurrency(numValue, currency);
          },
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)',
        },
      },
      x: {
        grid: {
          display: false,
        },
      },
    },
  };

  return (
    <div className="h-64 md:h-80">
      <Line data={chartData} options={options} />
    </div>
  );
};

