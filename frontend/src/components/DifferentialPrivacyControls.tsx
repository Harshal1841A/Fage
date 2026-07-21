import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  AlertTriangle, 
  RefreshCw, 
  Download, 
  EyeOff, 
  Sliders, 
  Activity, 
  CheckCircle2, 
  Database,
  FileSpreadsheet,
  TrendingUp,
  Key
} from 'lucide-react';
import { 
  apiService, 
  DPBudgetStatus, 
  DPMetricsResponse, 
  DPGraphSummaryResponse 
} from '../services/api';

interface DifferentialPrivacyControlsProps {
  theme: 'dark' | 'light';
}

export default function DifferentialPrivacyControls({ theme }: DifferentialPrivacyControlsProps) {
  const isDark = theme === 'dark';

  const [budgetStatus, setBudgetStatus] = useState<DPBudgetStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Parameter configuration
  const [epsilon, setEpsilon] = useState<number>(0.5);
  const [mechanism, setMechanism] = useState<'laplace' | 'gaussian'>('laplace');
  const [resetEpsilonVal, setResetEpsilonVal] = useState<number>(10.0);

  // Results
  const [dpMetrics, setDpMetrics] = useState<DPMetricsResponse | null>(null);
  const [dpGraphSummary, setDpGraphSummary] = useState<DPGraphSummaryResponse | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiService.getDPGovernanceStatus();
      if (res && res.budget_status) {
        setBudgetStatus(res.budget_status);
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.detail || err?.message || 'Failed to fetch DP governance status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleExportMetrics = async () => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiService.getDPModelMetrics(epsilon, mechanism);
      setDpMetrics(res);
      if (res && res.budget_status) {
        setBudgetStatus(res.budget_status);
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.detail || err?.message || 'Failed to export DP model metrics.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleExportGraphSummary = async () => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiService.exportDPGraphSummary({ epsilon, mechanism });
      setDpGraphSummary(res);
      if (res && res.budget_status) {
        setBudgetStatus(res.budget_status);
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.detail || err?.message || 'Failed to export DP graph topology.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetBudget = async () => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await apiService.resetDPGovernanceBudget(resetEpsilonVal);
      if (res && res.budget_status) {
        setBudgetStatus(res.budget_status);
      }
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.detail || err?.message || 'Failed to reset privacy budget. Require admin role.');
    } finally {
      setActionLoading(false);
    }
  };

  const budgetPct = budgetStatus ? Math.min(100, Math.max(0, (budgetStatus.spent_epsilon / maxEps(budgetStatus.max_epsilon)) * 100)) : 0;
  function maxEps(m: number | undefined) { return m || 10.0; }

  return (
    <div className="space-y-6 text-on-surface">
      {/* Top Banner */}
      <div className="p-6 rounded-2xl border border-outline-variant/60 bg-surface-container-low shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 text-primary">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-on-surface">Differential Privacy & Re-Identification Risk Engine</h2>
                <span className="px-2.5 py-0.5 text-xs font-mono font-bold rounded-full bg-primary/10 text-primary border border-primary/20">
                  Regulator-Grade (ε-DP)
                </span>
              </div>
              <p className="text-sm mt-1 text-on-surface-variant">
                Provides mathematical guarantees (ε-Laplace / Gaussian noise) against linkage and re-identification attacks when exporting model telemetry and graph summaries.
              </p>
            </div>
          </div>
          <button
            onClick={fetchStatus}
            disabled={loading || actionLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-outline-variant bg-surface-container hover:bg-surface-container-high text-on-surface transition-all btn-micro"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Status
          </button>
        </div>

        {errorMessage && (
          <div className="mt-4 p-4 rounded-xl bg-error/10 border border-error/20 flex items-center gap-3 text-error text-sm">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      {/* Privacy Budget Ledger Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Budget Gauge & Status */}
        <div className="p-6 rounded-2xl border border-outline-variant/60 bg-surface-container-low shadow-sm md:col-span-1 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Privacy Budget Ledger (ε)
              </span>
              <span className={`px-2 py-0.5 text-xs font-mono font-bold rounded-full ${
                budgetStatus?.budget_status.includes('Exhausted')
                  ? 'bg-error/10 text-error border border-error/20'
                  : budgetStatus?.budget_status.includes('Warning')
                  ? 'bg-tertiary/10 text-tertiary border border-tertiary/20'
                  : 'bg-primary/10 text-primary border border-primary/20'
              }`}>
                {budgetStatus?.budget_status || 'Checking...'}
              </span>
            </div>

            <div className="mt-2">
              <div className="flex justify-between items-baseline mb-2">
                <span className="text-3xl font-extrabold tracking-tight text-primary font-mono">
                  {budgetStatus?.spent_epsilon ?? 0.0} <span className="text-sm font-normal font-sans text-on-surface-variant">/ {budgetStatus?.max_epsilon ?? 10.0} ε spent</span>
                </span>
              </div>
              <div className="w-full bg-surface-container-highest rounded-full h-3 overflow-hidden border border-outline-variant/40">
                <div 
                  className={`h-full transition-all duration-500 ${
                    budgetPct > 80 ? 'bg-error' : budgetPct > 50 ? 'bg-tertiary' : 'bg-primary'
                  }`}
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs mt-2 text-on-surface-variant font-mono">
                <span>Remaining: {budgetStatus?.remaining_epsilon ?? 10.0} ε</span>
                <span>Total Queries: {budgetStatus?.total_queries_serviced ?? 0}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-outline-variant/40">
            <label className="block text-xs font-semibold text-on-surface-variant mb-2">
              Reset Privacy Ledger (ε_max)
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                step="1.0"
                min="1.0"
                max="100.0"
                value={resetEpsilonVal}
                onChange={(e) => setResetEpsilonVal(parseFloat(e.target.value) || 10.0)}
                className="w-24 px-3 py-1.5 text-sm rounded-xl border border-outline-variant bg-surface-container focus:outline-none focus:ring-2 focus:ring-primary text-on-surface font-mono"
              />
              <button
                onClick={handleResetBudget}
                disabled={actionLoading}
                className="flex-1 py-1.5 px-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:brightness-110 transition-all shadow-md btn-micro"
              >
                Reset Ledger
              </button>
            </div>
          </div>
        </div>

        {/* Query Ledger Audit History */}
        <div className="p-6 rounded-2xl border border-outline-variant/60 bg-surface-container-low shadow-sm md:col-span-2 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              <h3 className="font-bold text-base text-on-surface">Audit Ledger (ε-DP Consumption Log)</h3>
            </div>
            <span className="text-xs font-mono text-on-surface-variant">Recent 10 exports</span>
          </div>

          <div className="flex-1 overflow-x-auto">
            {(!budgetStatus?.ledger_summary || budgetStatus.ledger_summary.length === 0) ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-8 text-on-surface-variant">
                <Lock className="w-8 h-8 opacity-40 mb-2" />
                <p className="text-sm">No privacy-consuming queries executed yet.</p>
                <p className="text-xs opacity-75">Configure parameters below and export graph topology or metrics.</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-outline-variant/60 text-on-surface-variant">
                    <th className="py-2.5 font-semibold">Timestamp</th>
                    <th className="py-2.5 font-semibold">Query Type</th>
                    <th className="py-2.5 font-semibold">Mechanism</th>
                    <th className="py-2.5 font-semibold text-right">Cost (ε)</th>
                    <th className="py-2.5 font-semibold text-right">Noise Scale</th>
                    <th className="py-2.5 font-semibold text-right">Cumulative</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {budgetStatus.ledger_summary.slice().reverse().map((item, idx) => (
                    <tr key={idx} className="hover:bg-surface-container/50 transition-colors">
                      <td className="py-2.5 text-on-surface-variant font-mono text-xs">
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="py-2.5 font-medium">
                        <span className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded-md ${
                          item.query_type.includes('RESET') 
                            ? 'bg-secondary/10 text-secondary border border-secondary/20' 
                            : 'bg-primary/10 text-primary border border-primary/20'
                        }`}>
                          {item.query_type}
                        </span>
                      </td>
                      <td className="py-2.5 text-on-surface font-medium">{item.mechanism}</td>
                      <td className="py-2.5 font-bold text-right text-tertiary font-mono">+{item.epsilon_cost.toFixed(3)}</td>
                      <td className="py-2.5 text-right font-mono text-on-surface-variant">{item.noise_scale ? item.noise_scale.toFixed(4) : '-'}</td>
                      <td className="py-2.5 font-mono text-right text-on-surface font-bold">{item.cumulative_spent ? item.cumulative_spent.toFixed(3) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Noise Injection Configuration Panel */}
      <div className="p-6 rounded-2xl border border-outline-variant/60 bg-surface-container-low shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <Sliders className="w-5 h-5 text-primary" />
          <h3 className="font-bold text-base text-on-surface">Noise Injection & Calibration Controls</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
          {/* Epsilon Slider */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-semibold text-on-surface-variant">
                Privacy Epsilon Budget (ε)
              </label>
              <span className="font-mono text-sm font-bold text-primary">{epsilon.toFixed(2)} ε</span>
            </div>
            <input
              type="range"
              min="0.05"
              max="2.0"
              step="0.05"
              value={epsilon}
              onChange={(e) => setEpsilon(parseFloat(e.target.value))}
              className="w-full h-2 bg-surface-container rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between text-[11px] font-mono text-on-surface-variant/70 mt-1">
              <span>0.05 (High Privacy / High Noise)</span>
              <span>2.0 (High Utility / Low Noise)</span>
            </div>
          </div>

          {/* Mechanism Selector */}
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-2">
              Noise Mechanism
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMechanism('laplace')}
                className={`py-2 px-3 rounded-xl border text-xs flex items-center justify-center gap-1.5 transition-all btn-micro ${
                  mechanism === 'laplace'
                    ? 'bg-primary/10 border-primary text-primary font-bold shadow-sm'
                    : 'bg-surface-container border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high font-medium'
                }`}
              >
                <EyeOff className="w-3.5 h-3.5" />
                Laplace (ε-DP L1)
              </button>
              <button
                type="button"
                onClick={() => setMechanism('gaussian')}
                className={`py-2 px-3 rounded-xl border text-xs flex items-center justify-center gap-1.5 transition-all btn-micro ${
                  mechanism === 'gaussian'
                    ? 'bg-primary/10 border-primary text-primary font-bold shadow-sm'
                    : 'bg-surface-container border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high font-medium'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                Gaussian (ε, δ-DP L2)
              </button>
            </div>
          </div>

          {/* Export Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleExportMetrics}
              disabled={actionLoading}
              className="flex-1 py-2.5 px-4 rounded-xl bg-primary hover:brightness-110 text-on-primary font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-md btn-micro"
            >
              <Download className="w-4 h-4" />
              Export DP Metrics
            </button>
            <button
              onClick={handleExportGraphSummary}
              disabled={actionLoading}
              className="flex-1 py-2.5 px-4 rounded-xl bg-secondary hover:brightness-110 text-on-secondary font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-md btn-micro"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Export DP Graph
            </button>
          </div>
        </div>
      </div>

      {/* Re-Identification Risk & Export Results Grid */}
      {(dpGraphSummary || dpMetrics) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Graph Topology Summary & ReID Assessment */}
          {dpGraphSummary && (
            <div className="p-6 rounded-2xl border border-outline-variant/60 bg-surface-container-low shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b pb-3 border-outline-variant/60">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-secondary" />
                  <h4 className="font-bold text-base text-on-surface">Noisy Graph Topology Export</h4>
                </div>
                <span className="px-2.5 py-0.5 text-xs font-bold font-mono rounded-full bg-secondary/10 text-secondary border border-secondary/20">
                  {dpGraphSummary.privacy_guarantee}
                </span>
              </div>

              {/* Re-Identification Risk Badge */}
              <div className="p-4 rounded-xl bg-surface-container/60 border border-outline-variant/60 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Re-Identification Risk Score</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xl font-extrabold font-mono ${
                      dpGraphSummary.reidentification_risk_assessment.reid_risk_score > 0.6 ? 'text-error' :
                      dpGraphSummary.reidentification_risk_assessment.reid_risk_score > 0.3 ? 'text-tertiary' : 'text-primary'
                    }`}>
                      {(dpGraphSummary.reidentification_risk_assessment.reid_risk_score * 100).toFixed(1)}%
                    </span>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface">
                      {dpGraphSummary.reidentification_risk_assessment.risk_level}
                    </span>
                  </div>
                </div>
                <div className="text-right text-xs text-on-surface-variant space-y-1 font-mono">
                  <div>k-Anonymity Est: <span className="font-mono font-bold text-on-surface">k ≥ {dpGraphSummary.reidentification_risk_assessment.k_anonymity_estimate}</span></div>
                  <div>l-Diversity Index: <span className="font-mono font-bold text-on-surface">l = {dpGraphSummary.reidentification_risk_assessment.l_diversity_index}</span></div>
                </div>
              </div>

              <div className="text-xs text-on-surface-variant bg-primary/5 p-3.5 rounded-xl border border-primary/20 leading-relaxed">
                <span className="font-bold text-primary mr-1">Recommendation:</span> {dpGraphSummary.reidentification_risk_assessment.recommendation}
              </div>

              {/* Noisy Counts Grid */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="p-3.5 rounded-xl bg-surface-container/60 border border-outline-variant/40">
                  <span className="text-xs text-on-surface-variant font-medium">Noisy Node Count</span>
                  <div className="text-lg font-bold font-mono mt-1 text-on-surface">{dpGraphSummary.noisy_summary.node_count_dp}</div>
                </div>
                <div className="p-3.5 rounded-xl bg-surface-container/60 border border-outline-variant/40">
                  <span className="text-xs text-on-surface-variant font-medium">Noisy Edge Count</span>
                  <div className="text-lg font-bold font-mono mt-1 text-on-surface">{dpGraphSummary.noisy_summary.edge_count_dp}</div>
                </div>
                <div className="p-3.5 rounded-xl bg-surface-container/60 border border-outline-variant/40">
                  <span className="text-xs text-on-surface-variant font-medium">Structuring Nodes (Noisy)</span>
                  <div className="text-lg font-bold font-mono mt-1 text-tertiary">{dpGraphSummary.noisy_summary.structuring_nodes_dp}</div>
                </div>
                <div className="p-3.5 rounded-xl bg-surface-container/60 border border-outline-variant/40">
                  <span className="text-xs text-on-surface-variant font-medium">Exposed Volume (Noisy)</span>
                  <div className="text-lg font-bold font-mono mt-1 text-primary">${dpGraphSummary.noisy_summary.total_volume_exposed_dp.toLocaleString()}</div>
                </div>
              </div>
            </div>
          )}

          {/* Noisy Telemetry & Metrics Table */}
          {dpMetrics && (
            <div className="p-6 rounded-2xl border border-outline-variant/60 bg-surface-container-low shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b pb-3 border-outline-variant/60">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  <h4 className="font-bold text-base text-on-surface">Calibrated Noisy Model Telemetry</h4>
                </div>
                <span className="px-2.5 py-0.5 text-xs font-bold font-mono rounded-full bg-primary/10 text-primary border border-primary/20">
                  {dpMetrics.privacy_guarantee}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs text-on-surface-variant px-1 font-mono">
                <span>Epsilon Consumed: <strong className="text-primary font-bold">+{dpMetrics.epsilon_cost} ε</strong></span>
                <span>Avg Noise Scale (b or σ): <strong className="text-tertiary font-bold">{dpMetrics.noise_scale_avg}</strong></span>
              </div>

              <div className="overflow-hidden rounded-xl border border-outline-variant/60">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-container/60 text-on-surface-variant font-bold border-b border-outline-variant/60">
                    <tr>
                      <th className="py-2.5 px-3">Metric Name</th>
                      <th className="py-2.5 px-3 text-right font-mono">Noisy Value (ε-DP)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/40">
                    {Object.entries(dpMetrics.noisy_metrics).map(([key, val], i) => (
                      <tr key={i} className="hover:bg-surface-container/40 transition-colors">
                        <td className="py-2 px-3 font-medium text-on-surface capitalize">{key.replace(/_/g, ' ')}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-primary">{Number(val).toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
