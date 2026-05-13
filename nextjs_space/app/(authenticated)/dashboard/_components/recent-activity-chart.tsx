"use client";

import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

interface ActivityData {
  predictedAt: string;
  severity: string;
  predictionType: string;
  confidence: number;
}

interface RecentActivityChartProps {
  data: ActivityData[];
}

export function RecentActivityChart({ data }: RecentActivityChartProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const grouped: Record<string, { total: number; anomalies: number }> = {};

    data.forEach((item) => {
      const date = new Date(item?.predictedAt ?? Date.now());
      const hour = date.toISOString().slice(0, 13) + ":00";

      if (!grouped[hour]) {
        grouped[hour] = { total: 0, anomalies: 0 };
      }
      grouped[hour].total++;
      if (item?.predictionType !== "normal") {
        grouped[hour].anomalies++;
      }
    });

    return Object.entries(grouped)
      .map(([time, counts]) => ({
        time: new Date(time).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
        }),
        ...counts,
      }))
      .slice(-24);
  }, [data]);

  if (!mounted) {
    return <div className="h-64 flex items-center justify-center text-slate-400">Loading chart...</div>;
  }

  if (!chartData || chartData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400">
        No recent activity data available
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorAnomalies" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0" }}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "white",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              fontSize: "11px",
            }}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke="#3b82f6"
            fill="url(#colorTotal)"
            strokeWidth={2}
            name="Total"
          />
          <Area
            type="monotone"
            dataKey="anomalies"
            stroke="#ef4444"
            fill="url(#colorAnomalies)"
            strokeWidth={2}
            name="Anomalies"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}