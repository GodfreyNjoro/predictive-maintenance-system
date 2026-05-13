"use client";

import { AlertTriangle, AlertCircle, Info, CheckCircle } from "lucide-react";

interface AlertsOverviewProps {
  alerts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

export function AlertsOverview({ alerts }: AlertsOverviewProps) {
  const items = [
    {
      label: "Critical",
      count: alerts?.critical ?? 0,
      icon: AlertTriangle,
      color: "bg-red-100 text-red-700 border-red-200",
      iconColor: "text-red-500",
      barColor: "bg-red-500",
    },
    {
      label: "High",
      count: alerts?.high ?? 0,
      icon: AlertCircle,
      color: "bg-orange-100 text-orange-700 border-orange-200",
      iconColor: "text-orange-500",
      barColor: "bg-orange-500",
    },
    {
      label: "Medium",
      count: alerts?.medium ?? 0,
      icon: Info,
      color: "bg-amber-100 text-amber-700 border-amber-200",
      iconColor: "text-amber-500",
      barColor: "bg-amber-500",
    },
    {
      label: "Low",
      count: alerts?.low ?? 0,
      icon: CheckCircle,
      color: "bg-emerald-100 text-emerald-700 border-emerald-200",
      iconColor: "text-emerald-500",
      barColor: "bg-emerald-500",
    },
  ];

  const total = (alerts?.critical ?? 0) + (alerts?.high ?? 0) + (alerts?.medium ?? 0) + (alerts?.low ?? 0);

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const percentage = total > 0 ? (item.count / total) * 100 : 0;
        return (
          <div key={item.label} className="flex items-center gap-4">
            <div className={`p-2 rounded-lg ${item.color.split(" ")[0]}`}>
              <item.icon className={`w-4 h-4 ${item.iconColor}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-slate-700">{item.label}</span>
                <span className="text-sm font-bold text-slate-900">{item.count}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${item.barColor}`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}