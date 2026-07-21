import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fageApi,
  DashboardTelemetryResponse,
  ModelMetricsResponse,
  FeatureImportanceResponse,
  RiskScoreRequest,
  ScorecardResponse,
  AlertsResponse,
  AlertInfo,
  AlertUpdateRequest,
} from '../services/api';

/**
 * Custom Hook: Fetches aggregated dashboard telemetry metrics.
 */
export function useDashboardSummary() {
  const [data, setData] = useState<DashboardTelemetryResponse['telemetry'] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async (isSilent: boolean = false) => {
    try {
      if (!isSilent) setLoading(true);
      setError(null);
      const res = await fageApi.getDashboardSummary();
      setData(res.telemetry);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch dashboard summary');
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary(false);
    const interval = setInterval(() => fetchSummary(true), 30000);
    return () => clearInterval(interval);
  }, [fetchSummary]);

  return { data, loading, error, refetch: fetchSummary };
}

/**
 * Custom Hook: Fetches all performance evaluation indicators across models.
 */
export function useModelMetrics() {
  const [data, setData] = useState<ModelMetricsResponse['models'] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fageApi.getModelMetrics();
      setData(res.models);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch model metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return { data, loading, error, refetch: fetchMetrics };
}

/**
 * Custom Hook: Fetches global Shapley feature importance metrics and beeswarm coordinates.
 */
export function useFeatureImportance() {
  const [data, setData] = useState<FeatureImportanceResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchImportance = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fageApi.getFeatureImportance();
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch feature importance profiles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImportance();
  }, [fetchImportance]);

  return { data, loading, error, refetch: fetchImportance };
}



/**
 * Custom Hook: Triggers combined ML and policy risk decisions (Risk Assessment Mutation).
 */
export function useRiskScore() {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScorecardResponse['scorecard'] | null>(null);

  const evaluate = async (payload: RiskScoreRequest) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fageApi.scoreAndEvaluateTransaction(payload);
      setResult(res.scorecard);
      return res.scorecard;
    } catch (err: any) {
      setError(err?.message || 'Risk scoring assessment execution error');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
  };

  return { evaluate, result, loading, error, reset };
}

/**
 * Custom Hook: Fetches, indexes, and queries incident alert queues with reactive polling.
 */
export function useAlerts(filters?: {
  status_filter?: string;
  severity_filter?: string;
  limit?: number;
}) {
  const [alerts, setAlerts] = useState<AlertInfo[]>([]);
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isReachable, setIsReachable] = useState<boolean>(false);

  const status_filter = filters?.status_filter;
  const severity_filter = filters?.severity_filter;
  const limit = filters?.limit;

  const isFetchingRef = useRef(false);

  const fetchAlerts = useCallback(async (isSilent: boolean = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      if (!isSilent) setLoading(true);
      if (!isSilent) setError(null); // BUG-007 FIX: don't clear error on silent poll — prevents flash-off every 60s
      const res = await fageApi.listAlertsQueue({
        status_filter,
        severity_filter,
        limit,
      });
      setAlerts(res.alerts);
      setCount(res.alerts_count);
      setIsReachable(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch alerts queue');
      setIsReachable(false);
    } finally {
      if (!isSilent) setLoading(false);
      isFetchingRef.current = false;
    }
  }, [status_filter, severity_filter, limit]);

  useEffect(() => {
    fetchAlerts(false);
    const interval = setInterval(() => fetchAlerts(true), 60000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  return { alerts, count, loading, error, isReachable, refetch: fetchAlerts };
}

/**
 * Custom Hook: Applies updates and inputs case notes to individual triggers (Alert Mutation).
 */
export function useUpdateAlert() {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAlert, setUpdatedAlert] = useState<AlertInfo | null>(null);

  const updateAlert = async (alertId: string, payload: AlertUpdateRequest) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fageApi.updateAlertStatus(alertId, payload);
      setUpdatedAlert(res.alert);
      return res.alert;
    } catch (err: any) {
      setError(err?.message || `Failed to update alert: ${alertId}`);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setUpdatedAlert(null);
    setError(null);
  };

  return { updateAlert, updatedAlert, loading, error, reset };
}

/**
 * Custom Hook: Fetches cost-sensitive threshold optimization metrics.
 */
export function useCostThresholds() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCostThresholds = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fageApi.getCostThresholds();
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch cost-sensitive thresholds');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCostThresholds();
  }, [fetchCostThresholds]);

  return { data, loading, error, refetch: fetchCostThresholds };
}

/**
 * Custom Hook: Fetches PU calibration metrics and label frequency estimates.
 */
export function usePUCalibration() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPUCalibration = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fageApi.getPUCalibration();
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch PU calibration metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPUCalibration();
  }, [fetchPUCalibration]);

  return { data, loading, error, refetch: fetchPUCalibration };
}

/**
 * Custom Hook: Fetches the Model Governance rejection registry and threshold evidence.
 */
export function useModelRegistry() {
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRegistry = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fageApi.getModelRegistry();
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch model registry');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  return { data, loading, error, refetch: fetchRegistry };
}


