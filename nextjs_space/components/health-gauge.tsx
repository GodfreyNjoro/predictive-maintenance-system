"use client";

import { motion } from "framer-motion";
import { useInView } from "react-intersection-observer";
import { useEffect, useState } from "react";

interface HealthGaugeProps {
  score: number;
  size?: number;
}

export function HealthGauge({ score, size = 200 }: HealthGaugeProps) {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.1 });
  const [animatedScore, setAnimatedScore] = useState(0);

  useEffect(() => {
    if (inView) {
      const duration = 1500;
      const steps = 60;
      const stepValue = score / steps;
      let current = 0;

      const timer = setInterval(() => {
        current += stepValue;
        if (current >= score) {
          setAnimatedScore(score);
          clearInterval(timer);
        } else {
          setAnimatedScore(current);
        }
      }, duration / steps);

      return () => clearInterval(timer);
    }
  }, [inView, score]);

  const circumference = 2 * Math.PI * 80;
  const strokeDashoffset = circumference - (animatedScore / 100) * circumference;

  const getColor = (s: number) => {
    if (s >= 80) return "#10b981";
    if (s >= 60) return "#f59e0b";
    if (s >= 40) return "#f97316";
    return "#ef4444";
  };

  const getLabel = (s: number) => {
    if (s >= 80) return "Healthy";
    if (s >= 60) return "Moderate";
    if (s >= 40) return "Degraded";
    return "Critical";
  };

  return (
    <div ref={ref} className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 200 200" className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="16"
        />
        {/* Progress circle */}
        <motion.circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke={getColor(animatedScore)}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold text-slate-900">{Math.round(animatedScore)}</span>
        <span className="text-sm font-medium" style={{ color: getColor(animatedScore) }}>
          {getLabel(animatedScore)}
        </span>
      </div>
    </div>
  );
}