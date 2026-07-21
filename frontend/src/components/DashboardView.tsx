import React, { useState } from 'react';
import { 
  Building, 
  AlertTriangle, 
  BellRing, 
  TrendingUp, 
  TrendingDown, 
  ArrowUpRight, 
  FileText, 
  Calendar,
  Eye,
  Activity,
  Cpu,
  Send,
  Check,
  DollarSign,
  Target
} from 'lucide-react';
import { Alert, SystemTheme, DataSourceType } from '../types';
import { useRiskScore, useDashboardSummary } from '../hooks/useFageApi';
import { formatINRAbbreviated } from '../utils/format';
import { LiveFeed } from './LiveFeed';

interface DashboardViewProps {
  alerts: Alert[];
  onSelectAlert: (id: string) => void;
  theme: SystemTheme;
  onRefreshAlerts?: () => void;
  dataSource: DataSourceType;
  setDataSource: (source: DataSourceType) => void;
  isBackendOnline: boolean;
  alertsLoading?: boolean;
  apiAlertsCount: number;
  apiTargetCount: number;
  apiDatasetCount: number;
  apiError: string | null;
}

export default function DashboardView({ 
  alerts, 
  onSelectAlert, 
  theme, 
  onRefreshAlerts,
  dataSource,
  setDataSource,
  isBackendOnline,
  alertsLoading,
  apiAlertsCount,
  apiTargetCount,
  apiDatasetCount,
  apiError
}: DashboardViewProps) {
  const isDark = theme === 'analytics';
  const [tierFilter, setTierFilter] = useState<'ALL' | 'CRITICAL' | 'HIGH' | 'LOW'>('ALL');
  const { data: telemetry } = useDashboardSummary();

  // Real-time scoring state and evaluation handlers
  const { evaluate, result: scoreResult, loading: scoringLoading, error: scoringError, reset: resetScoring } = useRiskScore();
  const [simAmount, setSimAmount] = useState('');
  const [simSender, setSimSender] = useState('');
  const [simReceiver, setSimReceiver] = useState('');
  const [simAccountAge, setSimAccountAge] = useState('');
  const [simOrigin, setSimOrigin] = useState('US');
  const [simDest, setSimDest] = useState('US');
  const [simInternational, setSimInternational] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimError(null);
    const parsedAmount = parseFloat(simAmount);
    const parsedAge = parseInt(simAccountAge, 10);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setSimError('Please enter a valid positive transaction amount (₹).');
      return;
    }
    if (isNaN(parsedAge) || parsedAge < 0) {
      setSimError('Please enter a valid account age in days (>= 0).');
      return;
    }

    try {
      await evaluate({
        amount: parsedAmount,
        sender_id: simSender.trim() || 'UNKNOWN-SENDER',
        receiver_id: simReceiver.trim() || 'UNKNOWN-RECEIVER',
        account_age_days: parsedAge,
        origin_country: simOrigin,
        destination_country: simDest,
        is_international: simInternational
      });
      if (onRefreshAlerts) {
        onRefreshAlerts();
      }
    } catch (err) {
      console.error(err);
      setSimError('Scoring request failed. Verify backend connectivity.');
    }
  };

  // Dynamic Risk Distribution calculations
  const riskStats = React.useMemo(() => {
    const total = alerts.length || 1;
    const lowCount = alerts.filter(a => a.riskScore < 50).length;
    const medCount = alerts.filter(a => a.riskScore >= 50 && a.riskScore < 75).length;
    const highCount = alerts.filter(a => a.riskScore >= 75).length;
    
    const lowPct = alerts.length === 0 ? 0 : Math.round((lowCount / total) * 100);
    const medPct = alerts.length === 0 ? 0 : Math.round((medCount / total) * 100);
    const highPct = alerts.length === 0 ? 0 : 100 - lowPct - medPct;
    
    const avgScore = alerts.length > 0
      ? Math.round(alerts.reduce((acc, a) => acc + a.riskScore, 0) / alerts.length)
      : 0;

    return { lowCount, medCount, highCount, lowPct, medPct, highPct, avgScore, total };
  }, [alerts]);

  // Dynamic Alert Category/Distribution calculations
  const alertStats = React.useMemo(() => {
    const total = alerts.length || 1;
    let muleCount = 0;
    let networkCount = 0;
    let velocityCount = 0;
    
    alerts.forEach(a => {
      const typeStr = (a.type || '').toLowerCase();
      if (typeStr.includes('mule') || typeStr.includes('target') || typeStr.includes('fraud')) {
        muleCount++;
      } else if (typeStr.includes('network') || typeStr.includes('ip') || typeStr.includes('proxy') || typeStr.includes('sanction') || typeStr.includes('ofac')) {
        networkCount++;
      } else {
        velocityCount++;
      }
    });

    const velocityPct = alerts.length === 0 ? 0 : Math.round((velocityCount / total) * 100);
    const networkPct = alerts.length === 0 ? 0 : Math.round((networkCount / total) * 100);
    const mulePct = alerts.length === 0 ? 0 : 100 - velocityPct - networkPct;

    return {
      total,
      muleCount,
      networkCount,
      velocityCount,
      velocityPct,
      networkPct,
      mulePct
    };
  }, [alerts]);

  const { totalRiskAmount, totalTargetAmount } = React.useMemo(() => {
    const totalRisk = alerts
      .filter(a => a.riskScore >= 75)
      .reduce((sum, a) => sum + a.transactionAmount, 0);

    const totalTarget = alerts
      .filter(a => a.type === 'Mule Account')
      .reduce((sum, a) => sum + a.transactionAmount, 0);

    return { totalRiskAmount: totalRisk, totalTargetAmount: totalTarget };
  }, [alerts]);

  const formatCurrency = (val: number) => {
    return formatINRAbbreviated(val);
  };

  const threatLevel = React.useMemo(() => {
    const critical = telemetry?.severity_profile?.Critical ?? alerts.filter(a => a.riskScore >= 75).length;
    const open = telemetry?.incident_status_matrix?.Open ?? alerts.filter(a => a.status === 'Open').length;
    if (critical >= 3 || open >= 5) return { label: 'Elevated', pct: 75 };
    if (critical >= 1 || open >= 2) return { label: 'Heightened', pct: 55 };
    if (alerts.length === 0) return { label: 'Unknown', pct: 10 };
    return { label: 'Stable', pct: 25 };
  }, [telemetry, alerts]);

  const accountsAnalysed = telemetry?.unique_accounts_analysed ?? new Set(alerts.map(a => a.accountNumber)).size;
  const criticalCount = telemetry?.critical_alert_count ?? alerts.filter(a => a.riskScore >= 75).length;
  const muleVol = telemetry?.mule_exposure_amount ?? totalTargetAmount;

  const criticalRecent = alerts
    .filter(a => {
      if (tierFilter === 'CRITICAL') return a.riskScore >= 75;
      if (tierFilter === 'HIGH') return a.riskScore >= 50 && a.riskScore < 75;
      if (tierFilter === 'LOW') return a.riskScore < 50;
      return a.riskScore >= 60;
    })
    .slice(0, 10);

  const donutRadius = 40;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const segment1Dash = (alertStats.velocityPct / 100) * donutCircumference;
  const segment2Dash = (alertStats.networkPct / 100) * donutCircumference;
  const segment3Dash = (alertStats.mulePct / 100) * donutCircumference;

  const handleGenerateReport = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header Info Panel */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className={`text-2xl font-extrabold tracking-tight ${isDark ? 'text-slate-100' : 'text-[#1a1b22]'}`}>
            Executive Dashboard
          </h2>
          <p className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-[#444653]'}`}>
            Overview of risk intelligence and mule account detection performance.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {/* Connection Status Badge */}
          <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-colors ${
            isBackendOnline 
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500' 
              : 'bg-amber-500/10 border-amber-500/25 text-amber-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full bg-current ${isBackendOnline ? 'animate-pulse' : ''}`} />
            {isBackendOnline ? 'Live API Connected' : 'Offline'}
          </div>

          <div className="relative">
            <select
              value={dataSource}
              onChange={(e) => setDataSource(e.target.value as DataSourceType)}
              className={`appearance-none font-sans text-xs px-3 py-2 pr-8 rounded-lg outline-none cursor-pointer border transition-colors ${
                isDark 
                  ? 'bg-black/20 border-slate-700 text-slate-350 focus:border-cyan-500' 
                  : 'bg-white border-[#c4c5d5] text-slate-700 focus:border-[#1e40af]'
              }`}
            >
              <option value="live-all" disabled={!isBackendOnline}>
                {isBackendOnline ? `Live: All Alerts (${apiAlertsCount})` : 'Live: All Alerts (Offline)'}
              </option>
              <option value="live-target" disabled={!isBackendOnline}>
                {isBackendOnline ? `Live: Mule Accounts (${apiTargetCount})` : 'Live: Mule Accounts (Offline)'}
              </option>
              <option value="live-dataset" disabled={!isBackendOnline}>
                {isBackendOnline ? `Live: Dataset Audits (${apiDatasetCount})` : 'Live: Dataset Audits (Offline)'}
              </option>
            </select>
            <Calendar size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
          </div>

          <button 
            onClick={handleGenerateReport}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${
              isDark 
                ? 'bg-cyan-500 hover:bg-cyan-600 text-[#051424] cyan-glow' 
                : 'bg-[#1e40af] hover:bg-opacity-90 text-white shadow-sm'
            }`}
          >
            <FileText size={14} />
            <span>Generate Report</span>
          </button>
        </div>
      </div>

      {/* Backend Connection Alert Banner */}
      {!isBackendOnline && (
        <div className={`p-4 border rounded-xl text-xs flex items-center justify-between transition-all duration-300 ${
          isDark 
            ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' 
            : 'bg-amber-50 border-amber-200 text-amber-700'
        }`}>
          <div className="flex items-center gap-2">
            <span className="text-sm">⚠️</span>
            <span>
              <strong>Backend Connection Issue:</strong> The FAGE FastAPI server on port 8000 is not responding.
              {apiError && <span className="block mt-1 font-mono bg-amber-500/5 p-1 rounded">Error details: {apiError}</span>}
              <span className="block mt-1">Start the backend service (by running <code>start.bat</code>) to restore live connectivity and view the dataset.</span>
            </span>
          </div>
          <button 
            onClick={() => onRefreshAlerts?.()} 
            className={`px-3 py-1.5 rounded-lg font-bold transition-all duration-200 ${
              isDark 
                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300' 
                : 'bg-amber-100 hover:bg-amber-200 text-amber-800'
            }`}
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* KPI Row (Glassmorphism Cards) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="stitch-glass-card p-6 rounded-md relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <AlertTriangle className="w-12 h-12 text-primary" />
          </div>
          <p className="text-xs font-bold tracking-widest text-on-surface-variant uppercase mb-2">Threat Level</p>
          <h3 className="text-2xl font-black text-error">{threatLevel.label}</h3>
          <div className="mt-4 h-1 w-full bg-surface-container rounded-full overflow-hidden">
            <div className="h-full bg-error shadow-[0_0_8px_rgba(255,180,171,0.5)]" style={{ width: `${threatLevel.pct}%` }}></div>
          </div>
        </div>

        <div className="stitch-glass-card p-6 rounded-md relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Building className="w-12 h-12 text-primary" />
          </div>
          <p className="text-xs font-bold tracking-widest text-on-surface-variant uppercase mb-2">Accounts Analysed</p>
          <h3 className="text-2xl font-black text-primary">{accountsAnalysed}</h3>
          <div className="flex items-center gap-1 mt-4 text-[10px] text-primary/80 font-mono">
            <span>UNIQUE SENDER IDS IN QUEUE</span>
          </div>
        </div>

        <div className="stitch-glass-card p-6 rounded-md relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <BellRing className="w-12 h-12 text-primary" />
          </div>
          <p className="text-xs font-bold tracking-widest text-on-surface-variant uppercase mb-2">Critical Alerts</p>
          <h3 className="text-2xl font-black text-primary">{criticalCount}</h3>
          <div className="mt-4 flex items-end justify-between">
            <span className="text-[10px] text-on-surface-variant">RISK SCORE ≥ 75</span>
          </div>
        </div>

        <div className="stitch-glass-card p-6 rounded-md relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Target className="w-12 h-12 text-primary" />
          </div>
          <p className="text-xs font-bold tracking-widest text-on-surface-variant uppercase mb-2">Mule / Target Vol</p>
          <h3 className="text-2xl font-black text-primary">{formatCurrency(muleVol)}</h3>
          <div className="mt-4 flex justify-between items-center">
            <span className="text-[10px] font-mono text-primary/60">EXPOSURE</span>
            <span className="text-[10px] font-mono text-on-surface-variant">FROM LIVE QUEUE</span>
          </div>
        </div>
      </div>

      {/* Main Charts area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Terminal Area (replaces old Visualizer & feed) */}
        <div className="lg:col-span-2 flex flex-col gap-6 w-full h-full">
          <div className="flex-1 flex flex-col min-h-[400px] bg-[#060a0b] border border-outline-variant/20 rounded-md overflow-hidden shadow-2xl relative group">
            {/* Terminal Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-surface-container-low border-b border-outline-variant/10">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-error/40"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-tertiary/40"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-primary/40"></div>
                </div>
                <span className="ml-4 text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-widest">Incident Console - root@fage-v2.4</span>
              </div>
            </div>
            
            {/* Live Feed integrated into Terminal */}
            <div className="p-4 flex-1 overflow-hidden">
                <LiveFeed />
            </div>

            {/* Subtle Glow */}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-primary/5 to-transparent pointer-events-none"></div>
          </div>
        </div>

        {/* Right Column: Interactive Real-Time Risk Simulator */}
        <div className="flex flex-col gap-6 w-full">
            {/* Real-time Simulator */}
            <div className="stitch-glass-card p-5 rounded-md flex flex-col">
              <div className="flex items-center gap-2 mb-4 border-b border-outline-variant/30 pb-2.5">
                <Cpu className="w-4 h-4 text-cyan-500 animate-pulse" />
                <h3 className="text-xs font-bold uppercase tracking-tight text-on-surface">Real-Time Simulator</h3>
              </div>

              {scoreResult ? (
                <div className="space-y-3 text-xs">
                  <div className={`p-3 rounded-lg border text-center ${
                    scoreResult.scores.final_risk_score >= 75 
                      ? 'bg-red-500/10 border-red-500/25 text-red-500' 
                      : scoreResult.scores.final_risk_score >= 50
                      ? 'bg-amber-500/10 border-amber-500/25 text-amber-500'
                      : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500'
                  }`}>
                    <span className="text-[10px] uppercase font-bold tracking-wider block mb-1">Decision: {scoreResult.categorizations.action_decision}</span>
                    <span className="text-3xl font-black">{scoreResult.scores.final_risk_score}</span>
                    <span className="text-[9px] block text-slate-400 mt-1">Score mapped from {Math.round(scoreResult.scores.base_ml_probability * 100)}% ML prob</span>
                  </div>
                  <button onClick={resetScoring} className="w-full py-1.5 bg-surface-container text-on-surface hover:text-primary border border-outline-variant/30 rounded font-bold text-xs mt-2 transition-colors">
                    Score New Transaction
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSimulate} className="space-y-3.5 text-[11px]">
                  {simError && (
                    <div className="p-2.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-bold">
                      {simError}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-on-surface-variant font-bold uppercase tracking-wide text-[9px]">Sender ID</label>
                      <input type="text" value={simSender} onChange={e => setSimSender(e.target.value)} className="p-1.5 text-xs rounded border border-outline-variant/30 bg-surface text-on-surface outline-none focus:border-primary" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-on-surface-variant font-bold uppercase tracking-wide text-[9px]">Receiver ID</label>
                      <input type="text" value={simReceiver} onChange={e => setSimReceiver(e.target.value)} className="p-1.5 text-xs rounded border border-outline-variant/30 bg-surface text-on-surface outline-none focus:border-primary" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-on-surface-variant font-bold uppercase tracking-wide text-[9px]">Amount (₹)</label>
                      <input type="number" value={simAmount} onChange={e => setSimAmount(e.target.value)} className="p-1.5 text-xs rounded border border-outline-variant/30 bg-surface text-on-surface outline-none focus:border-primary" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-on-surface-variant font-bold uppercase tracking-wide text-[9px]">Acct Age</label>
                      <input type="number" value={simAccountAge} onChange={e => setSimAccountAge(e.target.value)} className="p-1.5 text-xs rounded border border-outline-variant/30 bg-surface text-on-surface outline-none focus:border-primary" />
                    </div>
                  </div>
                  <button type="submit" disabled={scoringLoading} className="w-full mt-3 py-2 bg-primary/20 text-primary border border-primary/30 rounded-md font-bold text-xs transition-colors hover:bg-primary/30">
                    {scoringLoading ? "Scoring..." : "Score Transaction"}
                  </button>
                </form>
              )}
            </div>
        </div>
      </div>

      {/* Bottom recent critical alerts list panel */}

      <div className={`rounded-xl overflow-hidden stitch-glass-card ${
        isDark ? 'text-slate-300' : ''
      }`}>
        <div className="p-4 border-b border-outline-variant/30 flex justify-between items-center bg-transparent">
          <h3 className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            Recent Critical Alerts
          </h3>
          <span className="text-[10px] text-slate-400 font-semibold font-sans">Active Live Feeds</span>
        </div>

        <div className="overflow-x-auto w-full table-scroll">
          <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className={`border-b ${isDark ? 'bg-black/20 border-white/5' : 'bg-[#f4f2fc] border-[#c4c5d5]'}`}>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-wider">Account ID</th>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-wider">Alert Type</th>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-wider">Risk Score</th>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-wider">Timestamp</th>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-wider font-sans">Status</th>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-wider text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300/40 dark:divide-slate-800/60">
              {criticalRecent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-on-surface-variant text-sm">
                    {alertsLoading
                      ? 'Loading alerts…'
                      : !isBackendOnline
                      ? 'Connect to the backend to view live alerts.'
                      : 'No critical alerts match the current filter.'}
                  </td>
                </tr>
              ) : (
              criticalRecent.map((a) => (
                <tr 
                  key={a.id} 
                  className={`hover:bg-slate-300/10 dark:hover:bg-slate-850/50 transition-colors group h-12`}
                >
                  <td className="p-3 font-bold text-sky-600 dark:text-cyan-400">{a.accountNumber}</td>
                  <td className="p-3 font-semibold text-slate-600 dark:text-slate-300">{a.type}</td>
                  <td className="p-3 font-mono font-bold text-[#ba1a1a]">{a.riskScore}/100</td>
                  <td className="p-3 text-slate-400">{a.timestamp}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      a.status === 'Open' 
                        ? 'bg-[#ffdad6] text-[#93000a] dark:bg-red-950/40 dark:text-red-300 border border-red-500/20' 
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <button 
                      onClick={() => onSelectAlert(a.id)}
                      className="p-1 px-2 hover:bg-slate-400/20 dark:hover:bg-slate-700 rounded transition-colors text-[#1e40af] dark:text-cyan-300"
                      title="Inspect Workbench"
                    >
                      <Eye size={15} />
                    </button>
                  </td>
                </tr>
              ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
