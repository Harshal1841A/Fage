import axios, { AxiosInstance, AxiosResponse } from 'axios';

// Always use the Vite dev proxy at /api — this avoids all browser CORS issues.
// The proxy (vite.config.ts) forwards /api/* → http://localhost:8000/* server-side,
// so no cross-origin request ever reaches the browser level.
const getBaseUrl = (): string => '/api';


/**
 * Enterprise Axios client configured with standard timeout, headers, and interceptors.
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: getBaseUrl(),
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Configure default response interceptors for custom error handling
apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const customError = {
      message: error.response?.data?.detail || error.message || 'An unexpected API error occurred',
      status: error.response?.status,
      data: error.response?.data,
    };
    if (error.response?.status === 401) {
      try {
        const { clearSession } = await import('./auth');
        clearSession();
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
      } catch {
        /* ignore */
      }
    }
    console.error('[API Integration Service Error]:', customError);
    return Promise.reject(customError);
  }
);

// ============================================================================
//                       TypeScript Interface Contracts
// ============================================================================

export interface PredictRequest {
  features: Record<string, number>;
}

export interface PredictResponse {
  status: string;
  metadata: {
    execution_timestamp: string;
    features_analyzed: number;
  };
  inference: {
    fraud_probability: number;
    predicted_class_label: number;
    decision_threshold: number;
  };
}

export interface RiskScoreRequest {
  transaction_id?: string;
  sender_id?: string;
  receiver_id?: string;
  amount: number;
  origin_country: string;
  destination_country: string;
  account_age_days: number;
  is_international: boolean;
  custom_metrics?: Record<string, number>;
}

interface RiskDriver {
  feature: string;
  importance_attribution: number;
  direction: 'increases_risk' | 'reduces_risk';
  raw_value: number;
}

interface WaterfallStep {
  feature: string;
  value: number;
  cumulative: number;
  type: 'base' | 'positive' | 'negative' | 'total';
  stat_label: string;
}

interface WaterfallVisuals {
  base_value: number;
  final_value: number;
  steps: WaterfallStep[];
  model_metadata: {
    algorithm: string;
    explained_feature_count: number;
  };
}

export interface ScorecardResponse {
  status: string;
  scorecard: {
    transaction_id: string;
    timestamp: string;
    processing_metadata: {
      engine_version: string;
      selected_model: string;
      is_override_applied: boolean;
      is_unsupervised_outlier: boolean;
    };
    scores: {
      base_ml_score: number;
      base_ml_probability: number;
      raw_uncalibrated_probability: number;
      final_risk_score: number;
      confidence_interval_90: {
        lower: number | null;
        upper: number | null;
        width: number | null;
        note: string;
      };
    };
    categorizations: {
      risk_tier: 'Low' | 'Medium' | 'High' | 'Critical';
      alert_severity: 'Low' | 'Medium' | 'High' | 'Critical';
      action_decision: 'Approve' | 'Review' | 'Escalate' | 'Block';
      triage_routing?: {
        triage_action?: 'FAST_TRACK_FREEZE' | 'PRIORITY_MANUAL_REVIEW' | 'INDEPENDENT_SIGNAL_CHECK' | 'STANDARD_MONITORING';
        priority_tier?: string;
      };
    };
    rules_audit: {
      triggered_rules_count: number;
      overrides: Array<{
        rule_id: string;
        rule_name: string;
        trigger_score: number;
        tier_enforcement: string;
        alert_severity_enforcement: string;
        reason: string;
      }>;
    };
    explainability: {
      key_risk_drivers: RiskDriver[];
      waterfall_visuals: WaterfallVisuals;
      evasion_resistance: {
        evadable_within_search?: boolean;
        features_required_to_change?: number;
        changed_features?: Array<{ feature: string; original_value: number; typical_legitimate_value: number }>;
        features_tried?: number;
        resulting_probability?: number;
        interpretation: string;
      } | null;
    };
    associated_alert_id?: string;
  };
}

export interface ExplainResponse {
  status: string;
  attributions: Record<string, number>;
  waterfall_visuals: WaterfallVisuals;
  static_chart_base64: string;
}

export interface DashboardTelemetryResponse {
  status: string;
  compiled_at: string;
  telemetry: {
    total_incidents_recorded: number;
    unique_accounts_analysed?: number;
    critical_alert_count?: number;
    critical_exposure_amount?: number;
    mule_exposure_amount?: number;
    average_risk_rating: number;
    maximum_index_severity: number;
    incident_status_matrix: {
      Open: number;
      Investigating: number;
      Escalated: number;
      Closed: number;
    };
    severity_profile: {
      Critical: number;
      High: number;
      Medium: number;
      Low: number;
    };
    rule_exception_rate: number;
    mule_classification_precision: number;
    mule_classification_recall?: number;
    mule_classification_f1?: number;
  };
  models: Record<string, unknown>;
}

interface ModelPerformanceMetric {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  roc_auc: number;
  pr_auc: number;
  confusion_matrix: number[][];
}

export interface ModelMetricsResponse {
  source: string;
  models: Record<string, ModelPerformanceMetric>;
}

interface FeatureImportanceItem {
  feature: string;
  mean_abs_attribution: number;
}

interface BeeswarmPoint {
  feature: string;
  val: number;
  normalized_val: number;
  shap_val: number;
}

export interface FeatureImportanceResponse {
  status: string;
  model_requested: string;
  importance_profile: FeatureImportanceItem[];
  beeswarm_scatter: {
    top_features: string[];
    global_rankings: Record<string, number>;
    points: BeeswarmPoint[];
  };
  static_beeswarm_base64: string;
}

interface AlertLog {
  operator: string;
  action: string;
  timestamp: string;
}

export interface AlertInfo {
  id: string;
  transaction_id: string;
  sender_id: string;
  receiver_id: string;
  amount: number;
  risk_score: number;
  risk_tier: 'Low' | 'Medium' | 'High' | 'Critical';
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  status: 'Open' | 'Investigating' | 'Escalated' | 'Closed';
  reason: string;
  timestamp: string;
  assigned_to: string;
  triage_action?: 'FAST_TRACK_FREEZE' | 'PRIORITY_MANUAL_REVIEW' | 'INDEPENDENT_SIGNAL_CHECK' | 'STANDARD_MONITORING';
  priority_tier?: string;
  pu_probability?: number;
  logs: AlertLog[];
  explainability: {
    key_risk_drivers: RiskDriver[];
    confidence_interval_90: { lower: number | null; upper: number | null; width: number | null; note: string } | null;
    evasion_resistance: Record<string, unknown> | null;
  } | null;
}

export interface AlertsResponse {
  status: string;
  alerts_count: number;
  alerts: AlertInfo[];
}

export interface AlertUpdateRequest {
  status: 'Open' | 'Investigating' | 'Escalated' | 'Closed';
  notes?: string;
  assigned_to?: string;
  operator_name?: string;
}

export interface CorrelateResponse {
  target_alert: string;
  related_entities: Array<{
    alert_id: string;
    transaction_id: string;
    match_reasons: string[];
    risk_tier: string;
    hop_distance?: number;
    bridge_entity?: string | null;
    amount?: number;
  }>;
  graph_summary?: {
    cluster_size: number;
    structuring_detected: boolean;
    bridge_nodes: string[];
    max_hop_distance: number;
    near_threshold_count: number;
  };
}

interface SARResponse {
  sar_report: string;
}

interface AdversarialShiftStatus {
  status: string;
  current_shift_status: {
    status: string;
    overall_psi: number;
    drift_alert_level: string;
    active_adaptation_weights: Record<string, number>;
    last_recalibrated: string;
    shift_type?: string;
    intensity?: number;
    explanation?: string;
    psi_summary?: Record<string, { psi: number; status: string; ks_stat: number; ks_pvalue: number }>;
    pre_adaptation_metrics?: Record<string, number>;
    post_adaptation_metrics?: Record<string, number>;
  };
  adaptation_history: Array<any>;
}

interface AdversarialShiftSimulateResponse {
  status: string;
  simulation_result: {
    shift_type: string;
    intensity: number;
    status: string;
    psi_summary: Record<string, { psi: number; status: string; ks_stat: number; ks_pvalue: number }>;
    overall_psi: number;
    drift_alert_level: string;
    adaptation_triggered: boolean;
    explanation: string;
    pre_adaptation_metrics: {
      c_factor: number;
      spy_threshold: number;
      decision_threshold: number;
      recall_estimate: number;
    };
    post_adaptation_metrics: {
      c_factor: number;
      spy_threshold: number;
      decision_threshold: number;
      recall_estimate: number;
    };
    timestamp: string;
  };
}

export interface DPBudgetStatus {
  max_epsilon: number;
  spent_epsilon: number;
  remaining_epsilon: number;
  default_delta: number;
  budget_status: string;
  total_queries_serviced: number;
  ledger_summary: Array<{
    timestamp: string;
    query_type: string;
    epsilon_cost: number;
    mechanism: string;
    noise_scale?: number;
    cumulative_spent?: number;
    detail?: string;
  }>;
}

export interface DPMetricsResponse {
  status: string;
  privacy_guarantee: string;
  epsilon_cost: number;
  delta: number;
  noise_scale_avg: number;
  noisy_metrics: Record<string, number>;
  budget_status: DPBudgetStatus;
}

export interface DPGraphSummaryResponse {
  status: string;
  privacy_guarantee: string;
  epsilon_cost: number;
  noisy_summary: {
    node_count_dp: number;
    edge_count_dp: number;
    structuring_nodes_dp: number;
    total_volume_exposed_dp: number;
    average_degree_dp: number;
  };
  reidentification_risk_assessment: {
    k_anonymity_estimate: number;
    l_diversity_index: number;
    reid_risk_score: number;
    risk_level: string;
    recommendation: string;
  };
  budget_status: DPBudgetStatus;
}

interface DPGovernanceStatusResponse {
  status: string;
  budget_status: DPBudgetStatus;
}

interface DPResetResponse {
  status: string;
  message: string;
  budget_status: DPBudgetStatus;
}

// ============================================================================
//                         API Integration Methods
// ============================================================================

export const fageApi = {
  login: async (username: string, password: string) => {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    const response = await apiClient.post<{access_token: string, token_type: string}>('/token', formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return response.data;
  },

  /**
   * Fetch aggregate operational and decision telemetry metrics for dashboards.
   */
  getDashboardSummary: async (): Promise<DashboardTelemetryResponse> => {
    const response = await apiClient.get<DashboardTelemetryResponse>('/dashboard');
    return response.data;
  },

  /**
   * Fetch performance evaluation and confusion matrix indicators across trained algorithms.
   */
  getModelMetrics: async (): Promise<ModelMetricsResponse> => {
    const response = await apiClient.get<ModelMetricsResponse>('/metrics');
    return response.data;
  },

  /**
   * Fetch global Shapley feature aggregations and scatter plot coordinates.
   */
  getFeatureImportance: async (): Promise<FeatureImportanceResponse> => {
    const response = await apiClient.get<FeatureImportanceResponse>('/feature-importance');
    return response.data;
  },

  /**
   * Run immediate transactional attribute classifications.
   */
  predictFraudProbability: async (payload: PredictRequest): Promise<PredictResponse> => {
    const response = await apiClient.post<PredictResponse>('/predict', payload);
    return response.data;
  },

  /**
   * Fetch explicit local instance attributions and formatted Waterfall steps.
   */
  explainCaseAttribution: async (payload: PredictRequest): Promise<ExplainResponse> => {
    const response = await apiClient.post<ExplainResponse>('/explain', payload);
    return response.data;
  },

  /**
   * Score raw transfers against machine learning and compliance rule policies.
   */
  scoreAndEvaluateTransaction: async (payload: RiskScoreRequest): Promise<ScorecardResponse> => {
    const response = await apiClient.post<ScorecardResponse>('/risk-score', payload);
    return response.data;
  },

  /**
   * Query incident queue with optional alert filter states.
   */
  listAlertsQueue: async (filters?: {
    status_filter?: string;
    severity_filter?: string;
    limit?: number;
  }): Promise<AlertsResponse> => {
    const response = await apiClient.get<AlertsResponse>('/alerts', {
      params: filters,
    });
    return response.data;
  },

  /**
   * Push manual or legacy synchronized alert incident metrics into the audit database.
   */
  ingestSimulatedAlert: async (payload: Partial<AlertInfo>): Promise<{ status: string; created_alert_id: string }> => {
    const response = await apiClient.post<{ status: string; created_alert_id: string }>('/alerts', payload);
    return response.data;
  },

  /**
   * Apply status revisions and write analyst audit notes.
   */
  updateAlertStatus: async (alertId: string, payload: AlertUpdateRequest): Promise<{ status: string; message: string; alert: AlertInfo }> => {
    const response = await apiClient.put<{ status: string; message: string; alert: AlertInfo }>(`/alerts/${alertId}`, payload);
    return response.data;
  },

  correlateAlert: async (alertId: string): Promise<CorrelateResponse> => {
    const response = await apiClient.get<CorrelateResponse>(`/correlate/${alertId}`);
    return response.data;
  },
  
  generateSAR: async (alertId: string): Promise<SARResponse> => {
    const response = await apiClient.post<SARResponse>(`/alerts/${alertId}/sar`);
    return response.data;
  },

  /**
   * Real per-account explanation (backed by SHAP key risk drivers), translated into
   * plain English for a non-technical analyst. Not mock copy — calls the live endpoint.
   */
  explainPlainLanguage: async (alertId: string): Promise<{ explanation: string }> => {
    const response = await apiClient.post<{ explanation: string }>(`/alerts/${alertId}/explain-plain-language`);
    return response.data;
  },

  /**
   * Formal record of every model evaluated, including ones rejected, with the real
   * evidence behind each decision. Governance artifact, not a marketing endpoint.
   */
  getModelRegistry: async (): Promise<Record<string, unknown>> => {
    const response = await apiClient.get<Record<string, unknown>>('/model-registry');
    return response.data;
  },
  
  tuneThreshold: async (newThreshold: number): Promise<{status: string, message: string, new_threshold: number}> => {
    const response = await apiClient.post('/tune-threshold', { new_threshold: newThreshold });
    return response.data;
  },

  batchScore: async (file: File): Promise<any> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post('/batch-score', formData);
    return response.data;
  },

  getCostThresholds: async (): Promise<any> => {
    const response = await apiClient.get('/cost-thresholds');
    return response.data;
  },

  getPUCalibration: async (): Promise<any> => {
    const response = await apiClient.get('/pu-calibration');
    return response.data;
  },

  submitFeedback: async (payload: { alert_id: string; label: string; analyst_notes?: string; trigger_recalibration?: boolean }): Promise<any> => {
    const response = await apiClient.post('/feedback', payload);
    return response.data;
  },

  tuneSPYThreshold: async (payload: { spy_threshold?: number; c_factor?: number }): Promise<any> => {
    const response = await apiClient.post('/pu-calibration/tune', payload);
    return response.data;
  },

  evaluateTriage: async (payload: any): Promise<any> => {
    const response = await apiClient.post('/triage-eval', payload);
    return response.data;
  },

  getAuditLogs: async (params?: { limit?: number; entity_type?: string; entity_id?: string }): Promise<{
    status: string;
    count: number;
    logs: Array<{
      id: number;
      timestamp: string;
      actor: string;
      role: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      detail: string | null;
      auth_method: string | null;
    }>;
  }> => {
    const response = await apiClient.get('/audit-logs', { params });
    return response.data;
  },

  getMe: async (): Promise<{ username: string; role: string; display_name: string; auth_method: string }> => {
    const response = await apiClient.get('/me');
    return response.data;
  },

  getAdversarialShiftStatus: async (): Promise<AdversarialShiftStatus> => {
    const response = await apiClient.get('/adversarial-shift/status');
    return response.data;
  },

  simulateAdversarialShift: async (payload: { shift_type: string; intensity: number; trigger_adaptation?: boolean }): Promise<AdversarialShiftSimulateResponse> => {
    const response = await apiClient.post('/adversarial-shift/simulate', payload);
    return response.data;
  },

  getDPModelMetrics: async (epsilon?: number, mechanism: string = 'laplace'): Promise<DPMetricsResponse> => {
    const params = new URLSearchParams();
    if (epsilon !== undefined) params.append('epsilon', epsilon.toString());
    if (mechanism) params.append('mechanism', mechanism);
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await apiClient.get(`/metrics/dp${query}`);
    return response.data;
  },

  exportDPGraphSummary: async (payload: { epsilon?: number; mechanism?: string }): Promise<DPGraphSummaryResponse> => {
    const response = await apiClient.post('/export/graph-summary', payload);
    return response.data;
  },

  getDPGovernanceStatus: async (): Promise<DPGovernanceStatusResponse> => {
    const response = await apiClient.get('/governance/dp-status');
    return response.data;
  },

  resetDPGovernanceBudget: async (max_epsilon?: number): Promise<DPResetResponse> => {
    const response = await apiClient.post('/governance/dp-reset', max_epsilon ? { max_epsilon } : {});
    return response.data;
  },
};

export const apiService = fageApi;
