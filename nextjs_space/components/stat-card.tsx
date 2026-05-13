"use client";

import { motion } from "framer-motion";
import { useInView } from "react-intersection-observer";
import { useState, useEffect } from "react";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  color?: "blue" | "green" | "yellow" | "red" | "slate";
  suffix?: string;
  prefix?: string;
  animate?: boolean;
  delay?: number;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  color = "blue",
  suffix = "",
  prefix = "",
  animate = true,
  delay = 0,
}: StatCardProps) {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.1 });
  const [displayValue, setDisplayValue] = useState(0);
  const numericValue = typeof value === "number" ? value : parseFloat(value) || 0;

  useEffect(() => {
    if (inView && animate && typeof value === "number") {
      const duration = 1000;
      const steps = 30;
      const stepValue = numericValue / steps;
      let current = 0;

      const timer = setInterval(() => {
        current += stepValue;
        if (current >= numericValue) {
          setDisplayValue(numericValue);
          clearInterval(timer);
        } else {
          setDisplayValue(Math.floor(current));
        }
      }, duration / steps);

      return () => clearInterval(timer);
    } else if (inView) {
      setDisplayValue(numericValue);
    }
  }, [inView, numericValue, animate, value]);

  const colorClasses = {
    blue: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    green: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    yellow: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    red: "bg-red-500/10 text-red-500 border-red-500/20",
    slate: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  };

  const iconBgClasses = {
    blue: "bg-blue-500/20",
    green: "bg-emerald-500/20",
    yellow: "bg-amber-500/20",
    red: "bg-red-500/20",
    slate: "bg-slate-500/20",
  };

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay }}
      className={`p-5 rounded-xl border bg-white shadow-sm hover:shadow-md transition-shadow`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {prefix}
            {animate && typeof value === "number"
              ? displayValue.toLocaleString()
              : value}
            {suffix}
          </p>
        </div>
        <div className={`p-3 rounded-lg ${iconBgClasses[color]}`}>
          <Icon className={`w-5 h-5 ${colorClasses[color].split(" ")[1]}`} />
        </div>
      </div>
    </motion.div>
  );
}