/**
 * FAGE Shared Currency Formatting Utilities
 * Standardized Indian Rupee (INR) formatting according to en-IN locale and RBI/Bank of India conventions.
 */

export const formatINR = (val: number | null | undefined): string => {
  if (val === null || val === undefined || isNaN(val)) {
    return '₹0.00';
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(val);
};

export const formatINRAbbreviated = (val: number | null | undefined): string => {
  if (val === null || val === undefined || isNaN(val)) {
    return '₹0.00';
  }
  const absVal = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  
  if (absVal >= 10000000) {
    return `${sign}₹${(absVal / 10000000).toFixed(2)}Cr`;
  } else if (absVal >= 100000) {
    return `${sign}₹${(absVal / 100000).toFixed(2)}L`;
  } else if (absVal >= 1000) {
    return `${sign}₹${(absVal / 1000).toFixed(1)}k`;
  }
  return `${sign}₹${absVal.toFixed(2)}`;
};
