import { Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { formatCurrency } from '../../utils/currency';
import type { CategoryBreakdown } from '../../services/analytics/analytics.service';

ChartJS.register(ArcElement, Tooltip, Legend);

interface PieChartProps {
  data: CategoryBreakdown[];
  currency?: string;
}

export const PieChart = ({ data, currency = 'CAD' }: PieChartProps) => {
  const chartData: ChartData<'pie'> = {
    labels: data.map((item) => item.categoryName),
    datasets: [
      {
        data: data.map((item) => item.amount),
        backgroundColor: data.map((item) => item.colorHex),
        borderColor: '#ffffff',
        borderWidth: 2,
      },
    ],
  };

  const options: ChartOptions<'pie'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          padding: 15,
          font: {
            size: 12,
          },
          usePointStyle: true,
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const label = context.label || '';
            const value = context.parsed || 0;
            const item = data[context.dataIndex];
            return `${label}: ${formatCurrency(value, currency)} (${item.percentage.toFixed(1)}%)`;
          },
        },
      },
    },
  };

  return (
    <div className="h-64 md:h-80">
      <Pie data={chartData} options={options} />
    </div>
  );
};

