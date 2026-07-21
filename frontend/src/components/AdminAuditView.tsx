import React, { useEffect, useState } from 'react';
import { SystemTheme } from '../types';
import { fageApi } from '../services/api';
import { ScrollText, RefreshCw } from 'lucide-react';

interface AdminAuditViewProps {
  theme: SystemTheme;
}

export default function AdminAuditView({ theme }: AdminAuditViewProps) {
  const isDark = theme === 'analytics';
  const [logs, setLogs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fageApi.getAuditLogs({ limit: 200 });
      setLogs(res.logs || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load audit logs (admin/auditor role required)');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h2 className={`text-2xl font-extrabold tracking-tight ${isDark ? 'text-slate-100' : 'text-[#1a1b22]'}`}>
            Governance Audit Log
          </h2>
          <p className={`text-xs mt-1 ${isDark ? 'text-slate-400' : 'text-[#444653]'}`}>
            Append-only trail of authentication and case mutations.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-outline-variant text-xs font-bold hover:bg-surface-container-high"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-error/30 bg-error-container/20 text-on-error-container text-sm">
          {error}
        </div>
      )}

      <div className={`rounded-xl overflow-hidden stitch-glass-card ${isDark ? '' : 'border border-[#c4c5d5]'}`}>
        <div className="p-3 border-b border-outline-variant/30 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
          <ScrollText size={14} />
          Recent events ({logs.length})
        </div>
        <div className="overflow-x-auto max-h-[70vh] custom-scrollbar">
          <table className="w-full text-left text-xs">
            <thead className={isDark ? 'bg-black/20' : 'bg-[#f4f2fc]'}>
              <tr>
                <th className="p-3 font-semibold text-slate-400">Time</th>
                <th className="p-3 font-semibold text-slate-400">Actor</th>
                <th className="p-3 font-semibold text-slate-400">Action</th>
                <th className="p-3 font-semibold text-slate-400">Entity</th>
                <th className="p-3 font-semibold text-slate-400">Detail</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">Loading…</td>
                </tr>
              )}
              {!loading && logs.length === 0 && !error && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">No audit events yet. Sign in and mutate an alert to generate entries.</td>
                </tr>
              )}
              {logs.map(log => (
                <tr key={log.id} className="border-t border-outline-variant/20">
                  <td className="p-3 font-mono text-[10px] whitespace-nowrap">{log.timestamp}</td>
                  <td className="p-3">
                    <div className="font-bold">{log.actor}</div>
                    <div className="text-[10px] text-slate-400">{log.role} · {log.auth_method}</div>
                  </td>
                  <td className="p-3 font-mono text-primary">{log.action}</td>
                  <td className="p-3">
                    {log.entity_type}
                    {log.entity_id ? <span className="text-slate-400"> / {log.entity_id}</span> : null}
                  </td>
                  <td className="p-3 text-slate-400 max-w-xs truncate">{log.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
