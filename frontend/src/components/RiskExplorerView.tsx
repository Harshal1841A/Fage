import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Download, 
  Plus, 
  SlidersHorizontal,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  AlertTriangle,
  Flame,
  Info,
  CheckCircle,
  HelpCircle
} from 'lucide-react';
import { Alert, SystemTheme } from '../types';
import { BatchUpload } from './BatchUpload';
import { formatINR } from '../utils/format';

interface RiskExplorerViewProps {
  alerts: Alert[];
  onSelectAlert: (id: string) => void;
  theme: SystemTheme;
}

export default function RiskExplorerView({ alerts, onSelectAlert, theme }: RiskExplorerViewProps) {
  const isDark = theme === 'analytics';
  const [searchQuery, setSearchQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState('All');
  const [timeframe, setTimeframe] = useState('7 Days');
  const [currentPage, setCurrentPage] = useState(1);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [minScore, setMinScore] = useState<number | ''>('');
  const [maxScore, setMaxScore] = useState<number | ''>('');

  const handleExportCSV = () => {
    const headers = ['Account ID', 'Risk Score', 'Risk Tier', 'Confidence', 'Alert Severity'];
    const rows = filteredAlerts.map(a => [
      a.accountNumber,
      a.riskScore,
      a.riskScore >= 90 ? 'Critical' : a.riskScore >= 80 ? 'High' : a.riskScore >= 60 ? 'Medium' : 'Low',
      a.confidence,
      a.prio
    ]);
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${val}"`).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `FAGE_Risk_Explorer_Report_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCreateWatchlist = () => {
    const name = window.prompt("Enter a name for the new watchlist:");
    if (name) {
      alert(`Watchlist "${name}" created successfully with ${filteredAlerts.length} entities!`);
    }
  };

  // Filter & Search computation
  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      // Search matching
      const matchesSearch = 
        a.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.accountNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.receiverAccountId.toLowerCase().includes(searchQuery.toLowerCase());

      // Risk level filter matching
      const matchesRisk = 
        riskFilter === 'All' ||
        (riskFilter === 'Critical' && a.riskScore >= 90) ||
        (riskFilter === 'High' && a.riskScore >= 80 && a.riskScore < 90) ||
        (riskFilter === 'Medium' && a.riskScore >= 60 && a.riskScore < 80) ||
        (riskFilter === 'Low' && a.riskScore < 60);

      const matchesMin = minScore === '' || a.riskScore >= minScore;
      const matchesMax = maxScore === '' || a.riskScore <= maxScore;

      return matchesSearch && matchesRisk && matchesMin && matchesMax;
    });
  }, [alerts, searchQuery, riskFilter, minScore, maxScore]);

  // Pagination bounds
  const itemsPerPage = 5;
  const totalItems = filteredAlerts.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const paginatedAlerts = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredAlerts.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredAlerts, currentPage]);

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };

  const getSeverityBadge = (prio: string) => {
    switch (prio) {
      case 'P1 - Immediate':
        return (
          <span className="flex items-center gap-1.5 text-xs font-bold text-red-500">
            <Flame size={13} className="text-red-500 fill-current animate-pulse" />
            <span>P1 - Immediate</span>
          </span>
        );
      case 'P2 - Review':
        return (
          <span className="flex items-center gap-1.5 text-xs font-bold text-amber-500">
            <AlertTriangle size={13} />
            <span>P2 - Review</span>
          </span>
        );
      case 'P3 - Monitor':
        return (
          <span className="flex items-center gap-1.5 text-xs font-bold text-sky-500">
            <Info size={13} />
            <span>P3 - Monitor</span>
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1.5 text-xs font-bold text-slate-400">
            <CheckCircle size={13} />
            <span>Routine</span>
          </span>
        );
    }
  };

  const getRiskTierBadge = (score: number) => {
    if (score >= 90) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[#ffdad6] text-[#93000a] dark:bg-red-950/40 dark:text-red-300 border border-red-500/15">
          Critical
        </span>
      );
    } else if (score >= 80) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[#ffdbce] text-[#802a00] dark:bg-amber-950/40 dark:text-amber-300 border border-amber-500/15">
          High
        </span>
      );
    } else if (score >= 60) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-700/10">
          Medium
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[#f4f2fc] text-slate-500 dark:bg-black/20 dark:text-slate-400 border border-slate-700/5">
          Low
        </span>
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Risk Explorer Header Top Banner */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className={`text-2xl font-extrabold tracking-tight ${isDark ? 'text-slate-100' : 'text-[#1a1b22]'}`}>
            Risk Explorer
          </h2>
          <p className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-[#444653]'}`}>
            Deep investigation view for high-confidence alerts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={handleExportCSV}
            className={`flex items-center gap-2 h-10 px-4 py-2 border rounded-lg text-xs font-bold transition-all duration-300 ${
              isDark 
                ? 'bg-transparent border-slate-800 hover:bg-slate-800 text-slate-300' 
                : 'bg-white border-[#c4c5d5] text-slate-700 hover:bg-slate-100 shadow-sm'
            }`}
          >
            <Download size={14} />
            <span>Export Report</span>
          </button>
          
          <button 
            onClick={handleCreateWatchlist}
            className={`flex items-center gap-2 h-10 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 ${
              isDark 
                ? 'bg-cyan-500 hover:bg-cyan-600 text-[#051424] cyan-glow' 
                : 'bg-[#1e40af] hover:bg-opacity-95 text-white'
            }`}
          >
            <Plus size={14} />
            <span>Create Watchlist</span>
          </button>
        </div>
      </div>

      {/* Batch Upload Section */}
      <BatchUpload />

      {/* Global deep searching widgets */}
      <div className={`p-4 rounded-xl flex flex-col md:flex-row gap-4 items-end stitch-glass-card ${
        isDark ? '' : 'border-[#c4c5d5]'
      }`}>
        <div className="w-full md:flex-1 flex flex-col gap-1.5">
          <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">Entity Target Input</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Search size={15} />
            </span>
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              placeholder="Search by ID, Name, SSN, or Account Number..."
              className={`w-full text-xs font-sans pl-10 pr-4 py-2.5 rounded-lg border outline-none focus:ring-1 transition-all ${
                isDark 
                  ? 'bg-black/20 border-slate-800 text-slate-300 focus:border-cyan-500 focus:ring-cyan-500' 
                  : 'bg-white border-[#c4c5d5] text-slate-700 focus:border-[#1e40af] focus:ring-[#1e40af]'
              }`}
            />
          </div>
        </div>

        <div className="w-full md:w-auto flex flex-wrap sm:flex-nowrap gap-3">
          <div className="flex flex-col gap-1.5 min-w-[130px]">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">Risk Filter</label>
            <div className="relative">
              <select
                value={riskFilter}
                onChange={(e) => { setRiskFilter(e.target.value); setCurrentPage(1); }}
                className={`w-full appearance-none font-sans text-xs px-3 py-2.5 pr-8 rounded-lg outline-none cursor-pointer border ${
                  isDark 
                    ? 'bg-black/20 border-slate-800 text-slate-300 focus:border-cyan-500' 
                    : 'bg-white border-[#c4c5d5] text-slate-700 focus:border-[#1e40af]'
                }`}
              >
                <option value="All">Risk Tier: All</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5 min-w-[140px]">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">Series Period</label>
            <div className="relative">
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className={`w-full appearance-none font-sans text-xs px-3 py-2.5 pr-8 rounded-lg outline-none cursor-pointer border ${
                  isDark 
                    ? 'bg-black/20 border-slate-800 text-slate-300' 
                    : 'bg-white border-[#c4c5d5] text-slate-700'
                }`}
              >
                <option>Timeframe: 7 Days</option>
                <option>24 Hours</option>
                <option>30 Days</option>
                <option>90 Days</option>
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
            </div>
          </div>

          <button 
            onClick={() => setShowMoreFilters(!showMoreFilters)}
            className={`h-10 self-end px-3.5 flex items-center gap-2 border rounded-lg text-xs font-bold transition-all duration-300 ${
              isDark 
                ? `border-slate-800 hover:bg-slate-800 ${showMoreFilters ? 'bg-slate-800 text-cyan-400' : 'bg-black/20 text-slate-400 hover:text-slate-200'}` 
                : `${showMoreFilters ? 'bg-slate-100 text-[#1e40af] border-[#1e40af]' : 'bg-white border-[#c4c5d5] text-slate-700 hover:bg-slate-100'} shadow-sm`
            }`}
          >
            <SlidersHorizontal size={13} />
            <span>More Filters</span>
          </button>
        </div>
      </div>

      {showMoreFilters && (
        <div className={`p-4 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-4 stitch-glass-card ${
          isDark ? 'text-slate-300' : 'border-[#c4c5d5]'
        }`}>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">Min Risk Score</label>
            <input 
              type="number"
              min="0"
              max="100"
              value={minScore}
              onChange={(e) => {
                const val = e.target.value === '' ? '' : Number(e.target.value);
                setMinScore(val);
                setCurrentPage(1);
              }}
              placeholder="E.g., 50"
              className={`text-xs px-3 py-2 rounded-lg border outline-none ${
                isDark 
                  ? 'bg-black/20 border-slate-800 text-slate-300 focus:border-cyan-500' 
                  : 'bg-white border-[#c4c5d5] text-slate-700 focus:border-[#1e40af]'
              }`}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 font-mono">Max Risk Score</label>
            <input 
              type="number"
              min="0"
              max="100"
              value={maxScore}
              onChange={(e) => {
                const val = e.target.value === '' ? '' : Number(e.target.value);
                setMaxScore(val);
                setCurrentPage(1);
              }}
              placeholder="E.g., 95"
              className={`text-xs px-3 py-2 rounded-lg border outline-none ${
                isDark 
                  ? 'bg-black/20 border-slate-800 text-slate-300 focus:border-cyan-500' 
                  : 'bg-white border-[#c4c5d5] text-slate-700 focus:border-[#1e40af]'
              }`}
            />
          </div>
        </div>
      )}

      {/* Main Database Table Area */}
      <div className={`rounded-xl overflow-hidden stitch-glass-card ${
        isDark ? '' : 'border-[#c4c5d5]'
      }`}>
        <div className="table-scroll overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className={`border-b ${isDark ? 'bg-black/20 border-slate-800' : 'bg-[#f4f2fc] border-[#c4c5d5]'}`}>
                <th className="p-3.5 font-semibold text-slate-400 uppercase tracking-widest font-mono">Account ID</th>
                <th className="p-3.5 font-semibold text-slate-400 uppercase tracking-widest font-mono">Amount (₹)</th>
                <th className="p-3.5 font-semibold text-slate-400 uppercase tracking-widest font-mono">Risk Score</th>
                <th className="p-3.5 font-semibold text-slate-400 uppercase tracking-widest font-mono">Risk Tier</th>
                <th className="p-3.5 font-semibold text-slate-400 uppercase tracking-widest font-mono">Triage Route</th>
                <th className="p-3.5 font-semibold text-slate-400 uppercase tracking-widest font-mono">Confidence</th>
                <th className="p-3.5 font-semibold text-slate-400 uppercase tracking-widest font-mono">Alert Severity</th>
                <th className="p-3.5 font-semibold text-slate-400 uppercase tracking-widest font-mono text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300/40 dark:divide-slate-800/60">
              {paginatedAlerts.length > 0 ? (
                paginatedAlerts.map((a) => {
                  const barColor = a.riskScore >= 90 ? 'bg-red-500' : a.riskScore >= 80 ? 'bg-amber-500' : 'bg-indigo-500';
                  
                  return (
                    <tr 
                      key={a.id} 
                      className="hover:bg-slate-300/10 dark:hover:bg-white/5 transition-colors group h-14"
                    >
                      <td className="p-3.5 font-bold">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${barColor}`}></span>
                          <span className="text-sky-600 dark:text-cyan-400 font-mono tracking-wide">{a.accountNumber}</span>
                        </div>
                      </td>
                      <td className="p-3.5 font-mono font-medium text-slate-300">{formatINR(a.transactionAmount)}</td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-bold ${a.riskScore >= 80 ? 'text-red-500' : 'text-slate-500'}`}>{a.riskScore.toFixed(1)}</span>
                          <div className="w-16 h-1.5 bg-slate-200 dark:bg-black/30 rounded-full overflow-hidden">
                            <div className={`h-full ${barColor}`} style={{ width: `${a.riskScore}%` }}></div>
                          </div>
                        </div>
                      </td>
                      <td className="p-3.5 font-semibold">{getRiskTierBadge(a.riskScore)}</td>
                      <td className="p-3.5">
                        {a.triage_action ? (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            a.triage_action === 'FAST_TRACK_FREEZE'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : a.triage_action === 'PRIORITY_MANUAL_REVIEW'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : a.triage_action === 'INDEPENDENT_SIGNAL_CHECK'
                              ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                              : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                          }`}>
                            {a.triage_action.replace(/_/g, ' ')}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[10px] uppercase font-semibold">Standard</span>
                        )}
                      </td>
                      <td className="p-3.5 font-mono text-slate-400 font-semibold whitespace-nowrap">
                        <span className="inline-block whitespace-nowrap">{a.confidenceVal.toFixed(1)}%</span>
                        {a.pu_probability && (
                          <span className="block text-[9px] text-purple-400 whitespace-nowrap">PU: {(a.pu_probability * 100).toFixed(0)}%</span>
                        )}
                      </td>
                      <td className="p-3.5">{getSeverityBadge(a.prio)}</td>
                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => onSelectAlert(a.id)}
                          className="p-1 px-2 text-indigo-500 hover:bg-slate-400/20 dark:hover:bg-white/10 rounded transition-all transform hover:scale-105"
                          title="Review Node"
                        >
                          <Eye size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400 font-semibold">
                    No high-risk accounts matched the filtered parameters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Database Table Pagination Footer Selector */}
        <div className={`p-4 rounded-xl stitch-glass-card border-t border-slate-700/20 flex items-center justify-between font-sans ${
          isDark ? '' : 'border-[#c4c5d5]'
        }`}>
          <span className="text-xs text-slate-400 font-medium">
            Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} results
          </span>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className={`p-1.5 rounded border transition-colors ${
                currentPage === 1 
                  ? 'opacity-40 cursor-not-allowed' 
                  : (isDark ? 'border-slate-800 text-slate-300 hover:bg-slate-800' : 'border-[#c4c5d5] text-slate-700 hover:bg-slate-100')
              }`}
            >
              <ChevronLeft size={13} />
            </button>

            {Array.from({ length: totalPages }).map((_, i) => {
              const p = i + 1;
              const isCurrent = currentPage === p;
              
              let countClass = "w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-all ";
              if (isCurrent) {
                countClass += isDark ? 'bg-cyan-500 text-[#051424] shadow-sm' : 'bg-[#dde1ff] text-[#001453] border border-[#1e40af]/20';
              } else {
                countClass += isDark ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-600';
              }

              return (
                <button
                  key={p}
                  onClick={() => handlePageChange(p)}
                  className={countClass}
                >
                  {p}
                </button>
              );
            })}

            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className={`p-1.5 rounded border transition-colors ${
                currentPage === totalPages 
                  ? 'opacity-40 cursor-not-allowed' 
                  : (isDark ? 'border-slate-800 text-slate-300 hover:bg-slate-800' : 'border-[#c4c5d5] text-slate-700 hover:bg-slate-100')
              }`}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
