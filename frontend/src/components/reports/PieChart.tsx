import { useMemo, useRef } from 'react';
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
  // Use a ref to store a stable plugin ID for this component instance
  const pluginIdRef = useRef(`percentageLabels-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  
  // Create plugin to display percentages on pie chart slices
  const percentagePlugin = useMemo(() => ({
    id: pluginIdRef.current,
    afterDatasetsDraw(chart: any) {
      const { ctx } = chart;
      ctx.save();

      const meta = chart.getDatasetMeta(0);
      meta.data.forEach((segment: any, index: number) => {
        // Use percentage from data if available, otherwise calculate
        const percentage = data[index]?.percentage?.toFixed(1) || '0.0';

        // Only show label if slice is large enough (more than 5%)
        if (parseFloat(percentage) < 5) return;

        // Get the center point of the chart
        const centerX = segment.x;
        const centerY = segment.y;
        
        // Get the start and end angles of the segment
        const startAngle = segment.startAngle;
        const endAngle = segment.endAngle;
        
        // Calculate the middle angle of the slice
        const midAngle = (startAngle + endAngle) / 2;
        
        // Calculate the radius of the pie chart (distance from center to edge)
        const radius = segment.outerRadius;
        
        // Calculate position offset from center along the middle angle
        // Offset by 60% of the radius so labels appear on the slice, not at the center
        const offsetDistance = radius * 0.6;
        const xPos = centerX + Math.cos(midAngle) * offsetDistance;
        const yPos = centerY + Math.sin(midAngle) * offsetDistance;

        // Use white text with shadow for better visibility on colored backgrounds
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 2;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${percentage}%`, xPos, yPos);
        
        ctx.shadowBlur = 0;
      });

      ctx.restore();
    },
  }), [data]);

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
          generateLabels: (chart: any) => {
            const data = chart.data;
            if (data.labels.length && data.datasets.length) {
              const dataset = data.datasets[0];
              const total = dataset.data.reduce((a: number, b: number) => a + b, 0);
              
              return data.labels.map((label: string, i: number) => {
                const value = dataset.data[i];
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                return {
                  text: `${label} (${percentage}%)`,
                  fillStyle: dataset.backgroundColor[i],
                  strokeStyle: dataset.borderColor,
                  lineWidth: dataset.borderWidth,
                  hidden: false,
                  index: i,
                };
              });
            }
            return [];
          },
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
      <Pie data={chartData} options={options} plugins={[percentagePlugin]} />
    </div>
  );
};

