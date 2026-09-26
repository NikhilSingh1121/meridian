/**
 * MERIDIAN — Quantitative statistics kernel.
 *
 * Pure math. No I/O, no dates, no domain knowledge — just the estimators and
 * hypothesis tests the Quant Lab modules are built on. Everything here is
 * deterministic and unit-tested (see quant-stats.test.js), so any number the
 * terminal prints can be traced back to a formula in this file.
 *
 * Convention (same as technicals.js): return `null` when the input is too
 * short to produce a meaningful estimate, never throw, never guess.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1 · DESCRIPTIVE STATISTICS
   ══════════════════════════════════════════════════════════════════════════ */

const finite = (a) => (a || []).filter((v) => v != null && Number.isFinite(v));

function mean(a) {
  const v = finite(a);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

/** Sample variance (n-1 denominator). */
function variance(a) {
  const v = finite(a);
  if (v.length < 2) return null;
  const m = mean(v);
  return v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1);
}

function stdev(a) {
  const s2 = variance(a);
  return s2 == null ? null : Math.sqrt(s2);
}

/** Fisher–Pearson standardised moment coefficient (sample skewness, G1). */
function skewness(a) {
  const v = finite(a), n = v.length;
  if (n < 3) return null;
  const m = mean(v), sd = stdev(v);
  if (!sd) return null;
  const m3 = v.reduce((s, x) => s + ((x - m) / sd) ** 3, 0) / n;
  return (Math.sqrt(n * (n - 1)) / (n - 2)) * m3;
}

/** Excess kurtosis (sample, G2 — normal distribution ⇒ 0). */
function kurtosis(a) {
  const v = finite(a), n = v.length;
  if (n < 4) return null;
  const m = mean(v), sd = stdev(v);
  if (!sd) return null;
  const m4 = v.reduce((s, x) => s + ((x - m) / sd) ** 4, 0) / n;
  const g2 = m4 - 3;
  return ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6);
}

/** Linear-interpolated quantile (p in 0..1), type-7 (Excel / numpy default). */
function quantile(a, p) {
  const v = finite(a).slice().sort((x, y) => x - y);
  if (!v.length) return null;
  if (v.length === 1) return v[0];
  const h = (v.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h), hi = Math.ceil(h);
  return v[lo] + (h - lo) * (v[hi] - v[lo]);
}

function covariance(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const x = a.slice(0, n), y = b.slice(0, n);
  const mx = mean(x), my = mean(y);
  if (mx == null || my == null) return null;
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (n - 1);
}

/** Pearson correlation. */
function correlation(a, b) {
  const c = covariance(a, b);
  const sa = stdev(a.slice(0, Math.min(a.length, b.length)));
  const sb = stdev(b.slice(0, Math.min(a.length, b.length)));
  if (c == null || !sa || !sb) return null;
  return Math.max(-1, Math.min(1, c / (sa * sb)));
}

/** Spearman rank correlation — robust to outliers and monotone non-linearity. */
function spearman(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(arr.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  return correlation(rank(a.slice(0, n)), rank(b.slice(0, n)));
}

/** Autocorrelation at lag k. */
function autocorr(a, k) {
  const v = finite(a), n = v.length;
  if (n < k + 3) return null;
  const m = mean(v);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) den += (v[i] - m) ** 2;
  for (let i = k; i < n; i++) num += (v[i] - m) * (v[i - k] - m);
  return den ? num / den : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   2 · RETURN TRANSFORMS
   ══════════════════════════════════════════════════════════════════════════ */

/** Simple (arithmetic) returns from a price series. */
function simpleReturns(prices) {
  const out = [];
  for (let i = 1; i < prices.length; i++) {
    const p0 = prices[i - 1];
    out.push(p0 ? prices[i] / p0 - 1 : 0);
  }
  return out;
}

/** Continuously-compounded (log) returns. */
function logReturns(prices) {
  const out = [];
  for (let i = 1; i < prices.length; i++) {
    const p0 = prices[i - 1], p1 = prices[i];
    out.push(p0 > 0 && p1 > 0 ? Math.log(p1 / p0) : 0);
  }
  return out;
}

/** Compound a return stream into an equity curve starting at `base`. */
function equityCurve(returns, base = 1) {
  const out = [base];
  let e = base;
  for (const r of returns) { e *= 1 + r; out.push(e); }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   3 · DISTRIBUTIONS
   Needed for p-values. Implemented from standard series/continued-fraction
   expansions rather than pulled from a package — the server ships no stats
   dependency and these are exact enough for reporting (|err| < 1e-7).
   ══════════════════════════════════════════════════════════════════════════ */

/** Abramowitz & Stegun 7.1.26 — |ε| < 1.5e-7. */
function erf(x) {
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return s * y;
}

/** Standard-normal CDF. */
function normCdf(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }

/** Standard-normal PDF. */
function normPdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }

/** Inverse standard-normal CDF — Acklam's rational approximation (|ε| < 1.2e-9). */
function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** log Γ(x) — Lanczos approximation. */
function gammaln(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/** Continued fraction for the incomplete beta function (Lentz's method). */
function betacf(a, b, x) {
  const FPMIN = 1e-300, EPS = 3e-12;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a,b). */
function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}

/** Regularised upper incomplete gamma Q(a,x) = 1 − P(a,x). */
function gammaq(a, x) {
  if (x < 0 || a <= 0) return null;
  if (x === 0) return 1;
  if (x < a + 1) {
    // series representation for P(a,x)
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 1; n <= 500; n++) {
      ap++; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 3e-12) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
  }
  // continued fraction for Q(a,x)
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}

/** Two-sided p-value for a Student-t statistic with `df` degrees of freedom. */
function tPvalue(t, df) {
  if (!Number.isFinite(t) || df <= 0) return null;
  return betai(df / 2, 0.5, df / (df + t * t));
}

/** Upper-tail p-value for a chi-square statistic. */
function chi2Pvalue(x, df) {
  if (!Number.isFinite(x) || x < 0 || df <= 0) return null;
  return gammaq(df / 2, x / 2);
}

/** Upper-tail p-value for an F statistic. */
function fPvalue(f, df1, df2) {
  if (!Number.isFinite(f) || f < 0) return null;
  return betai(df2 / 2, df1 / 2, df2 / (df2 + df1 * f));
}

/* ══════════════════════════════════════════════════════════════════════════
   4 · LINEAR ALGEBRA (small, dense — k ≤ 8 regressors)
   ══════════════════════════════════════════════════════════════════════════ */

/** Invert a square matrix by Gauss-Jordan with partial pivoting. null if singular. */
function invert(M) {
  const n = M.length;
  const A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-14) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let j = 0; j < 2 * n; j++) A[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (!f) continue;
      for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[col][j];
    }
  }
  return A.map((r) => r.slice(n));
}

const matMulVec = (M, v) => M.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));

/* ══════════════════════════════════════════════════════════════════════════
   5 · ORDINARY LEAST SQUARES
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Multiple OLS regression of y on X (X rows are observations, WITHOUT the
 * intercept column — it is prepended unless `intercept:false`).
 *
 * Returns classical and Newey-West HAC standard errors. Financial residuals
 * are serially correlated and heteroskedastic, so the HAC t-stats are the
 * ones worth quoting — classical SEs overstate significance.
 *
 *   { beta[], se[], t[], p[], seHAC[], tHAC[], pHAC[],
 *     r2, adjR2, n, k, sigma, resid[], fitted[], f, fp, dw, lags }
 */
function ols(y, X, { intercept = true, hacLags = null } = {}) {
  const n = y.length;
  if (!n || !X.length || X.length !== n) return null;
  const Xd = intercept ? X.map((r) => [1, ...r]) : X.map((r) => [...r]);
  const k = Xd[0].length;
  if (n <= k + 1) return null;

  // X'X and X'y
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += Xd[i][a] * y[i];
      for (let b = a; b < k; b++) XtX[a][b] += Xd[i][a] * Xd[i][b];
    }
  }
  for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];

  const XtXinv = invert(XtX);
  if (!XtXinv) return null;
  const beta = matMulVec(XtXinv, Xty);

  const fitted = Xd.map((row) => row.reduce((s, x, j) => s + x * beta[j], 0));
  const resid = y.map((v, i) => v - fitted[i]);

  const my = mean(y);
  const ssTot = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const ssRes = resid.reduce((s, v) => s + v * v, 0);
  const dfRes = n - k;
  const sigma2 = ssRes / dfRes;
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : null;
  const adjR2 = r2 == null ? null : 1 - (1 - r2) * (n - 1) / dfRes;

  // classical SEs
  const se = XtXinv.map((row, j) => Math.sqrt(Math.max(0, sigma2 * row[j])));
  const t = beta.map((b, j) => (se[j] ? b / se[j] : null));
  const p = t.map((tv) => (tv == null ? null : tPvalue(tv, dfRes)));

  // Newey-West HAC: L = floor(4·(n/100)^(2/9)) unless overridden
  const L = hacLags != null ? Math.max(0, hacLags) : Math.max(1, Math.floor(4 * Math.pow(n / 100, 2 / 9)));
  const Omega = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < n; i++) {
    const u2 = resid[i] * resid[i];
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) Omega[a][b] += u2 * Xd[i][a] * Xd[i][b];
  }
  for (let l = 1; l <= L; l++) {
    const w = 1 - l / (L + 1);           // Bartlett kernel
    for (let i = l; i < n; i++) {
      const uu = resid[i] * resid[i - l];
      for (let a = 0; a < k; a++) {
        for (let b = 0; b < k; b++) {
          Omega[a][b] += w * uu * (Xd[i][a] * Xd[i - l][b] + Xd[i - l][a] * Xd[i][b]);
        }
      }
    }
  }
  const corr = n / dfRes; // small-sample correction
  const VarHac = XtXinv.map((_, a) =>
    XtXinv[a].map((__, b) => {
      let s = 0;
      for (let u = 0; u < k; u++) for (let v = 0; v < k; v++) s += XtXinv[a][u] * Omega[u][v] * XtXinv[v][b];
      return s * corr;
    })
  );
  const seHAC = VarHac.map((row, j) => Math.sqrt(Math.max(0, row[j])));
  const tHAC = beta.map((b, j) => (seHAC[j] ? b / seHAC[j] : null));
  const pHAC = tHAC.map((tv) => (tv == null ? null : tPvalue(tv, dfRes)));

  // overall F test (slopes only) + Durbin-Watson
  const dfModel = intercept ? k - 1 : k;
  const f = dfModel > 0 && ssRes > 0 ? ((ssTot - ssRes) / dfModel) / (ssRes / dfRes) : null;
  const fp = f == null ? null : fPvalue(f, dfModel, dfRes);
  let dwNum = 0;
  for (let i = 1; i < n; i++) dwNum += (resid[i] - resid[i - 1]) ** 2;
  const dw = ssRes > 0 ? dwNum / ssRes : null;

  return {
    beta, se, t, p, seHAC, tHAC, pHAC,
    r2, adjR2, n, k, dfRes, sigma: Math.sqrt(sigma2), ssRes, ssTot,
    resid, fitted, f, fp, dw, lags: L, intercept,
  };
}

/** Simple y = α + βx regression — thin wrapper returning flat fields. */
function ols1(y, x) {
  const r = ols(y, x.map((v) => [v]));
  if (!r) return null;
  return {
    alpha: r.beta[0], beta: r.beta[1],
    seAlpha: r.se[0], seBeta: r.se[1],
    tAlpha: r.t[0], tBeta: r.t[1],
    pAlpha: r.p[0], pBeta: r.p[1],
    r2: r.r2, n: r.n, resid: r.resid, sigma: r.sigma,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   6 · UNIT-ROOT & MEAN-REVERSION TESTS
   ══════════════════════════════════════════════════════════════════════════ */

/* MacKinnon (1991/2010) response-surface critical values: C(T) = b∞ + b1/T + b2/T².
   `df`  — Dickey-Fuller, one series, constant / no constant.
   `eg2` — Engle-Granger residual test, N=2 cointegrating variables, constant.
           Residuals are FITTED, so the DF criticals do not apply; using them
           is the classic false-cointegration mistake. */
const CRIT = {
  df_c: { 1: [-3.43035, -6.5393, -16.786], 5: [-2.86154, -2.8903, -4.234], 10: [-2.56677, -1.5384, -2.809] },
  df_n: { 1: [-2.56574, -2.2358, -3.627], 5: [-1.94100, -0.2686, -3.365], 10: [-1.61682, 0.2656, -2.714] },
  eg2_c: { 1: [-3.89644, -10.9519, -33.5030], 5: [-3.33613, -6.1101, -6.8230], 10: [-3.04445, -4.2412, -2.7200] },
};

function criticalValues(table, T) {
  const t = CRIT[table] || CRIT.df_c;
  const out = {};
  for (const lvl of [1, 5, 10]) {
    const [b0, b1, b2] = t[lvl];
    out[lvl] = b0 + b1 / T + b2 / (T * T);
  }
  return out;
}

/**
 * Augmented Dickey-Fuller test.
 *   Δy_t = α + γ·y_{t−1} + Σ δ_i·Δy_{t−i} + ε_t     (regression: "c")
 * H₀: γ = 0 (unit root, non-stationary). Reject ⇒ mean-reverting.
 *
 * Lag order is chosen by minimising AIC over 0..maxLag (Schwert rule default).
 * `table` selects the critical-value surface ("df_c" | "df_n" | "eg2_c").
 */
function adfTest(series, { maxLag = null, regression = "c", table = null } = {}) {
  const y = finite(series);
  const T = y.length;
  if (T < 25) return null;
  const cap = maxLag != null ? maxLag : Math.min(12, Math.floor(12 * Math.pow(T / 100, 0.25)));
  const withConst = regression !== "n";

  let best = null;
  for (let lag = 0; lag <= cap; lag++) {
    const rows = [], target = [];
    for (let i = lag + 1; i < T; i++) {
      const reg = [y[i - 1]];
      for (let j = 1; j <= lag; j++) reg.push(y[i - j] - y[i - j - 1]);
      rows.push(reg);
      target.push(y[i] - y[i - 1]);
    }
    if (rows.length < 15) break;
    const r = ols(target, rows, { intercept: withConst });
    if (!r) continue;
    const kk = r.k;
    const aic = rows.length * Math.log(r.ssRes / rows.length) + 2 * kk;
    if (!best || aic < best.aic) {
      const gi = withConst ? 1 : 0;
      best = { aic, lag, stat: r.t[gi], gamma: r.beta[gi], se: r.se[gi], nobs: rows.length };
    }
  }
  if (!best || best.stat == null) return null;

  const crit = criticalValues(table || (withConst ? "df_c" : "df_n"), best.nobs);
  const level = best.stat < crit[1] ? 1 : best.stat < crit[5] ? 5 : best.stat < crit[10] ? 10 : null;
  return {
    stat: best.stat, lag: best.lag, gamma: best.gamma, se: best.se, nobs: best.nobs,
    crit, rejectAt: level, stationary: level != null && level <= 5,
    verdict: level == null ? "Unit root not rejected" : `Unit root rejected at ${level}%`,
  };
}

/**
 * Ornstein-Uhlenbeck half-life of mean reversion.
 *   Δs_t = a + b·s_{t−1} + ε   ⇒   half-life = −ln 2 / b   (needs b < 0)
 *
 * NB: this regression IS a Dickey-Fuller regression, so its t-statistic does
 * NOT follow a t-distribution — under a unit root it follows the DF
 * distribution, whose 5% critical value is ≈ −2.86 rather than −1.96. Judging
 * `b` against the normal table is the standard way to convince yourself a
 * random walk mean-reverts, so the flag below uses the DF criticals. The
 * half-life number itself is still reported (it is just a transform of b) and
 * is only meaningful once `meanReverting` is true.
 */
function halfLife(series) {
  const s = finite(series);
  if (s.length < 20) return null;
  const y = [], x = [];
  for (let i = 1; i < s.length; i++) { y.push(s[i] - s[i - 1]); x.push(s[i - 1]); }
  const r = ols1(y, x);
  if (!r) return null;
  const crit = criticalValues("df_c", y.length);
  if (r.beta >= 0) {
    return { lambda: r.beta, halfLife: null, tStat: r.tBeta, crit, meanReverting: false };
  }
  return {
    lambda: r.beta,
    halfLife: -Math.log(2) / r.beta,
    tStat: r.tBeta,
    crit,
    meanReverting: r.tBeta < crit[5],
  };
}

/**
 * Hurst exponent by rescaled-range (R/S) analysis.
 *   H < 0.5 mean-reverting · H ≈ 0.5 random walk · H > 0.5 trending
 */
function hurst(series) {
  const s = finite(series);
  const n = s.length;
  if (n < 64) return null;
  const rets = logReturns(s);
  const pts = [];
  for (let w = 8; w <= Math.floor(rets.length / 2); w = Math.floor(w * 1.6)) {
    const chunks = Math.floor(rets.length / w);
    if (chunks < 1) break;
    const rs = [];
    for (let c = 0; c < chunks; c++) {
      const seg = rets.slice(c * w, (c + 1) * w);
      const m = mean(seg), sd = stdev(seg);
      if (!sd) continue;
      let cum = 0, hi = -Infinity, lo = Infinity;
      for (const v of seg) { cum += v - m; if (cum > hi) hi = cum; if (cum < lo) lo = cum; }
      const range = hi - lo;
      if (range > 0) rs.push(range / sd);
    }
    if (rs.length) pts.push([Math.log(w), Math.log(mean(rs))]);
  }
  if (pts.length < 4) return null;
  const r = ols1(pts.map((p) => p[1]), pts.map((p) => p[0]));
  if (!r) return null;
  return { h: r.beta, se: r.seBeta, r2: r.r2, points: pts.length,
    regime: r.beta < 0.45 ? "Mean-reverting" : r.beta > 0.55 ? "Trending" : "Random walk" };
}

/**
 * Lo–MacKinlay variance-ratio test with heteroskedasticity-robust z.
 * VR(q) > 1 ⇒ positive autocorrelation (trend persists);
 * VR(q) < 1 ⇒ mean reversion. |z| > 1.96 ⇒ random walk rejected at 5%.
 */
function varianceRatio(returns, q) {
  const r = finite(returns);
  const T = r.length;
  if (T < q * 4 || q < 2) return null;
  const mu = mean(r);
  let sa = 0;
  for (const v of r) sa += (v - mu) ** 2;
  const sigmaA = sa / (T - 1);
  if (!sigmaA) return null;

  // overlapping q-period variance
  const m = q * (T - q + 1) * (1 - q / T);
  let sc = 0;
  for (let t = q; t <= T; t++) {
    let sum = 0;
    for (let j = t - q; j < t; j++) sum += r[j];
    sc += (sum - q * mu) ** 2;
  }
  const sigmaC = sc / m;
  const vr = sigmaC / sigmaA;

  // heteroskedasticity-consistent variance of VR
  let theta = 0;
  for (let j = 1; j < q; j++) {
    let num = 0;
    for (let t = j; t < T; t++) num += ((r[t] - mu) ** 2) * ((r[t - j] - mu) ** 2);
    const delta = num / (sa * sa);
    theta += ((2 * (q - j)) / q) ** 2 * delta;
  }
  const z = theta > 0 ? (vr - 1) / Math.sqrt(theta) : null;
  return { q, vr, z, pValue: z == null ? null : 2 * (1 - normCdf(Math.abs(z))),
    reading: vr > 1 ? "Trend-persistent" : "Mean-reverting" };
}

/** Ljung-Box Q test for joint autocorrelation up to `lags`. */
function ljungBox(returns, lags = 10) {
  const r = finite(returns);
  const n = r.length;
  if (n < lags + 10) return null;
  let q = 0;
  const acf = [];
  for (let k = 1; k <= lags; k++) {
    const a = autocorr(r, k);
    if (a == null) return null;
    acf.push(a);
    q += (a * a) / (n - k);
  }
  q *= n * (n + 2);
  return { q, lags, acf, pValue: chi2Pvalue(q, lags), autocorrelated: chi2Pvalue(q, lags) < 0.05 };
}

/** Jarque-Bera normality test (χ² with 2 df). */
function jarqueBera(returns) {
  const r = finite(returns);
  const n = r.length;
  if (n < 20) return null;
  const s = skewness(r), k = kurtosis(r);
  if (s == null || k == null) return null;
  const jb = (n / 6) * (s * s + (k * k) / 4);
  return { jb, skew: s, excessKurtosis: k, pValue: chi2Pvalue(jb, 2), normal: chi2Pvalue(jb, 2) > 0.05 };
}

/* ══════════════════════════════════════════════════════════════════════════
   7 · RISK MEASURES
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Value-at-Risk and Expected Shortfall by three methods, so the reader can see
 * how much of the tail the normal assumption misses:
 *   · historical    — empirical quantile, no distributional assumption
 *   · gaussian      — μ + zσ, assumes normality
 *   · cornishFisher — Gaussian quantile expanded for skew & excess kurtosis
 * Returned as POSITIVE loss magnitudes in return units (0.023 ⇒ 2.3%).
 */
function valueAtRisk(returns, conf = 0.95) {
  const r = finite(returns);
  if (r.length < 30) return null;
  const alpha = 1 - conf;
  const mu = mean(r), sd = stdev(r);
  const s = skewness(r) ?? 0, k = kurtosis(r) ?? 0;

  const hist = quantile(r, alpha);
  const tail = r.filter((v) => v <= hist);
  const cvarHist = tail.length ? mean(tail) : hist;

  const z = normInv(alpha);
  const gauss = mu + z * sd;
  const cvarGauss = mu - sd * (normPdf(z) / alpha);

  // Cornish-Fisher expansion of the Gaussian quantile
  const zcf = z + (z * z - 1) * s / 6 + (z ** 3 - 3 * z) * k / 24 - (2 * z ** 3 - 5 * z) * s * s / 36;
  const cf = mu + zcf * sd;

  const neg = (v) => (v == null ? null : Math.abs(Math.min(0, v)));
  return {
    conf,
    historical: neg(hist), cvarHistorical: neg(cvarHist),
    gaussian: neg(gauss), cvarGaussian: neg(cvarGauss),
    cornishFisher: neg(cf),
    tailObservations: tail.length,
    fatTailPremium: neg(hist) != null && neg(gauss) ? neg(hist) / neg(gauss) - 1 : null,
  };
}

/**
 * Full drawdown profile from an equity curve.
 * Returns the max drawdown plus the N deepest episodes with peak / trough /
 * recovery indices and their durations in bars.
 */
function drawdowns(equity, top = 5) {
  if (!equity || equity.length < 3) return null;
  const dd = [];
  let peak = equity[0], peakIdx = 0;
  const curve = [];
  const episodes = [];
  let cur = null;
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peak) {
      if (cur) { cur.recoveryIdx = i; cur.recoveryBars = i - cur.troughIdx; episodes.push(cur); cur = null; }
      peak = equity[i]; peakIdx = i;
    }
    const d = peak > 0 ? equity[i] / peak - 1 : 0;
    curve.push(d);
    dd.push(d);
    if (d < 0) {
      if (!cur) cur = { peakIdx, startIdx: i, depth: d, troughIdx: i, recoveryIdx: null };
      if (d < cur.depth) { cur.depth = d; cur.troughIdx = i; }
    }
  }
  if (cur) { cur.recoveryIdx = null; cur.recoveryBars = null; episodes.push(cur); }
  episodes.forEach((e) => {
    e.declineBars = e.troughIdx - e.peakIdx;
    e.totalBars = (e.recoveryIdx ?? equity.length - 1) - e.peakIdx;
    e.underwater = e.recoveryIdx == null;
  });
  const sorted = episodes.slice().sort((a, b) => a.depth - b.depth).slice(0, top);
  const maxDD = Math.min(...dd, 0);
  const longest = episodes.reduce((m, e) => (e.totalBars > (m?.totalBars ?? -1) ? e : m), null);
  return { maxDD, curve, episodes: sorted, longestBars: longest ? longest.totalBars : 0, currentDD: dd[dd.length - 1] };
}

/**
 * Standard performance pack from a daily return stream.
 * `periodsPerYear` defaults to 252 trading days.
 */
function performance(returns, { periodsPerYear = 252, rf = 0, years = null } = {}) {
  const r = finite(returns);
  if (r.length < 5) return null;
  const eq = equityCurve(r);
  const total = eq[eq.length - 1] - 1;
  const yrs = years ?? r.length / periodsPerYear;
  const cagr = yrs > 0 && eq[eq.length - 1] > 0 ? Math.pow(eq[eq.length - 1], 1 / yrs) - 1 : null;
  const sd = stdev(r);
  const vol = sd == null ? null : sd * Math.sqrt(periodsPerYear);
  const rfPer = rf / periodsPerYear;
  const excess = r.map((v) => v - rfPer);
  const mExcess = mean(excess);
  const sharpe = sd ? (mExcess / sd) * Math.sqrt(periodsPerYear) : null;
  const downside = r.filter((v) => v < rfPer);
  const dd = downside.length
    ? Math.sqrt(downside.reduce((s, v) => s + (v - rfPer) ** 2, 0) / r.length) * Math.sqrt(periodsPerYear)
    : null;
  const sortino = dd ? (mExcess * periodsPerYear) / dd : null;
  const prof = drawdowns(eq);
  const maxDD = prof ? prof.maxDD : null;
  const calmar = cagr != null && maxDD ? cagr / Math.abs(maxDD) : null;
  // t-stat that the mean daily return differs from zero — the honest read on
  // whether an equity curve is skill or noise.
  const tStat = sd ? (mean(r) / (sd / Math.sqrt(r.length))) : null;
  return {
    totalReturn: total, cagr, vol, sharpe, sortino, calmar,
    maxDD, currentDD: prof ? prof.currentDD : null, longestDDBars: prof ? prof.longestBars : null,
    downsideDev: dd, years: yrs, bars: r.length,
    winRateDaily: r.filter((v) => v > 0).length / r.length,
    bestDay: Math.max(...r), worstDay: Math.min(...r),
    skew: skewness(r), excessKurtosis: kurtosis(r),
    tStat, pValue: tStat == null ? null : tPvalue(tStat, r.length - 1),
    equity: eq, ddCurve: prof ? prof.curve : null, ddEpisodes: prof ? prof.episodes : [],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   8 · SERIES ALIGNMENT
   ══════════════════════════════════════════════════════════════════════════ */

/** UTC day key for a ms timestamp — the join key for cross-symbol alignment. */
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Inner-join several {t,c} point arrays on calendar day.
 * Returns { dates[], closes: { sym: number[] } } with only days present in
 * EVERY series — the only honest basis for correlation / regression across
 * markets with different holiday calendars.
 */
function alignByDate(seriesMap) {
  const keys = Object.keys(seriesMap);
  if (!keys.length) return { dates: [], closes: {} };
  const maps = {};
  for (const k of keys) {
    const m = new Map();
    for (const p of seriesMap[k] || []) {
      if (p && p.c != null && Number.isFinite(p.c)) m.set(dayKey(p.t), p.c);
    }
    maps[k] = m;
  }
  const base = [...maps[keys[0]].keys()].sort();
  const dates = base.filter((d) => keys.every((k) => maps[k].has(d)));
  const closes = {};
  for (const k of keys) closes[k] = dates.map((d) => maps[k].get(d));
  return { dates, closes };
}

module.exports = {
  // descriptive
  mean, variance, stdev, skewness, kurtosis, quantile, covariance, correlation, spearman, autocorr,
  // transforms
  simpleReturns, logReturns, equityCurve,
  // distributions
  erf, normCdf, normPdf, normInv, gammaln, betai, gammaq, tPvalue, chi2Pvalue, fPvalue,
  // linear algebra
  invert, matMulVec,
  // regression
  ols, ols1,
  // time-series tests
  adfTest, criticalValues, halfLife, hurst, varianceRatio, ljungBox, jarqueBera,
  // risk
  valueAtRisk, drawdowns, performance,
  // alignment
  alignByDate, dayKey,
};
