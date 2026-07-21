import React, { useState, useEffect } from 'react';
import { fageApi } from '../services/api';
import { usePUCalibration, useCostThresholds } from '../hooks/useFageApi';

export const ThresholdTuner: React.FC = () => {
  const { data: puData, refetch: refetchPU } = usePUCalibration();
  const { data: costData, refetch: refetchCost } = useCostThresholds();

  const [threshold, setThreshold] = useState<number>(0.50);
  const [cFactor, setCFactor] = useState<number>(0.824);
  const [spyThreshold, setSpyThreshold] = useState<number>(0.142);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (costData?.optimal_threshold) {
      setThreshold(costData.optimal_threshold);
    }
    if (puData?.c_estimate || costData?.c_estimate) {
      setCFactor(puData?.c_estimate ?? costData?.c_estimate ?? 0.824);
    }
    if (puData?.spy_threshold) {
      setSpyThreshold(puData.spy_threshold);
    }
  }, [puData, costData]);

  const handleTuneAll = async () => {
    setLoading(true);
    setMessage('');
    try {
      // Tune global threshold
      const resThreshold = await fageApi.tuneThreshold(threshold);
      // Tune PU metrics
      const resPU = await fageApi.tuneSPYThreshold({
        c_factor: cFactor,
        spy_threshold: spyThreshold,
      });

      await refetchPU();
      await refetchCost();

      setMessage(`Recalibrated: ${resThreshold?.message || 'Threshold updated'} & PU c=${resPU?.new_c_factor?.toFixed(3)}, SPY=${resPU?.new_spy_threshold?.toFixed(3)}`);
    } catch (err) {
      console.error(err);
      setMessage('Error applying calibration updates');
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(''), 5000);
    }
  };

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-xl p-6 shadow-sm transition-all space-y-6">
      <div className="flex items-center justify-between border-b border-outline-variant/60 pb-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface flex items-center gap-2">
          <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          Risk Threshold & PU Calibration Tuner
        </h3>
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-primary/10 text-primary border border-primary/20">
          Online SPY Recalibration Ready
        </span>
      </div>

      <div className="space-y-5">
        {/* Slider 1: Global ML Decision Cutoff */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-on-surface-variant">
            <div>
              <span className="text-xs font-bold text-on-surface">Global ML Decision Cutoff</span>
              <p className="text-[10px] text-on-surface-variant/70">Asymmetric cost cutoff shifting investigation queue</p>
            </div>
            <span className="font-mono text-sm text-primary font-extrabold px-2 py-0.5 rounded bg-primary/10 border border-primary/20">
              {(threshold * 100).toFixed(0)}%
            </span>
          </div>
          <input 
            type="range" 
            min="0.05" max="0.95" step="0.01" 
            value={threshold} 
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="w-full h-2 bg-surface-container rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[10px] font-mono text-on-surface-variant/60">
            <span>0.05 (Liberal / High Alert Volume)</span>
            <span>0.95 (Conservative / Low Alert Volume)</span>
          </div>
        </div>

        {/* Slider 2: PU Label Frequency Factor (c-factor) */}
        <div className="space-y-1.5 pt-3 border-t border-outline-variant/40">
          <div className="flex justify-between items-center text-on-surface-variant">
            <div>
              <span className="text-xs font-bold text-on-surface">PU Discovery Factor ($c$)</span>
              <p className="text-[10px] text-on-surface-variant/70">Estimated label frequency inside positive set ($P(s=1|y=1)$)</p>
            </div>
            <span className="font-mono text-sm text-purple-400 font-extrabold px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">
              {cFactor.toFixed(3)}
            </span>
          </div>
          <input 
            type="range" 
            min="0.10" max="1.00" step="0.005" 
            value={cFactor} 
            onChange={(e) => setCFactor(parseFloat(e.target.value))}
            className="w-full h-2 bg-surface-container rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
          <div className="flex justify-between text-[10px] font-mono text-on-surface-variant/60">
            <span>0.100 (Severe Hidden Mule Escapes)</span>
            <span>1.000 (Fully Labeled Benchmark)</span>
          </div>
        </div>

        {/* Slider 3: SPY Cutoff Threshold */}
        <div className="space-y-1.5 pt-3 border-t border-outline-variant/40">
          <div className="flex justify-between items-center text-on-surface-variant">
            <div>
              <span className="text-xs font-bold text-on-surface">Reliable Negative SPY Cutoff</span>
              <p className="text-[10px] text-on-surface-variant/70">Quantile boundary separating verified negatives from hidden positive spies</p>
            </div>
            <span className="font-mono text-sm text-amber-500 font-extrabold px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
              {spyThreshold.toFixed(3)}
            </span>
          </div>
          <input 
            type="range" 
            min="0.005" max="0.450" step="0.005" 
            value={spyThreshold} 
            onChange={(e) => setSpyThreshold(parseFloat(e.target.value))}
            className="w-full h-2 bg-surface-container rounded-lg appearance-none cursor-pointer accent-amber-500"
          />
          <div className="flex justify-between text-[10px] font-mono text-on-surface-variant/60">
            <span>0.005 (Ultra-Strict Spy Isolation)</span>
            <span>0.450 (Broad Unlabeled Exclusion)</span>
          </div>
        </div>

        <div className="pt-4 border-t border-outline-variant flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className={`text-xs font-bold ${message.includes('Error') ? 'text-error' : 'text-emerald-500'}`}>
            {message}
          </span>
          <button 
            onClick={handleTuneAll}
            disabled={loading}
            className="w-full sm:w-auto px-6 py-2.5 bg-primary text-on-primary hover:opacity-90 rounded-xl font-bold text-xs shadow-md transition-all transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
                Applying & Recalibrating Engine...
              </>
            ) : (
              'Apply Threshold & PU Recalibration'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
