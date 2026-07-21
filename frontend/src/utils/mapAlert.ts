import { Alert } from '../types';
import { AlertInfo } from '../services/api';

export function mapApiAlert(a: AlertInfo): Alert {
  const risk_score = a.risk_score || 0;
  const explainability = a.explainability || null;
  const ci = explainability?.confidence_interval_90 || null;

  let confidencePercent: number;
  let confidenceLabel: string;
  if (ci && ci.width !== null) {
    confidencePercent = Math.round(Math.max(0, Math.min(100, 100 - ci.width * 100)));
    confidenceLabel = confidencePercent >= 80 ? 'High' : confidencePercent >= 50 ? 'Medium' : 'Low';
  } else {
    confidencePercent = 0;
    confidenceLabel = 'Unavailable';
  }

  let customType = 'Rapid Fund Transfer (Mule)';
  if (a.id.startsWith('ALT-TGT-') || risk_score >= 50) {
    customType = 'Mule Account';
  } else if (a.reason) {
    if (a.reason.includes('Dataset Target Fraud Account')) customType = 'Mule Account';
    else if (a.reason.includes('Low Risk Dataset Account')) customType = 'Normal Account Profile';
    else if (a.reason.includes('triggered')) customType = a.reason.split('triggered')[0]?.trim() || 'Policy Trigger Exception';
    else {
      const dotIndex = a.reason.indexOf('.');
      const firstClause = dotIndex !== -1 ? a.reason.substring(0, dotIndex) : a.reason;
      customType = firstClause.length > 35 ? firstClause.substring(0, 35) + '...' : firstClause;
    }
  }

  const customPrio = a.severity === 'Critical' ? 'P1 - Immediate' : a.severity === 'High' ? 'P2 - Review' : 'P3 - Monitor';
  const timestampVal = a.timestamp
    ? new Date(a.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : 'Recent';
  const isoTimestamp = a.timestamp || null; // BUG-002 FIX: preserve raw ISO for safe Date parsing
  const amount = a.amount || 0;

  const rawDrivers = Array.isArray(explainability?.key_risk_drivers) ? explainability.key_risk_drivers : [];
  const keyRiskDrivers = rawDrivers.map((d: any) => {
    const val = typeof d.importance_attribution === 'number'
      ? d.importance_attribution
      : typeof d.shap_value === 'number'
        ? d.shap_value
        : typeof d.importanceScore === 'number'
          ? d.importanceScore
          : 0;
    const direction = d.direction || (val > 0 ? 'increases_risk' : 'reduces_risk'); // BUG-006 FIX: val===0 is neutral, not risk-increasing
    return {
      feature: d.feature || 'unknown_feature',
      importance_attribution: val,
      direction: direction as 'increases_risk' | 'reduces_risk',
      raw_value: typeof d.raw_value === 'number' ? d.raw_value : 0,
    };
  });

  return {
    id: a.id,
    accountNumber: a.sender_id || 'ACC-UNKNOWN',
    receiverAccountId: a.receiver_id || 'Unknown',
    type: customType,
    reason: a.reason,
    riskScore: risk_score,
    confidence: confidenceLabel === 'Unavailable' ? 'Unavailable' : `${confidenceLabel} (${confidencePercent}%)`,
    confidenceVal: confidencePercent,
    status: (a.status || 'Open') as Alert['status'],
    dateOpened: isoTimestamp || undefined, // BUG-002 FIX: store raw ISO for accurate Date parsing in workbench
    timestamp: timestampVal,
    transactionAmount: amount,
    prio: a.priority_tier || customPrio,
    triage_action: a.triage_action,
    priority_tier: a.priority_tier,
    pu_probability: a.pu_probability,
    assignedTo: a.assigned_to || 'Unassigned',
    logs: a.logs,
    keyRiskDrivers,
    confidenceInterval: ci,
    evasionResistance: (explainability?.evasion_resistance as unknown as Alert['evasionResistance']) || null,
    triageDecision: (explainability as any)?.triage_evaluation || (a as any).triage_evaluation || null,
    hasRealExplainability: explainability !== null,
  };
}

export function filterAlertsBySource(alerts: Alert[], dataSource: 'live-all' | 'live-target' | 'live-dataset'): Alert[] {
  if (dataSource === 'live-target') {
    return alerts.filter(a => a.id.startsWith('ALT-TGT-') || a.type === 'Mule Account');
  }
  if (dataSource === 'live-dataset') {
    return alerts.filter(a => a.id.startsWith('ALT-DS-'));
  }
  return alerts;
}
