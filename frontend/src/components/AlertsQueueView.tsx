import React, { useState, useMemo } from 'react';
import {
  Search,
  Eye,
  Check,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  ArrowRight,
  UserPlus,
} from 'lucide-react';
import { Alert, SystemTheme } from '../types';
import { formatINR } from '../utils/format';

interface AlertsQueueViewProps {
  alerts: Alert[];
  onSelectAlert: (id: string) => void;
  onUpdateStatus: (id: string, status: 'Open' | 'Escalated' | 'Closed' | 'Investigating') => void;
  onUpdateAssignment?: (id: string, assignee: string) => void;
  onBulkStatus?: (ids: string[], status: 'Open' | 'Escalated' | 'Closed' | 'Investigating') => void;
  theme: SystemTheme;
  currentUserName?: string;
}

const ASSIGNEES = ['Unassigned', 'Admin (Operator)', 'SOC Analyst', 'Senior Investigator', 'Compliance Lead'];

function slaInfo(alert: Alert): { label: string; overdue: boolean; hours: number; minutesLeft: number } {
  const raw = alert.timestamp;
  let opened = Date.now();
  if (raw && raw !== 'Recent' && raw !== 'Just now') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) opened = parsed;
  }
  const hours = Math.max(0, (Date.now() - opened) / 3600000);
  const limit = alert.riskScore >= 80 ? 4 : alert.riskScore >= 50 ? 24 : 72;
  const overdue = hours > limit;
  const remainingHours = Math.max(0, limit - hours);
  const remainingMinutes = Math.floor((remainingHours % 1) * 60);
  const fullHoursLeft = Math.floor(remainingHours);

  const breachedMinutes = Math.floor(((hours - limit) % 1) * 60);
  const breachedHours = Math.floor(hours - limit);

  return {
    hours,
    overdue,
    minutesLeft: Math.floor(remainingHours * 60),
    label: overdue
      ? `Breached +${breachedHours}h ${breachedMinutes}m`
      : `${fullHoursLeft}h ${remainingMinutes}m remaining`,
  };
}

export default function AlertsQueueView({
  alerts,
  onSelectAlert,
  onUpdateStatus,
  onUpdateAssignment,
  onBulkStatus,
  theme,
  currentUserName = 'Admin (Operator)',
}: AlertsQueueViewProps) {
  const isDark = theme === 'analytics';
  const [activeQueueTab, setActiveQueueTab] = useState<'All' | 'Open' | 'Escalated' | 'Closed' | 'Investigating'>('All');
  const [searchWord, setSearchWord] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigneeFilter, setAssigneeFilter] = useState<string>('All');
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const filteredQueue = useMemo(() => {
    return alerts.filter(a => {
      const matchesTab = activeQueueTab === 'All' || a.status === activeQueueTab;
      const matchesSearch =
        a.id.toLowerCase().includes(searchWord.toLowerCase()) ||
        a.accountNumber.toLowerCase().includes(searchWord.toLowerCase()) ||
        a.receiverAccountId.toLowerCase().includes(searchWord.toLowerCase());
      const matchesAssignee =
        assigneeFilter === 'All' ||
        (a.assignedTo || 'Unassigned') === assigneeFilter;
      return matchesTab && matchesSearch && matchesAssignee;
    });
  }, [alerts, activeQueueTab, searchWord, assigneeFilter]);

  const itemsPerPage = 8;
  const totalItems = filteredQueue.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const paginatedQueue = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredQueue.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredQueue, currentPage]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
        }
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(paginatedQueue.length - 1, prev + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'Enter') {
        const targetAlert = paginatedQueue[focusedIndex];
        if (targetAlert) onSelectAlert(targetAlert.id);
      } else if (e.key === 'e' || e.key === 'E') {
        const targetAlert = paginatedQueue[focusedIndex];
        if (targetAlert && targetAlert.status !== 'Escalated') {
          onUpdateStatus(targetAlert.id, 'Escalated');
        }
      } else if (e.key === 'c' || e.key === 'C') {
        const targetAlert = paginatedQueue[focusedIndex];
        if (targetAlert && targetAlert.status !== 'Closed') {
          onUpdateStatus(targetAlert.id, 'Closed');
        }
      } else if (e.key === 'a' || e.key === 'A') {
        const targetAlert = paginatedQueue[focusedIndex];
        if (targetAlert && onUpdateAssignment) {
          onUpdateAssignment(targetAlert.id, currentUserName);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [paginatedQueue, focusedIndex, onSelectAlert, onUpdateStatus, onUpdateAssignment, currentUserName]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    const ids = paginatedQueue.map(a => a.id);
    const allSelected = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'Escalated':
        return 'bg-[#ffdad6] text-[#93000a] dark:bg-rose-950/40 dark:text-rose-300 border border-red-500/10';
      case 'Investigating':
        return 'bg-[#ffdbce] text-[#802a00] dark:bg-amber-950/45 dark:text-amber-300 border border-amber-500/10';
      case 'Closed':
        return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border border-slate-700/10';
      default:
        return 'bg-blue-50 text-blue-800 dark:bg-[#1e293b] dark:text-cyan-400 border border-cyan-500/10';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className={`text-2xl font-extrabold tracking-tight ${isDark ? 'text-slate-100' : 'text-[#1a1b22]'}`}>
            Alerts Queue
          </h2>
          <p className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-[#444653]'}`}>
            Monitor, assign, and transition suspicious transaction alerts.
          </p>
        </div>
        <div className="flex gap-4 text-xs font-sans">
          <div className={`p-2 px-3 border rounded-lg ${isDark ? 'bg-black/10 border-white/5' : 'bg-slate-50 border-[#c4c5d5]'}`}>
            <span className="text-slate-400 text-[10px] block font-semibold leading-none uppercase">Total Pending</span>
            <span className={`text-lg font-black mt-1 block leading-none ${isDark ? 'text-cyan-300' : 'text-[#1e40af]'}`}>
              {alerts.filter(a => a.status !== 'Closed').length}
            </span>
          </div>
          <div className={`p-2 px-3 border rounded-lg ${isDark ? 'bg-black/10 border-white/5' : 'bg-slate-50 border-[#c4c5d5]'}`}>
            <span className="text-slate-400 text-[10px] block font-semibold leading-none uppercase text-red-500">Escalated</span>
            <span className="text-lg font-black mt-1 block leading-none text-red-500">
              {alerts.filter(a => a.status === 'Escalated').length}
            </span>
          </div>
          <div className={`p-2 px-3 border rounded-lg ${isDark ? 'bg-black/10 border-white/5' : 'bg-slate-50 border-[#c4c5d5]'}`}>
            <span className="text-slate-400 text-[10px] block font-semibold leading-none uppercase text-amber-500">SLA Risk</span>
            <span className="text-lg font-black mt-1 block leading-none text-amber-500">
              {alerts.filter(a => a.status !== 'Closed' && slaInfo(a).overdue).length}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-300 dark:border-slate-800 pb-px text-xs font-sans">
        {(['All', 'Open', 'Escalated', 'Investigating', 'Closed'] as const).map(tab => {
          const isActive = activeQueueTab === tab;
          const count = tab === 'All' ? alerts.length : alerts.filter(a => a.status === tab).length;
          return (
            <button
              key={tab}
              onClick={() => {
                setActiveQueueTab(tab);
                setCurrentPage(1);
              }}
              className={`px-4 py-2.5 font-bold transition-all relative leading-none border-b-2 ${
                isActive
                  ? isDark
                    ? 'border-cyan-400 text-cyan-400'
                    : 'border-[#1e40af] text-[#1e40af]'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="mr-1.5">{tab}</span>
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-slate-800/40">{count}</span>
            </button>
          );
        })}
      </div>

      <div className={`p-4 rounded-xl flex flex-wrap items-center gap-3 stitch-glass-card ${isDark ? '' : 'border-[#c4c5d5]'}`}>
        <Search size={15} className="text-slate-400" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchWord}
          onChange={e => {
            setSearchWord(e.target.value);
            setCurrentPage(1);
          }}
          placeholder="Filter by Alert ID, account (press / to focus)..."
          className={`flex-1 min-w-[180px] text-xs font-sans bg-transparent outline-none ${isDark ? 'text-slate-200' : 'text-slate-800'}`}
        />
        <select
          value={assigneeFilter}
          onChange={e => {
            setAssigneeFilter(e.target.value);
            setCurrentPage(1);
          }}
          className={`text-xs px-2 py-1.5 rounded border outline-none ${isDark ? 'bg-black/20 border-white/5 text-slate-300' : 'bg-white border-slate-300'}`}
        >
          <option value="All">All assignees</option>
          {ASSIGNEES.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        {selected.size > 0 && onBulkStatus && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[10px] font-bold text-slate-400">{selected.size} selected</span>
            <button
              onClick={() => {
                onBulkStatus([...selected], 'Investigating');
                setSelected(new Set());
              }}
              className="px-2 py-1 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30"
            >
              Investigate
            </button>
            <button
              onClick={() => {
                onBulkStatus([...selected], 'Escalated');
                setSelected(new Set());
              }}
              className="px-2 py-1 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30"
            >
              Escalate
            </button>
            <button
              onClick={() => {
                onBulkStatus([...selected], 'Closed');
                setSelected(new Set());
              }}
              className="px-2 py-1 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
            >
              Close
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="px-2 py-1 rounded text-[10px] font-bold text-slate-400"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono font-semibold px-1 text-slate-400">
        <span>KEYBOARD SHORTCUTS</span>
        <div className="flex flex-wrap items-center gap-4">
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">j</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">k</kbd> Navigate</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">Enter</kbd> Review</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">e</kbd> Escalate</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">c</kbd> Close</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">a</kbd> Assign to me</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">/</kbd> Search</span>
        </div>
      </div>

      <div className={`rounded-xl overflow-hidden stitch-glass-card ${isDark ? '' : 'border-[#c4c5d5]'}`}>
        <div className="table-scroll overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className={`border-b ${isDark ? 'bg-black/20 border-white/5' : 'bg-[#f4f2fc] border-[#c4c5d5]'}`}>
                <th className="p-3 w-8">
                  <input
                    type="checkbox"
                    checked={paginatedQueue.length > 0 && paginatedQueue.every(a => selected.has(a.id))}
                    onChange={toggleSelectAllPage}
                    aria-label="Select all on page"
                  />
                </th>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-widest font-mono">Alert ID</th>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-widest font-mono">Account</th>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-widest font-mono">Amount</th>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-widest font-mono">Risk</th>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-widest font-mono">SLA</th>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-widest font-mono">Assignee</th>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-widest font-mono">Status</th>
                <th className="p-3 font-semibold text-slate-400 uppercase tracking-widest font-mono text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300/30 dark:divide-slate-850/60">
              {paginatedQueue.length > 0 ? (
                paginatedQueue.map((a, idx) => {
                  const sla = slaInfo(a);
                  const isFocused = idx === focusedIndex;
                  return (
                    <tr
                      key={a.id}
                      onClick={() => setFocusedIndex(idx)}
                      className={`transition-all h-14 cursor-pointer ${
                        isFocused
                          ? 'bg-cyan-500/15 dark:bg-cyan-500/20 ring-2 ring-inset ring-cyan-500 dark:ring-cyan-400 font-medium'
                          : 'hover:bg-slate-300/10 dark:hover:bg-slate-800/10'
                      }`}
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selected.has(a.id)}
                          onChange={() => toggleSelect(a.id)}
                          aria-label={`Select ${a.id}`}
                        />
                      </td>
                      <td className="p-3 font-bold font-mono text-sky-600 dark:text-cyan-400">{a.id}</td>
                      <td className="p-3 font-mono font-semibold">{a.accountNumber}</td>
                      <td className="p-3 font-mono">{formatINR(a.transactionAmount)}</td>
                      <td className="p-3">
                        <span className={`font-black font-mono ${a.riskScore >= 80 ? 'text-red-500' : 'text-slate-400'}`}>
                          {a.riskScore}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sla.overdue ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                          {sla.label}
                        </span>
                      </td>
                      <td className="p-3">
                        {onUpdateAssignment ? (
                          <select
                            value={a.assignedTo || 'Unassigned'}
                            onChange={e => onUpdateAssignment(a.id, e.target.value)}
                            className={`text-[10px] px-1.5 py-1 rounded border max-w-[140px] outline-none ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-white border-slate-300'}`}
                          >
                            {ASSIGNEES.map(name => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                            {!ASSIGNEES.includes(a.assignedTo || 'Unassigned') && a.assignedTo && (
                              <option value={a.assignedTo}>{a.assignedTo}</option>
                            )}
                          </select>
                        ) : (
                          <span>{a.assignedTo || 'Unassigned'}</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getStatusStyle(a.status)}`}>
                          {a.status}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {a.status !== 'Closed' && (
                            <button onClick={() => onUpdateStatus(a.id, 'Closed')} className="p-1 text-slate-400 hover:text-emerald-500 rounded" title="Close">
                              <Check size={14} />
                            </button>
                          )}
                          {a.status !== 'Escalated' && (
                            <button onClick={() => onUpdateStatus(a.id, 'Escalated')} className="p-1 text-slate-400 hover:text-red-500 rounded" title="Escalate">
                              <ShieldAlert size={14} />
                            </button>
                          )}
                          {onUpdateAssignment && (
                            <button
                              onClick={() => onUpdateAssignment(a.id, currentUserName)}
                              className="p-1 text-slate-400 hover:text-cyan-400 rounded"
                              title="Assign to me"
                            >
                              <UserPlus size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => onSelectAlert(a.id)}
                            className="p-1 px-2.5 text-sky-600 dark:text-cyan-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded flex items-center gap-1 font-bold"
                          >
                            <span>Review</span>
                            <ArrowRight size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400 font-semibold">
                    No matching accounts in active queue.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={`p-4 border-t flex items-center justify-between ${isDark ? 'border-slate-800' : 'border-[#c4c5d5]'}`}>
          <span className="text-xs text-slate-400 font-semibold">
            Showing {totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems}
          </span>
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className={`p-1.5 rounded border ${currentPage === 1 ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <ChevronLeft size={13} />
            </button>
            <span className="px-2">{currentPage} / {totalPages}</span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className={`p-1.5 rounded border ${currentPage === totalPages ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
