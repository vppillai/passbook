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
import { useTheme } from '../../contexts/theme.context';

ChartJS.register(ArcElement, Tooltip, Legend);

interface PieChartProps {
  data: CategoryBreakdown[];
  currency?: string;
}

// Helper function to calculate relative luminance of a color
const getLuminance = (hex: string): number => {
  // Remove # if present and normalize to 6 characters
  let color = hex.replace('#', '');
  
  // Handle 3-character hex codes (e.g., #fff -> #ffffff)
  if (color.length === 3) {
    color = color.split('').map(char => char + char).join('');
  }
  
  // Ensure we have 6 characters, default to black if invalid
  if (color.length !== 6) {
    return 0; // Default to dark (will use white text)
  }
  
  // Convert to RGB
  const r = parseInt(color.substring(0, 2), 16) / 255;
  const g = parseInt(color.substring(2, 4), 16) / 255;
  const b = parseInt(color.substring(4, 6), 16) / 255;
  
  // Apply gamma correction
  const [rs, gs, bs] = [r, g, b].map(val => {
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  });
  
  // Calculate relative luminance
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

// Determine text color based on background luminance for best contrast
const getTextColor = (backgroundColor: string, isDarkMode: boolean): string => {
  const luminance = getLuminance(backgroundColor);
  // Use white text on dark backgrounds (low luminance), black on light backgrounds (high luminance)
  // In dark mode, we can use a slightly higher threshold
  const threshold = isDarkMode ? 0.4 : 0.5;
  return luminance > threshold ? '#000000' : '#ffffff';
};

export const PieChart = ({ data, currency = 'CAD' }: PieChartProps) => {
  const { effectiveTheme } = useTheme();
  const isDarkMode = effectiveTheme === 'dark';
  
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

        // Get the background color of this slice
        const backgroundColor = data[index]?.colorHex || '#000000';
        
        // Determine text color based on background luminance for optimal contrast
        const textColor = getTextColor(backgroundColor, isDarkMode);
        
        // Use shadow for better visibility - adjust shadow color based on text color
        ctx.shadowColor = textColor === '#ffffff' 
          ? 'rgba(0, 0, 0, 0.7)' 
          : 'rgba(255, 255, 255, 0.7)';
        ctx.shadowBlur = 3;
        ctx.fillStyle = textColor;
        ctx.font = 'bold 13px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${percentage}%`, xPos, yPos);
        
        ctx.shadowBlur = 0;
      });

      ctx.restore();
    },
  }), [data, isDarkMode]);

  const chartData: ChartData<'pie'> = useMemo(() => ({
    labels: data.map((item) => item.categoryName),
    datasets: [
      {
        data: data.map((item) => item.amount),
        backgroundColor: data.map((item) => item.colorHex),
        borderColor: '#ffffff',
        borderWidth: 2,
      },
    ],
  }), [data]);

  const options: ChartOptions<'pie'> = useMemo(() => ({
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
          color: isDarkMode ? '#e5e7eb' : '#374151', // Use theme-aware text color
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
                  fontColor: isDarkMode ? '#e5e7eb' : '#374151', // Theme-aware text color
                };
              });
            }
            return [];
          },
        },
      },
      tooltip: {
        backgroundColor: isDarkMode ? 'rgba(31, 41, 55, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        titleColor: isDarkMode ? '#e5e7eb' : '#374151',
        bodyColor: isDarkMode ? '#e5e7eb' : '#374151',
        borderColor: isDarkMode ? '#4b5563' : '#e5e7eb',
        borderWidth: 1,
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
  }), [data, isDarkMode, currency]);

  return (
    <div className="h-64 md:h-80">
      <Pie data={chartData} options={options} plugins={[percentagePlugin]} />
    </div>
  );
};

