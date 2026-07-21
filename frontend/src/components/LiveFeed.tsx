import React, { useEffect, useState } from 'react';
import { AlertInfo } from '../services/api';
import { formatINR } from '../utils/format';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export const LiveFeed: React.FC = () => {
  const [alerts, setAlerts] = useState<AlertInfo[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    const url = new URL('/api/stream-alerts', window.location.origin);
    const token = localStorage.getItem('fage_access_token') || import.meta.env.VITE_FAGE_API_KEY || '';
    if (token) url.searchParams.append('token', token);
    const eventSource = new EventSource(url.toString());

    eventSource.onopen = () => setStatus('connected');

    eventSource.onmessage = (event) => {
      try {
        const newAlert = JSON.parse(event.data);
        if (newAlert?.id) {
          setAlerts(prev => {
            if (prev.some(a => a.id === newAlert.id)) return prev;
            return [newAlert, ...prev].slice(0, 50);
          });
        }
      } catch {
        // keep-alive ping
      }
    };

    eventSource.onerror = () => {
      setStatus(prev => (prev === 'connected' ? 'disconnected' : prev === 'connecting' ? 'disconnected' : prev));
    };

    return () => eventSource.close();
  }, []);

  const statusLabel =
    status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Disconnected';
  const statusColor =
    status === 'connected' ? 'bg-primary animate-pulse' : status === 'connecting' ? 'bg-tertiary animate-pulse' : 'bg-error';

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 w-full h-64 overflow-y-auto custom-scrollbar">
      <h3 className="text-sm font-semibold text-on-surface-variant mb-2 uppercase tracking-widest flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${statusColor}`} />
        Live Alert Stream
        <span className="ml-auto text-[9px] font-bold normal-case tracking-normal text-on-surface-variant/70">{statusLabel}</span>
      </h3>
      <div className="flex flex-col gap-2 mt-4">
        {alerts.length === 0 ? (
          <p className="text-on-surface-variant/60 text-xs italic">
            {status === 'disconnected'
              ? 'Stream unavailable — check backend connection.'
              : status === 'connecting'
              ? 'Establishing live stream…'
              : 'Awaiting live transactions…'}
          </p>
        ) : (
          alerts.map(a => (
            <div
              key={a.id}
              className="text-xs p-3 bg-surface-container-low rounded-lg border border-outline-variant/40 hover:border-primary/40 transition-colors duration-200"
            >
              <div className="flex justify-between items-center">
                <span className="text-primary font-mono font-bold">
                  {a.timestamp?.split('T')[1]?.split('Z')[0] ?? '—'}
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold ${
                    a.risk_score >= 76
                      ? 'bg-error-container text-on-error-container border border-error/30'
                      : a.risk_score >= 50
                      ? 'bg-tertiary-container text-on-tertiary-container border border-tertiary/30'
                      : 'bg-surface-container-high text-on-surface-variant border border-outline-variant/30'
                  }`}
                >
                  Score: {a.risk_score}
                </span>
              </div>
              <div className="mt-1 flex justify-between text-on-surface-variant">
                <span className="truncate mr-2">{a.id}</span>
                <span className="shrink-0">{formatINR(a.amount)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
