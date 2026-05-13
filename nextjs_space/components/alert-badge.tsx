"use client";

import { AlertTriangle, AlertCircle, Info, CheckCircle } from "lucide-react";

interface AlertBadgeProps {
  severity: "critical" | "high" | "medium" | "low";
  showIcon?: boolean;
  size?: "sm" | "md" | "lg";
}

export function AlertBadge({ severity, showIcon = true, size = "md" }: AlertBadgeProps) {
  const config = {
    critical: {
      icon: AlertTriangle,
      bg: "bg-red-100",
      text: "text-red-700",
      border: "border-red-200",
      label: "Critical",
    },
    high: {
      icon: AlertCircle,
      bg: "bg-orange-100",
      text: "text-orange-700",
      border: "border-orange-200",
      label: "High",
    },
    medium: {
      icon: Info,
      bg: "bg-amber-100",
      text: "text-amber-700",
      border: "border-amber-200",
      label: "Medium",
    },
    low: {
      icon: CheckCircle,
      bg: "bg-emerald-100",
      text: "text-emerald-700",
      border: "border-emerald-200",
      label: "Low",
    },
  };

  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-2.5 py-1 text-sm",
    lg: "px-3 py-1.5 text-base",
  };

  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  const { icon: Icon, bg, text, border, label } = config[severity] ?? config.low;

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium rounded-full border ${bg} ${text} ${border} ${sizeClasses[size]}`}
    >
      {showIcon && <Icon className={iconSizes[size]} />}
      {label}
    </span>
  );
}