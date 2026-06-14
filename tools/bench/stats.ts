/**
 * tools/bench/stats.ts — Statistical utilities for benchmarking.
 */

// Student's t critical values for 95% CI (two-tailed, alpha=0.05)
// Index by degrees of freedom (n-1), for n=3..30
const T_CRITICAL_95: Record<number, number> = {
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
  11: 2.201,
  12: 2.179,
  13: 2.160,
  14: 2.145,
  15: 2.131,
  16: 2.120,
  17: 2.110,
  18: 2.101,
  19: 2.093,
  20: 2.086,
  21: 2.080,
  22: 2.074,
  23: 2.069,
  24: 2.064,
  25: 2.060,
  26: 2.056,
  27: 2.052,
  28: 2.048,
  29: 2.045,
};

function tCritical(df: number): number {
  if (df in T_CRITICAL_95) return T_CRITICAL_95[df];
  if (df < 2) return 12.706; // df=1, very wide
  return 1.96; // approximate for df > 29
}

export function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  const logSum = values.reduce((acc, v) => acc + Math.log(v), 0);
  return Math.exp(logSum / values.length);
}

export function arithmeticMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = arithmeticMean(values);
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function confidenceInterval95(values: number[]): {
  mean: number;
  ci: number;
  low: number;
  high: number;
} {
  const n = values.length;
  const mean = arithmeticMean(values);
  if (n < 2) return { mean, ci: 0, low: mean, high: mean };

  const sd = standardDeviation(values);
  const df = n - 1;
  const t = tCritical(df);
  const se = sd / Math.sqrt(n);
  const ci = t * se;

  return { mean, ci, low: mean - ci, high: mean + ci };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function formatResult(
  label: string,
  gjoa: number[],
  firefox: number[],
  unit: string = "ms",
): string {
  const gjoaCI = confidenceInterval95(gjoa);
  const firefoxCI = confidenceInterval95(firefox);

  const lines: string[] = [];
  lines.push(`  ${label}`);
  lines.push(
    `    Gjoa:    ${gjoaCI.mean.toFixed(1)} ${unit}  ` +
      `[${gjoaCI.low.toFixed(1)} .. ${gjoaCI.high.toFixed(1)}] ` +
      `(95% CI, n=${gjoa.length})`,
  );
  lines.push(
    `    Firefox: ${firefoxCI.mean.toFixed(1)} ${unit}  ` +
      `[${firefoxCI.low.toFixed(1)} .. ${firefoxCI.high.toFixed(1)}] ` +
      `(95% CI, n=${firefox.length})`,
  );

  // Guard against division by zero / empty samples (BENCH-6).
  if (gjoa.length < 1 || firefox.length < 1 || gjoaCI.mean === 0 || firefoxCI.mean === 0) {
    lines.push(`    Ratio:   n/a (insufficient samples)`);
    return lines.join("\n");
  }

  const speedup = firefoxCI.mean / gjoaCI.mean;
  const pct = ((speedup - 1) * 100).toFixed(1);
  const dir = speedup >= 1 ? "faster" : "slower";
  const absPct = Math.abs(parseFloat(pct)).toFixed(1);
  lines.push(`    Ratio:   ${speedup.toFixed(3)}x — Gjoa is ${absPct}% ${dir}`);

  return lines.join("\n");
}
