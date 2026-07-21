import React, { useState } from 'react';
import { 
  Download, 
  HelpCircle, 
  TrendingUp, 
  Cpu, 
  Database,
  ArrowRight,
  TrendingDown
} from 'lucide-react';
import { SystemTheme } from '../types';
import { useFeatureImportance, useModelMetrics, useCostThresholds, usePUCalibration } from '../hooks/useFageApi';
import { ThresholdTuner } from './ThresholdTuner';
import { formatINR } from '../utils/format';

interface ModelInsightsViewProps {
  theme: SystemTheme;
}

export default function ModelInsightsView({ theme }: ModelInsightsViewProps) {
  const isDark = theme === 'analytics';
  const [activeTab, setActiveTab] = useState<'bar' | 'beeswarm'>('bar');

  const { data: metricsData } = useModelMetrics();
  const { data: importanceData } = useFeatureImportance();
  const { data: costData } = useCostThresholds();
  const { data: puData } = usePUCalibration();

  // These are anonymized F-columns with no organizer-provided semantic descriptions.
  // We do not invent plausible-sounding names for them — an honest "Anonymized Feature
  // F###" label is the only accurate thing to show for a column we can't describe.
  const getFriendlyFeatureName = (featureId: string) => `Anonymized Feature ${featureId}`;

  const activeFeatures = React.useMemo(() => {
    if (importanceData && importanceData.importance_profile && importanceData.importance_profile.length > 0) {
      return importanceData.importance_profile.map((item) => ({
        featureId: item.feature,
        name: getFriendlyFeatureName(item.feature),
        type: 'Model Feature',
        shapValue: item.mean_abs_attribution,
        importanceScore: item.mean_abs_attribution,
        value: item.mean_abs_attribution.toFixed(4)
      }));
    }
    return [];
  }, [importanceData]);

  const modelName = importanceData?.model_requested || 'XGBoost';

  const aucScore = React.useMemo(() => {
    const modelKey = modelName.toUpperCase();
    if (metricsData) {
        for (const key of Object.keys(metricsData)) {
            if (key.toUpperCase() === modelKey) {
                return metricsData[key].roc_auc.toFixed(3);
            }
        }
    }
    return '0.000';
  }, [metricsData, modelName]);

  const aucChange = '';

  const handleExportFeatures = () => {
    const headers = ['Feature ID', 'Feature Name', 'Importance Score'];
    const rows = activeFeatures.map(f => [
      f.featureId,
      f.name,
      f.importanceScore
    ]);
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${val}"`).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `FAGE_Feature_Importance_${modelName}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header & Model Selector */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-on-surface">
            Model Insights
          </h2>
          <p className="text-xs mt-1 text-on-surface-variant">
            Analyze prediction drivers and feature importance for risk scoring models.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={handleExportFeatures}
            className="flex items-center gap-2 px-4 py-2 border border-outline-variant bg-surface-container hover:bg-surface-container-high text-on-surface rounded-lg text-xs font-bold transition-all duration-300 h-9 shadow-sm"
          >
            <Download size={14} />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Global Feature Importance Card (8 cols) */}
        <div className="p-5 border border-outline-variant bg-surface-container rounded-xl lg:col-span-8 flex flex-col shadow-sm">
          <div className="flex justify-between items-center mb-5 border-b border-outline-variant pb-2">
            <div>
              <h3 className="text-sm font-bold tracking-tight text-on-surface">
                Global Feature Importance
              </h3>
              <span className="text-[10px] text-on-surface-variant">Top influencing features across all predictions (Mean |SHAP|)</span>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex border border-outline-variant rounded-lg overflow-hidden p-0.5 bg-surface-container-low">
                <button
                  onClick={() => setActiveTab('bar')}
                  className={`px-3 py-1.5 text-[9px] font-bold rounded-md transition-all ${
                    activeTab === 'bar'
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  Bar Chart
                </button>
                <button
                  onClick={() => setActiveTab('beeswarm')}
                  className={`px-3 py-1.5 text-[9px] font-bold rounded-md transition-all ${
                    activeTab === 'beeswarm'
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  Beeswarm Plot
                </button>
              </div>
              <HelpCircle size={15} className="text-on-surface-variant cursor-pointer hover:text-primary transition-colors" title="Information on SHAP values" />
            </div>
          </div>

          {activeTab === 'bar' ? (
            /* Features horizontal listing */
            <div className="space-y-4 flex-1 flex flex-col justify-center">
             {activeFeatures.map((f) => {
                const scores = activeFeatures.map(x => x.importanceScore);
                const maxScore = scores.length > 0 ? Math.max(...scores) : 1.0;
                const percent = maxScore > 0 ? (f.importanceScore / maxScore) * 100 : 0;
                
                return (
                  <div key={f.featureId} className="flex items-center text-xs">
                    <span className="w-16 font-mono font-bold text-on-surface-variant pr-2 text-right">
                      {f.featureId}
                    </span>
                    
                    {/* Progress bar container */}
                    <div className="flex-1 h-6 bg-surface-container-low rounded-r overflow-hidden relative border border-outline-variant/40">
                      <div 
                        className="h-full rounded-r transition-all duration-500 flex items-center pl-3 bg-primary shadow-[0_0_8px_rgba(76,215,246,0.3)]"
                        style={{ width: `${percent}%` }}
                      >
                        <span className="text-on-primary text-[10px] font-bold">
                          {f.importanceScore.toFixed(3)}
                        </span>
                      </div>
                    </div>

                    <span className="w-40 pl-3 font-medium truncate text-on-surface" title={f.name}>
                      {f.name}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Beeswarm plot rendering */
            <div className="flex-1 flex flex-col items-center justify-center p-2 bg-surface-container-low rounded-lg border border-dashed border-outline-variant">
              {importanceData?.static_beeswarm_base64 ? (
                <img 
                  src={importanceData.static_beeswarm_base64} 
                  alt="SHAP Beeswarm Plot" 
                  className="max-h-[320px] w-full object-contain rounded-lg shadow-md"
                />
              ) : (
                <div className="text-xs text-on-surface-variant py-12 flex flex-col items-center gap-2">
                  <span className="animate-pulse">Loading static beeswarm attribution scatter coordinates...</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Global Summary Stats (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <div className="p-4 border border-outline-variant bg-surface-container rounded-xl flex-1 justify-between flex flex-col shadow-sm">
            <div>
              <p className="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant">Model Accuracy (ROC AUC)</p>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-3xl font-extrabold text-on-surface">
                  {aucScore}
                </span>
              </div>
            </div>

            <div className="w-full bg-surface-container-low h-1.5 rounded-full overflow-hidden mt-4 border border-outline-variant/40">
              <div className="h-full rounded-full bg-primary" style={{ width: `${parseFloat(aucScore) * 100}%` }}></div>
            </div>
          </div>

          <div className="p-4 border border-outline-variant bg-surface-container rounded-xl flex-1 shadow-sm">
            <p className="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant">Top Driver Shift (7d)</p>
            <p className="text-xs mt-3 leading-relaxed text-on-surface-variant italic">
              Historical drift data not available.
            </p>
          </div>

          <ThresholdTuner />
        </div>

        {/* Cost-Sensitive Threshold Optimization & PU Calibration Panels (Spans 12 cols total: 6 + 6) */}
        <div className="p-5 border border-outline-variant bg-surface-container rounded-xl lg:col-span-6 flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex justify-between items-center mb-4 border-b border-outline-variant pb-2">
              <div>
                <h3 className="text-sm font-bold tracking-tight text-on-surface">
                  Cost-Sensitive Threshold Optimization
                </h3>
                <span className="text-[10px] text-on-surface-variant">Asymmetric economic risk decision cutoff (RBI / Bank standard)</span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 whitespace-nowrap">
                Optimal: {((costData?.optimal_threshold ?? 0.50) * 100).toFixed(0)}%
              </span>
            </div>

            <p className="text-xs mb-4 leading-relaxed text-on-surface-variant">
              Standard 50% probability cutoffs fail when false negative costs (mule escape) far exceed false positive costs (investigation review). Our cost-sensitive objective minimizes expected net monetary loss across all queue items.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 rounded-lg border border-outline-variant bg-surface-container-low overflow-hidden">
                <span className="text-[10px] text-on-surface-variant block font-semibold uppercase truncate">False Negative Cost ({"$C_{fn}$"})</span>
                <span className="text-sm font-extrabold font-mono text-error mt-1 block whitespace-nowrap">
                  {formatINR(costData?.c_fn ?? 388000)}
                </span>
                <span className="text-[9px] text-on-surface-variant/80 mt-0.5 block truncate">Estimated loss per undetected mule account</span>
              </div>

              <div className="p-3 rounded-lg border border-outline-variant bg-surface-container-low overflow-hidden">
                <span className="text-[10px] text-on-surface-variant block font-semibold uppercase truncate">False Positive Cost ({"$C_{fp}$"})</span>
                <span className="text-sm font-extrabold font-mono text-primary mt-1 block whitespace-nowrap">
                  {formatINR(costData?.c_fp ?? 1200)}
                </span>
                <span className="text-[9px] text-on-surface-variant/80 mt-0.5 block truncate">Analyst triage & escalation review cost</span>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg text-xs font-medium border border-primary/30 bg-primary/10 text-on-surface">
            <span className="text-primary font-bold">Tradeoff Efficiency: </span>
            <strong className="font-bold">Cost ratio {"$C_{fn} / C_{fp}$"} = {((costData?.c_fn ?? 388000) / (costData?.c_fp ?? 1200)).toFixed(0)}x</strong>. Shifts operational cutoff from 50% down to {((costData?.optimal_threshold ?? 0.50) * 100).toFixed(0)}%, preventing severe escape losses.
          </div>
        </div>

        <div className="p-5 border border-outline-variant bg-surface-container rounded-xl lg:col-span-6 flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex justify-between items-center mb-4 border-b border-outline-variant pb-2">
              <div>
                <h3 className="text-sm font-bold tracking-tight text-on-surface">
                  PU Learning & Calibration Curve
                </h3>
                <span className="text-[10px] text-on-surface-variant">Positive-Unlabeled probability calibration factor ($c$)</span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-secondary-container text-on-secondary-container border border-secondary/30 whitespace-nowrap">
                c-factor: {(costData?.c_estimate ?? puData?.c_estimate ?? 0.824).toFixed(3)}
              </span>
            </div>

            <p className="text-xs mb-4 leading-relaxed text-on-surface-variant">
              In banking datasets, unlabeled samples contain hidden mule accounts. Raw classifier scores estimate $P(s=1|x)$ (probability of being labeled). The PU calibration engine adjusts raw probabilities via $P(y=1|x) = P(s=1|x) / c$.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 rounded-lg border border-outline-variant bg-surface-container-low overflow-hidden">
                <span className="text-[10px] text-on-surface-variant block font-semibold uppercase truncate">Label Frequency ($c$)</span>
                <span className="text-sm font-extrabold font-mono text-secondary mt-1 block whitespace-nowrap">
                  {((costData?.c_estimate ?? puData?.c_estimate ?? 0.824) * 100).toFixed(1)}%
                </span>
                <span className="text-[9px] text-on-surface-variant/80 mt-0.5 block truncate">True positive recall inside labeled positive set</span>
              </div>

              <div className="p-3 rounded-lg border border-outline-variant bg-surface-container-low overflow-hidden">
                <span className="text-[10px] text-on-surface-variant block font-semibold uppercase truncate">SPY Cutoff Threshold</span>
                <span className="text-sm font-extrabold font-mono text-tertiary mt-1 block whitespace-nowrap">
                  {(puData?.spy_threshold ?? 0.142).toFixed(3)}
                </span>
                <span className="text-[9px] text-on-surface-variant/80 mt-0.5 block truncate">Bottom 5% quantile of positive spy instances</span>
              </div>
            </div>
          </div>


        </div>

        {/* Local waterfall explanation panel (Spans 12 cols) */}
        <div className="p-5 border border-outline-variant bg-surface-container rounded-xl lg:col-span-12 shadow-sm">
          <div className="flex justify-between items-center mb-5 border-b border-outline-variant pb-2">
            <div>
              <h3 className="text-sm font-bold tracking-tight text-on-surface">
                Global Prediction Drivers
              </h3>
              <span className="text-[10px] text-on-surface-variant">
                Top 5 overall features contributing to the model's output
              </span>
            </div>
          </div>

          {/* Waterfall pseudo matrix */}
          <div className="overflow-x-auto w-full table-scroll">
            <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="p-3 font-bold text-on-surface-variant uppercase tracking-widest font-mono">Feature ID</th>
                  <th className="p-3 font-bold text-on-surface-variant uppercase tracking-widest font-mono">Feature Value</th>
                  <th className="p-3 font-bold text-on-surface-variant uppercase tracking-widest font-mono text-center">SHAP Value Impact (Base: 0.15)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {activeFeatures.slice(0, 5).map((f) => {
                  const isPositive = f.shapValue > 0;
                  const absVal = Math.min(Math.abs(f.shapValue) * 100, 100);
                  
                  return (
                    <tr key={f.featureId} className="hover:bg-surface-container-high transition-colors h-12">
                      <td className="p-3 font-bold">
                        <span className="text-on-surface font-mono tracking-wide">{f.featureId}</span>
                        <span className="text-[10px] text-on-surface-variant font-medium block mt-0.5 font-sans">{f.name}</span>
                      </td>
                      <td className="p-3 font-extrabold font-mono text-on-surface-variant">{f.value}</td>
                      <td className="p-3">
                        <div className="flex items-center w-full min-w-[240px]">
                          {/* Right bar for positive, left bar for negative impact */}
                          <div className="w-1/2 flex justify-end pr-1.5 border-r border-outline-variant">
                            {!isPositive && (
                              <div 
                                className="h-4 bg-secondary-container text-on-secondary-container border border-secondary/30 text-[9px] font-bold flex items-center justify-end px-2.5 rounded-l-md leading-none"
                                style={{ width: `${absVal * 1.5}%` }}
                              >
                                {f.shapValue.toFixed(2)}
                              </div>
                            )}
                          </div>
                          
                          <div className="w-1/2 flex justify-start pl-1.5">
                            {isPositive && (
                              <div 
                                className="h-4 bg-error-container text-on-error-container border border-error/30 text-[9px] font-bold flex items-center justify-start px-2.5 rounded-r-md leading-none"
                                style={{ width: `${absVal * 1.5}%` }}
                              >
                                +{f.shapValue.toFixed(2)}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
