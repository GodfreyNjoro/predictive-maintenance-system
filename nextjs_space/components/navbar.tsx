"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Upload,
  AlertTriangle,
  History,
  BarChart3,
  TestTube,
  LogOut,
  Shield,
  Menu,
  X,
  Activity,
  Brain,
  Sparkles,
  Database,
  AppWindow,
} from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/applications", label: "Applications", icon: AppWindow },
  { href: "/system-analysis", label: "Analysis", icon: Activity },
  { href: "/intelligence", label: "Intelligence", icon: Sparkles },
  { href: "/predictions", label: "Predictions", icon: AlertTriangle },
  { href: "/federated", label: "Federated AI", icon: Brain },
  { href: "/metrics", label: "Metrics", icon: BarChart3 },
  { href: "/audit", label: "Audit", icon: History },
  { href: "/test-harness", label: "Test Harness", icon: TestTube },
];

export function Navbar() {
  const { data: session } = useSession() || {};
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!session?.user) return null;

  return (
    <header className="sticky top-0 z-50 w-full bg-slate-900/95 backdrop-blur supports-[backdrop-filter]:bg-slate-900/80 border-b border-slate-800">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-9 h-9 bg-blue-500 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div className="hidden sm:block">
              <span className="text-white font-semibold text-lg">System Failure</span>
              <span className="text-blue-400 font-medium text-sm ml-1">PMS</span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-blue-500/20 text-blue-400"
                      : "text-slate-300 hover:text-white hover:bg-slate-800"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* User Menu */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-300 text-sm font-medium">
                {session?.user?.name?.charAt(0)?.toUpperCase() ?? "U"}
              </div>
              <span className="text-sm text-slate-300">
                {session?.user?.name ?? session?.user?.email}
              </span>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="p-2 text-slate-400 hover:text-white transition-colors"
              title="Sign out"
            >
              <LogOut className="w-5 h-5" />
            </button>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-slate-400 hover:text-white"
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.nav
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden pb-4"
            >
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-blue-500/20 text-blue-400"
                        : "text-slate-300 hover:text-white hover:bg-slate-800"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}