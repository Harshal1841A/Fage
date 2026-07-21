import React, { useState } from 'react';
import { 
  Download, 
  HelpCircle, 
  TrendingUp, 
  Activity, 
  GitCommit,
  Check,
  ShieldCheck,
  AlertTriangle,
  Cpu
} from 'lucide-react';
import { SHAPDriver, SystemTheme } from '../types';
import { useModelMetrics } from '../hooks/useFageApi';

interface ModelPerformanceViewProps {
  theme: SystemTheme;
}

export default function ModelPerformanceView({ theme }: ModelPerformanceViewProps) {
  const isDark = theme === 'analytics';
  const [selectedModel, setSelectedModel] = useState<string>('XGBoost');
  const [activeMatrixCell, setActiveMatrixCell] = useState<string | null>(null);

  const { data: metricsData, loading, error } = useModelMetrics();

  const metrics = React.useMemo(() => {
    if (metricsData && metricsData[selectedModel]) {
      return metricsData[selectedModel];
    }
    return null;
  }, [metricsData, selectedModel]);

  React.useEffect(() => {
    if (metricsData && !metricsData[selectedModel]) {
      const first = Object.keys(metricsData)[0];
      if (first) setSelectedModel(first);
    }
  }, [metricsData, selectedModel]);

  const fpr = React.useMemo(() => {
    if (!metrics) return 0;
    const cm = metrics.confusion_matrix;
    const tn = cm[0][0];
    const fp = cm[0][1];
    const den = tn + fp;
    return den > 0 ? (fp / den) * 100 : 0.0;
  }, [metrics]);

  const tnRate = React.useMemo(() => {
    if (!metrics) return 0;
    const cm = metrics.confusion_matrix;
    const tn = cm[0][0];
    const fp = cm[0][1];
    const den = tn + fp;
    return den > 0 ? (tn / den) * 100 : 0.0;
  }, [metrics]);

  const tpRate = React.useMemo(() => {
    if (!metrics) return 0;
    const cm = metrics.confusion_matrix;
    const fn = cm[1][0];
    const tp = cm[1][1];
    const den = fn + tp;
    return den > 0 ? (tp / den) * 100 : 0.0;
  }, [metrics]);

  const fnRate = React.useMemo(() => {
    if (!metrics) return 0;
    const cm = metrics.confusion_matrix;
    const fn = cm[1][0];
    const tp = cm[1][1];
    const den = fn + tp;
    return den > 0 ? (fn / den) * 100 : 0.0;
  }, [metrics]);

  const handleExportMetrics = () => {
    if (!metrics) return;
    const csvContent = "data:text/csv;charset=utf-8,"
      + [
          "Model,Accuracy,FPR,Recall,F1-Score",
          `${selectedModel},${(metrics.accuracy * 100).toFixed(2)}%,${fpr.toFixed(2)}%,${(metrics.recall * 100).toFixed(2)}%,${metrics.f1.toFixed(3)}`
        ].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `FAGE_Model_Performance_Metrics_${selectedModel}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header Info Panel */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-on-surface">
            Model Performance
          </h2>
          <p className="text-xs mt-1 text-on-surface-variant">
            Evaluate accuracy, precision, and threshold distributions for risk intelligence engines.
          </p>
          <p className="text-[10px] mt-1 font-bold text-amber-500">
            Note: Per-model native thresholds differ. Some models may show degraded precision at the global 0.27 cut-off.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="appearance-none font-sans text-xs px-3 py-2 pr-8 rounded-lg outline-none cursor-pointer border border-outline-variant bg-surface-container text-on-surface focus:border-primary"
            >
              {metricsData ? (
                Object.keys(metricsData)
                  .filter(m => !['LogisticRegression', 'ExtraTrees'].includes(m))
                  .map((mName) => (
                    <option key={mName} value={mName}>Model: {mName}</option>
                  ))
              ) : (
                <>
                  <option value="XGBoost">Model: XGBoost</option>
                  <option value="LightGBM">Model: LightGBM</option>
                  <option value="RandomForest">Model: RandomForest</option>
                  <option value="Ensemble">Model: Ensemble</option>
                </>
              )}
            </select>
            <Cpu size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant" />
          </div>

          <button
            onClick={handleExportMetrics}
            disabled={!metrics}
            className="flex items-center gap-2 px-4 py-2 border border-outline-variant bg-surface-container hover:bg-surface-container-high text-on-surface rounded-lg text-xs font-bold transition-all duration-300 h-9 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            <Download size={14} />
            <span>Export Metrics</span>
          </button>
        </div>
      </div>

      {loading && (
        <div className="p-8 border border-outline-variant bg-surface-container rounded-xl text-center text-sm text-on-surface-variant shadow-sm">
          Loading model metrics…
        </div>
      )}

      {!loading && error && (
        <div className="p-8 border border-error/30 bg-error-container/20 rounded-xl text-center text-sm text-error shadow-sm">
          Unable to load metrics: {error}
        </div>
      )}

      {!loading && !error && !metrics && (
        <div className="p-8 border border-outline-variant bg-surface-container rounded-xl text-center text-sm text-on-surface-variant shadow-sm">
          No metrics available for the selected model. Ensure the backend is running.
        </div>
      )}

      {!loading && metrics && (
      <>
      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-sans">
        {/* Metric 1 */}
        <div className="p-4 border border-outline-variant bg-surface-container rounded-xl flex flex-col justify-between h-28 shadow-sm">
          <span className="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant">Classification Accuracy</span>
          <div>
            <span className="text-2xl font-extrabold pb-0.5 block leading-none text-on-surface">
              {(metrics.accuracy * 100).toFixed(2)}%
            </span>
            <span className="text-[10px] font-bold text-emerald-500 flex items-center leading-none">
              <TrendingUp size={11} className="mr-0.5" /> Stable performance
            </span>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="p-4 border border-outline-variant bg-surface-container rounded-xl flex flex-col justify-between h-28 shadow-sm">
          <span className="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant font-sans">False Positive Rate (FPR)</span>
          <div>
            <span className="text-2xl font-extrabold pb-0.5 block leading-none text-on-surface">
              {fpr.toFixed(2)}%
            </span>
            <span className="text-[10px] font-bold text-emerald-500 leading-none">Minimizes false flags</span>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="p-4 border border-outline-variant bg-surface-container rounded-xl flex flex-col justify-between h-28 shadow-sm">
          <span className="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant">True Positive Rate (Recall)</span>
          <div>
            <span className="text-2xl font-extrabold pb-0.5 block leading-none text-on-surface">
              {(metrics.recall * 100).toFixed(2)}%
            </span>
            <span className="text-[10px] font-bold text-emerald-500 flex items-center leading-none">
              <TrendingUp size={11} className="mr-0.5" /> Strong detection rate
            </span>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="p-4 border border-outline-variant bg-surface-container rounded-xl flex flex-col justify-between h-28 shadow-sm">
          <span className="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant">Overall F1-Score Ratio</span>
          <div>
            <span className="text-2xl font-extrabold pb-0.5 block leading-none text-on-surface">
              {metrics.f1.toFixed(3)}
            </span>
            <span className="text-[10px] font-bold text-on-surface-variant leading-none">Stable across all cohorts</span>
          </div>
        </div>
      </div>

      {/* Main Charts block */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        

        {/* Confusion Matrix grid panel */}
        <div className="p-5 border border-outline-variant bg-surface-container rounded-xl flex flex-col justify-between shadow-sm">
          <div className="border-b border-outline-variant pb-2 mb-4 flex justify-between items-center">
            <div>
              <h3 className="text-sm font-bold tracking-tight text-on-surface">
                Confusion Matrix (Holdout Set)
              </h3>
              <span className="text-[10px] text-on-surface-variant">Classification distribution for historical target batches</span>
            </div>
            <HelpCircle size={15} className="text-on-surface-variant hover:text-primary cursor-pointer transition-colors" />
          </div>

          <div className="grid grid-cols-3 gap-2.5 max-w-sm mx-auto text-center py-2 text-xs font-sans">
            {/* Column Label block */}
            <div></div>
            <div className="font-bold text-[10px] uppercase text-on-surface-variant font-mono">Predicted Normal</div>
            <div className="font-bold text-[10px] uppercase text-on-surface-variant font-mono">Predicted Mule</div>

            {/* Row 1 */}
            <div className="font-bold text-[10px] uppercase text-on-surface-variant self-center font-mono">Actual Normal</div>
            
            {/* TN Block */}
            <div 
              onMouseEnter={() => setActiveMatrixCell(`TN: True Negative Rate = ${tnRate.toFixed(2)}% (${metrics.confusion_matrix[0][0].toLocaleString()} normal correctly kept)`)}
              onMouseLeave={() => setActiveMatrixCell(null)}
              className="p-4 rounded-lg flex flex-col justify-center cursor-pointer border border-outline-variant bg-surface-container-low hover:scale-[1.02] transition-transform duration-200"
            >
              <Check size={14} className="mx-auto text-emerald-500 mb-1" />
              <span className="font-black text-sm text-emerald-500">
                {metrics.confusion_matrix[0][0].toLocaleString()}
              </span>
              <span className="text-[8px] uppercase tracking-wider text-on-surface-variant font-bold mt-1">True Neg (TN)</span>
            </div>

            {/* FP Block */}
            <div 
              onMouseEnter={() => setActiveMatrixCell(`FP: False Alarm Rate = ${fpr.toFixed(2)}% (${metrics.confusion_matrix[0][1].toLocaleString()} normal flagged by model)`)}
              onMouseLeave={() => setActiveMatrixCell(null)}
              className="p-4 rounded-lg flex flex-col justify-center cursor-pointer border border-outline-variant bg-surface-container-low hover:scale-[1.02] transition-transform duration-200"
            >
              <AlertTriangle size={14} className="mx-auto text-error mb-1" />
              <span className="font-black text-sm text-error">
                {metrics.confusion_matrix[0][1].toLocaleString()}
              </span>
              <span className="text-[8px] uppercase tracking-wider text-on-surface-variant font-bold mt-1">False Pos (FP)</span>
            </div>

            {/* Row 2 */}
            <div className="font-bold text-[10px] uppercase text-on-surface-variant self-center font-mono">Actual Mule</div>
            
            {/* FN Block */}
            <div 
              onMouseEnter={() => setActiveMatrixCell(`FN: Leakage Rate = ${fnRate.toFixed(2)}% (${metrics.confusion_matrix[1][0].toLocaleString()} suspicious went unflagged)`)}
              onMouseLeave={() => setActiveMatrixCell(null)}
              className="p-4 rounded-lg flex flex-col justify-center cursor-pointer border border-outline-variant bg-surface-container-low hover:scale-[1.02] transition-transform duration-200"
            >
              <AlertTriangle size={14} className="mx-auto text-tertiary mb-1" />
              <span className="font-black text-sm text-tertiary">
                {metrics.confusion_matrix[1][0].toLocaleString()}
              </span>
              <span className="text-[8px] uppercase tracking-wider text-on-surface-variant font-bold mt-1">False Neg (FN)</span>
            </div>

            {/* TP Block */}
            <div 
              onMouseEnter={() => setActiveMatrixCell(`TP: Model Detection Rate = ${tpRate.toFixed(2)}% (${metrics.confusion_matrix[1][1].toLocaleString()} correct detections)`)}
              onMouseLeave={() => setActiveMatrixCell(null)}
              className="p-4 rounded-lg flex flex-col justify-center cursor-pointer border border-outline-variant bg-surface-container-low hover:scale-[1.02] transition-transform duration-200"
            >
              <ShieldCheck size={14} className="mx-auto text-emerald-500 mb-1" />
              <span className="font-black text-sm text-emerald-500">
                {metrics.confusion_matrix[1][1].toLocaleString()}
              </span>
              <span className="text-[8px] uppercase tracking-wider text-on-surface-variant font-bold mt-1">True Pos (TP)</span>
            </div>
          </div>

          {/* Precision stats status readout info card */}
          <div className="h-10 mt-3 flex items-center justify-center">
            {activeMatrixCell ? (
              <p className="text-xs font-semibold text-primary font-mono select-none px-4 text-center leading-tight">
                {activeMatrixCell}
              </p>
            ) : (
              <p className="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant select-none">
                Hover over blocks for rate indices details
              </p>
            )}
          </div>
        </div>
      </div>
      </>
      )}

    </div>
  );
}
