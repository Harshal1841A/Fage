import React from 'react';
import { motion } from 'motion/react';
import { ViewMode, SystemTheme, DataSourceType } from '../types';
import { 
  LayoutDashboard, 
  Search, 
  Shield, 
  Brain, 
  ShieldAlert, 
  Activity, 
  Bell, 
  ShieldCheck,
  Sun, 
  Moon, 
  Settings, 
  LogOut 
} from 'lucide-react';

interface SidebarProps {
  currentView: ViewMode;
  setView: (view: ViewMode) => void;
  theme: SystemTheme;
  toggleTheme: () => void;
  openAlertsCount: number;
  dataSource: DataSourceType;
  setDataSource: (source: DataSourceType) => void;
  isBackendOnline: boolean;
  apiAlertsCount: number;
  apiTargetCount: number;
  apiDatasetCount: number;
  onNewInvestigation?: () => void;
  onLogout?: () => void;
  onAdmin?: () => void;
  userDisplayName?: string;
  userRole?: string;
}

// Shared easing — ease-out-quart, premium feel, zero bounce
const EASE: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

export default function Sidebar({
  currentView,
  setView,
  theme,
  toggleTheme,
  isBackendOnline,
  dataSource,
  setDataSource,
  openAlertsCount,
  apiAlertsCount,
  apiTargetCount,
  apiDatasetCount,
  onNewInvestigation,
  onLogout,
  onAdmin,
  userDisplayName,
  userRole,
}: SidebarProps) {

  const menuItems = [
    { id: 'dashboard' as ViewMode,     label: 'Dashboard',              icon: LayoutDashboard },
    { id: 'investigation' as ViewMode, label: 'Investigation Workbench', icon: Search        },
    { id: 'explorer' as ViewMode,      label: 'Risk Explorer',           icon: Shield             },
    { id: 'insights' as ViewMode,      label: 'Model Insights',          icon: Brain           },
    { id: 'performance' as ViewMode,   label: 'Model Performance',       icon: Activity           },
    { id: 'governance' as ViewMode,    label: 'Model Governance',        icon: ShieldCheck        },
    { id: 'alerts' as ViewMode,        label: 'Alerts Queue',            icon: Bell },
  ];

  const isDark = theme === 'analytics';

  return (
    <aside className="fixed left-0 top-0 h-full flex flex-col p-4 z-40 bg-surface-container-low border-r border-outline-variant w-64 shrink-0">

      {/* ── Brand Header ─────────────────────────────── */}
      <div className="mb-8 px-2 flex items-center gap-3">
        <div className="relative w-9 h-9 shrink-0">
          <div className="absolute inset-0 rounded-lg bg-primary/20 flex items-center justify-center">
            <svg viewBox="0 0 32 32" fill="none" className="w-5 h-5">
              <path d="M4 8h24v3H4zM4 14.5h16v3H4zM4 21h10v3H4z" fill="currentColor" className="text-primary" />
              <circle cx="25" cy="22.5" r="5" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-primary opacity-70" />
              <line x1="28.5" y1="26" x2="31" y2="28.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-primary" />
            </svg>
          </div>
          {/* Online indicator dot */}
          <span
            className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface-container-low ${
              isBackendOnline ? 'bg-primary' : 'bg-error'
            }`}
          />
        </div>
        <div>
          <h1 className="text-sm font-bold text-on-surface leading-tight">Investigation Engine</h1>
          <p className={`text-[9px] uppercase tracking-widest font-bold ${isBackendOnline ? 'text-primary' : 'text-error'}`}>
            {isBackendOnline ? 'System Online' : 'System Offline'}
          </p>
        </div>
      </div>

      {/* ── Navigation ───────────────────────────────── */}
      <nav className="flex-1 space-y-0.5">
        {menuItems.map(item => {
          const isActive = currentView === item.id;
          return (
            <motion.button
              key={item.id}
              onClick={() => setView(item.id)}
              whileHover={{ x: isActive ? 0 : 2 }}
              whileTap={{ scale: 0.97, opacity: 0.85 }}
              transition={{ duration: 0.14, ease: EASE }}
              className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-label text-label-sm cursor-pointer select-none outline-none"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {/* Animated background pill — morphs smoothly between active items */}
              {isActive && (
                <motion.span
                  layoutId="nav-active-pill"
                  className="absolute inset-0 rounded-lg bg-secondary-container"
                  transition={{ duration: 0.22, ease: EASE }}
                />
              )}
              {/* Icon */}
              <item.icon
                size={20}
                className={`relative transition-colors duration-150 z-10 ${
                  isActive ? 'text-on-secondary-container' : 'text-on-surface-variant'
                }`}
              />
              {/* Label */}
              <span
                className={`relative transition-colors duration-150 z-10 flex-1 ${
                  isActive ? 'text-on-secondary-container font-bold' : 'text-on-surface-variant'
                }`}
              >
                {item.label}
              </span>
              {item.id === 'alerts' && openAlertsCount > 0 && (
                <span className="relative z-10 min-w-[18px] h-[18px] px-1 rounded-full bg-error text-on-error text-[9px] font-black flex items-center justify-center">
                  {openAlertsCount > 99 ? '99+' : openAlertsCount}
                </span>
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* ── Footer Controls ──────────────────────────── */}
      <div className="mt-auto pt-4 border-t border-outline-variant space-y-3">

        {/* Data stream selector */}
        <motion.div whileTap={{ scale: 0.98 }} transition={{ duration: 0.12, ease: EASE }}>
          <select
            value={dataSource}
            onChange={(e) => setDataSource(e.target.value as DataSourceType)}
            className="w-full appearance-none font-label text-xs px-2.5 py-1.5 rounded-md outline-none cursor-pointer border transition-all duration-150 bg-surface-container-lowest border-outline-variant text-on-surface focus:border-primary focus:ring-1 focus:ring-primary/30"
          >
            <option value="live-all"     disabled={!isBackendOnline}>Live: All{isBackendOnline ? ` (${apiAlertsCount})` : ''}</option>
            <option value="live-target"  disabled={!isBackendOnline}>Live: Mule{isBackendOnline ? ` (${apiTargetCount})` : ''}</option>
            <option value="live-dataset" disabled={!isBackendOnline}>Live: Dataset{isBackendOnline ? ` (${apiDatasetCount})` : ''}</option>
          </select>
        </motion.div>

        {/* Theme Toggle */}
        <motion.button
          id="theme-toggle-btn"
          onClick={toggleTheme}
          title={isDark ? 'Switch to Sovereign (Light) Theme' : 'Switch to Analytics (Dark) Theme'}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.97, opacity: 0.85 }}
          transition={{ duration: 0.14, ease: EASE }}
          className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-outline-variant bg-surface-container hover:bg-surface-container-high cursor-pointer select-none outline-none group"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <div className="flex items-center gap-2">
            {isDark ? (
              <Sun size={18} className="text-primary select-none z-10" />
            ) : (
              <Moon size={18} className="text-primary select-none z-10" />
            )}
            <span className="font-label text-xs text-on-surface-variant group-hover:text-on-surface transition-colors duration-150">
              {isDark ? 'Sovereign Mode' : 'Analytics Mode'}
            </span>
          </div>
          {/* Toggle pill with motion-animated thumb */}
          <div
            className={`relative w-9 h-5 rounded-full transition-colors duration-300 ${
              isDark ? 'bg-surface-container-highest' : 'bg-primary'
            }`}
          >
            <motion.div
              animate={{ left: isDark ? 2 : 20 }}
              transition={{ duration: 0.2, ease: EASE }}
              className={`absolute top-0.5 w-4 h-4 rounded-full shadow-sm z-10 ${
                isDark ? 'bg-on-surface-variant' : 'bg-on-primary'
              }`}
            />
          </div>
        </motion.button>

        {/* Action buttons */}
        <div className="space-y-0.5">
          <motion.button
            whileTap={{ scale: 0.97, opacity: 0.85 }}
            transition={{ duration: 0.12, ease: EASE }}
            onClick={onNewInvestigation}
            className="w-full mb-2 py-2 px-4 bg-primary text-on-primary font-bold rounded-lg text-sm cursor-pointer select-none outline-none"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            New Investigation
          </motion.button>

          <motion.button
            whileHover={{ x: 2 }}
            whileTap={{ scale: 0.97, opacity: 0.85 }}
            transition={{ duration: 0.12, ease: EASE }}
            onClick={onAdmin}
            className="w-full flex items-center gap-3 px-3 py-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest rounded-lg font-label text-label-sm cursor-pointer select-none outline-none group"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Settings size={18} className="select-none z-10" />
            <span>Admin / Audit</span>
          </motion.button>

          <motion.button
            whileHover={{ x: 2 }}
            whileTap={{ scale: 0.97, opacity: 0.85 }}
            transition={{ duration: 0.12, ease: EASE }}
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest rounded-lg font-label text-label-sm cursor-pointer select-none outline-none group"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <LogOut size={18} className="select-none z-10" />
            <span>Logout{userDisplayName ? ` (${userDisplayName.split(' ')[0]})` : ''}</span>
          </motion.button>
          {userRole && (
            <p className="px-3 text-[9px] uppercase tracking-widest text-on-surface-variant/70 font-bold">
              Role: {userRole}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
