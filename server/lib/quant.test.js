/**
 * Quant kernel + engine tests.
 *
 * Estimators are checked against closed-form answers or values that can be
 * verified by hand, not against whatever the code happened to return when it
 * was written. Where a published reference exists (MacKinnon critical values,
 * Lo-MacKinlay VR under a random walk) the test asserts against it.
 *
 * Run: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./quant-stats");
const Q = require("./quant");

const close = (a, b, eps = 1e-6, msg) =>
  assert.ok(Math.abs(a - b) < eps, `${msg || ""} expected ≈${b}, got ${a} (Δ${Math.abs(a - b)})`);

/** Deterministic PRNG so the statistical tests never flake. */
function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Box-Muller normal draws. */
function normals(n, seed = 7, mu = 0, sd = 1) {
  const r = rng(seed), out = [];
  while (out.length < n) {
    const u = Math.max(r(), 1e-12), v = r();
    out.push(mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
    out.push(mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.sin(2 * Math.PI * v));
  }
  return out.slice(0, n);
}

/* ══════════════════════════════════════════════════════════════════════════
   DESCRIPTIVE STATISTICS
   ══════════════════════════════════════════════════════════════════════════ */

test("mean / variance / stdev use the sample (n−1) convention", () => {
  const x = [2, 4, 4, 4, 5, 5, 7, 9];
  close(S.mean(x), 5);
  close(S.variance(x), 32 / 7);            // Σ(x−x̄)² = 32, n−1 = 7
  close(S.stdev(x), Math.sqrt(32 / 7));
});

test("skewness is zero for a symmetric set and positive for a right tail", () => {
  close(S.skewness([1, 2, 3, 4, 5]), 0, 1e-12);
  assert.ok(S.skewness([1, 1, 1, 1, 10]) > 1);
  assert.ok(S.skewness([1, 10, 10, 10, 10]) < -1);
});

test("excess kurtosis of a large normal sample is near zero", () => {
  const k = S.kurtosis(normals(20000, 11));
  assert.ok(Math.abs(k) < 0.15, `excess kurtosis ${k} should be ≈0 for normal draws`);
});

test("quantile matches the type-7 (numpy/Excel) definition", () => {
  const x = [1, 2, 3, 4];
  close(S.quantile(x, 0), 1);
  close(S.quantile(x, 1), 4);
  close(S.quantile(x, 0.5), 2.5);
  close(S.quantile(x, 0.25), 1.75);
});

test("correlation is ±1 on exact linear relations and 0 on orthogonal ones", () => {
  const x = [1, 2, 3, 4, 5, 6];
  close(S.correlation(x, x.map((v) => 3 * v + 7)), 1, 1e-9);
  close(S.correlation(x, x.map((v) => -2 * v)), -1, 1e-9);
  // Σ(x−x̄)(y−ȳ) = 0 for this pair, so the correlation is exactly zero
  close(S.correlation([1, 2, 3, 4], [1, -1, -1, 1]), 0, 1e-9);
});

test("spearman survives a monotone non-linear transform that breaks pearson", () => {
  const x = [1, 2, 3, 4, 5, 6, 7, 8];
  const y = x.map((v) => Math.exp(v));      // monotone, strongly convex
  close(S.spearman(x, y), 1, 1e-9);
  assert.ok(S.correlation(x, y) < 0.95, "pearson should be degraded by the curvature");
});

test("returns and equity curve round-trip", () => {
  const px = [100, 110, 99, 148.5];
  const r = S.simpleReturns(px);
  close(r[0], 0.1); close(r[1], -0.1); close(r[2], 0.5);
  const eq = S.equityCurve(r);
  close(eq[eq.length - 1], px[px.length - 1] / px[0], 1e-9);
  // log returns telescope to the total log return
  close(S.logReturns(px).reduce((a, b) => a + b, 0), Math.log(148.5 / 100), 1e-12);
});

/* ══════════════════════════════════════════════════════════════════════════
   DISTRIBUTIONS
   ══════════════════════════════════════════════════════════════════════════ */

test("normCdf hits published standard-normal values", () => {
  close(S.normCdf(0), 0.5, 1e-7);
  close(S.normCdf(1.644853), 0.95, 1e-6);
  close(S.normCdf(1.959964), 0.975, 1e-6);
  close(S.normCdf(2.326348), 0.99, 1e-6);
  close(S.normCdf(-1.959964), 0.025, 1e-6);
});

test("normInv inverts normCdf", () => {
  for (const p of [0.001, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 0.999]) {
    close(S.normCdf(S.normInv(p)), p, 1e-6, `p=${p}`);
  }
  close(S.normInv(0.975), 1.959964, 1e-5);
});

test("tPvalue matches the standard two-sided t table", () => {
  // t(0.975, 10) = 2.228 ⇒ two-sided p = 0.05
  close(S.tPvalue(2.228139, 10), 0.05, 1e-5);
  // t(0.975, 30) = 2.042
  close(S.tPvalue(2.042272, 30), 0.05, 1e-5);
  // large df converges on the normal
  close(S.tPvalue(1.959964, 1e6), 0.05, 1e-4);
  close(S.tPvalue(0, 10), 1, 1e-9);
});

test("chi2Pvalue is exact for df=2 and matches the table elsewhere", () => {
  // df=2 has the closed form Q(x) = exp(−x/2)
  close(S.chi2Pvalue(4, 2), Math.exp(-2), 1e-8);
  // χ²(0.95, 10) = 18.307
  close(S.chi2Pvalue(18.307, 10), 0.05, 1e-4);
  // χ²(0.95, 1) = 3.8415
  close(S.chi2Pvalue(3.841459, 1), 0.05, 1e-5);
});

test("fPvalue matches the F table", () => {
  // F(0.95, 3, 20) = 3.0984
  close(S.fPvalue(3.098391, 3, 20), 0.05, 1e-4);
  // F(0.95, 1, 10) = 4.9646 — and F(1,n) is t(n)² so the p-values must agree
  close(S.fPvalue(4.964603, 1, 10), 0.05, 1e-4);
  close(S.fPvalue(2.228139 ** 2, 1, 10), S.tPvalue(2.228139, 10), 1e-6);
});

/* ══════════════════════════════════════════════════════════════════════════
   LINEAR ALGEBRA & REGRESSION
   ══════════════════════════════════════════════════════════════════════════ */

test("invert produces a true inverse and rejects singular matrices", () => {
  const M = [[4, 7], [2, 6]];
  const I = S.invert(M);
  close(I[0][0], 0.6); close(I[0][1], -0.7);
  close(I[1][0], -0.2); close(I[1][1], 0.4);
  assert.equal(S.invert([[1, 2], [2, 4]]), null, "singular matrix must return null");
});

test("ols recovers exact coefficients on noiseless data", () => {
  // y = 5 + 2·x1 − 3·x2
  const X = [], y = [];
  for (let i = 0; i < 40; i++) {
    const a = i % 7, b = (i * 3) % 5;
    X.push([a, b]);
    y.push(5 + 2 * a - 3 * b);
  }
  const r = S.ols(y, X);
  close(r.beta[0], 5, 1e-9); close(r.beta[1], 2, 1e-9); close(r.beta[2], -3, 1e-9);
  close(r.r2, 1, 1e-9);
  assert.equal(r.k, 3);
  assert.equal(r.n, 40);
});

test("ols1 reproduces a hand-computable simple regression", () => {
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 5, 4, 5];
  const r = S.ols1(y, x);
  close(r.beta, 0.6, 1e-12);     // Sxy/Sxx = 6/10
  close(r.alpha, 2.2, 1e-12);    // ȳ − β·x̄ = 4 − 0.6·3
  close(r.r2, 0.6, 1e-12);
});

test("ols standard errors match the textbook formula", () => {
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 5, 4, 5];
  const r = S.ols(y, x.map((v) => [v]));
  // fitted = 2.8, 3.4, 4.0, 4.6, 5.2 ⇒ residuals −0.8, 0.6, 1.0, −0.6, −0.2
  // SSR = 2.4, df = n − k = 3 ⇒ σ² = 0.8; Sxx = 10 ⇒ se(β) = √(σ²/Sxx)
  close(r.ssRes, 2.4, 1e-12);
  close(r.sigma, Math.sqrt(0.8), 1e-9);
  close(r.se[1], Math.sqrt(0.8 / 10), 1e-9);
  // SST = 6 ⇒ R² = 1 − 2.4/6 = 0.6, consistent with the ols1 test above
  close(r.r2, 0.6, 1e-12);
});

test("Newey-West SEs equal White/OLS SEs when there is no serial correlation", () => {
  // With hacLags = 0 the Bartlett sum collapses to the heteroskedasticity-only
  // sandwich, which for homoskedastic data sits close to the classical SE.
  const x = normals(600, 3);
  const e = normals(600, 4, 0, 0.5);
  const y = x.map((v, i) => 1 + 2 * v + e[i]);
  const r = S.ols(y, x.map((v) => [v]), { hacLags: 0 });
  const ratio = r.seHAC[1] / r.se[1];
  assert.ok(ratio > 0.85 && ratio < 1.15, `HAC/OLS SE ratio ${ratio} should be ≈1 without autocorrelation`);
});

test("Newey-West SEs widen when residuals are strongly autocorrelated", () => {
  // AR(1) errors with φ = 0.85 — classical SEs understate uncertainty badly.
  const n = 800, x = normals(n, 5), out = [];
  let e = 0;
  const shocks = normals(n, 6, 0, 0.4);
  for (let i = 0; i < n; i++) { e = 0.85 * e + shocks[i]; out.push(e); }
  const y = x.map((v, i) => 1 + 2 * v + out[i]);
  const r = S.ols(y, x.map((v) => [v]));
  assert.ok(r.seHAC[0] > r.se[0] * 1.4, "HAC SE on the intercept must exceed the classical one under AR(1) errors");
  assert.ok(r.dw < 1, `Durbin-Watson ${r.dw} should flag positive autocorrelation`);
});

/* ══════════════════════════════════════════════════════════════════════════
   UNIT-ROOT & MEAN-REVERSION TESTS
   ══════════════════════════════════════════════════════════════════════════ */

test("MacKinnon critical values converge on the published asymptotic values", () => {
  const c = S.criticalValues("df_c", 1e9);
  close(c[1], -3.43035, 1e-4);
  close(c[5], -2.86154, 1e-4);
  close(c[10], -2.56677, 1e-4);
  // Engle-Granger criticals for N=2 are strictly more demanding than DF
  const eg = S.criticalValues("eg2_c", 1e9);
  assert.ok(eg[5] < c[5], "EG 5% critical must be more negative than the DF one");
  // finite samples require an even more negative statistic
  assert.ok(S.criticalValues("df_c", 100)[5] < c[5]);
});

test("ADF does not reject a unit root on a random walk", () => {
  const s = [100];
  const sh = normals(600, 21, 0, 1);
  for (let i = 0; i < 600; i++) s.push(s[i] + sh[i]);
  const r = S.adfTest(s);
  assert.ok(r, "ADF should return a result");
  assert.equal(r.stationary, false, `random walk wrongly called stationary (stat ${r.stat})`);
  assert.ok(r.stat > r.crit[5], "statistic should sit above the 5% critical value");
});

test("ADF rejects a unit root on a mean-reverting AR(1)", () => {
  // x_t = 0.85·x_{t−1} + ε — strongly stationary
  const s = [0];
  const sh = normals(600, 22, 0, 1);
  for (let i = 0; i < 600; i++) s.push(0.85 * s[i] + sh[i]);
  const r = S.adfTest(s);
  assert.equal(r.stationary, true, `stationary AR(1) not detected (stat ${r.stat}, 5% ${r.crit[5]})`);
  assert.equal(r.rejectAt, 1);
});

test("half-life recovers the known decay of an AR(1)", () => {
  // For x_t = φ·x_{t−1}, half-life = −ln2 / ln φ. φ = 0.9 ⇒ ≈6.58 periods.
  const s = [0];
  const sh = normals(4000, 23, 0, 0.3);
  for (let i = 0; i < 4000; i++) s.push(0.9 * s[i] + sh[i]);
  const h = S.halfLife(s);
  const expected = -Math.log(2) / Math.log(0.9);
  assert.ok(Math.abs(h.halfLife - expected) < 1.2, `half-life ${h.halfLife} should be ≈${expected}`);
  assert.equal(h.meanReverting, true);
});

test("half-life judges a random walk against Dickey-Fuller, not normal, criticals", () => {
  const s = [0];
  const sh = normals(1500, 24, 0, 1);
  for (let i = 0; i < 1500; i++) s.push(s[i] + sh[i]);
  const h = S.halfLife(s);
  // This sample lands at t ≈ −2.38: "significant" on the normal table, but
  // nowhere near the DF 5% value of ≈ −2.86. Reading it the naive way is how
  // random walks get mistaken for mean-reverting spreads.
  assert.ok(h.tStat < -1.96, "sanity: this sample really does clear the naive threshold");
  assert.equal(h.meanReverting, false, `random walk called mean-reverting (t ${h.tStat} vs DF 5% ${h.crit[5]})`);
  // and the ADF test must agree, since it is the same regression
  assert.equal(S.adfTest(s).stationary, false);
});

test("variance ratio is ≈1 for a random walk and >1 for a trending series", () => {
  const rw = normals(3000, 31, 0, 0.01);
  const vr = S.varianceRatio(rw, 5);
  assert.ok(Math.abs(vr.vr - 1) < 0.12, `VR ${vr.vr} should be ≈1 for iid returns`);
  assert.ok(Math.abs(vr.z) < 2.6, `z ${vr.z} should not reject the random walk`);

  // positively autocorrelated returns ⇒ VR > 1
  const trend = [];
  let prev = 0;
  for (let i = 0; i < 3000; i++) { prev = 0.35 * prev + rw[i]; trend.push(prev); }
  const vt = S.varianceRatio(trend, 5);
  assert.ok(vt.vr > 1.2, `VR ${vt.vr} should exceed 1 for trending returns`);
  assert.equal(vt.reading, "Trend-persistent");
});

test("Hurst separates a random walk from a strong trend", () => {
  const rwPx = [100];
  const sh = normals(2000, 33, 0, 0.01);
  for (let i = 0; i < 2000; i++) rwPx.push(rwPx[i] * (1 + sh[i]));
  const h = S.hurst(rwPx);
  assert.ok(h.h > 0.3 && h.h < 0.7, `Hurst ${h.h} should be near 0.5 for a random walk`);

  const trendPx = [100];
  for (let i = 0; i < 2000; i++) trendPx.push(trendPx[i] * (1 + 0.0004 + sh[i] * 0.2));
  assert.ok(S.hurst(trendPx).h > h.h - 0.05, "a drifting series should not look more mean-reverting than noise");
});

test("Jarque-Bera accepts normal draws and rejects a fat-tailed mixture", () => {
  assert.equal(S.jarqueBera(normals(3000, 41)).normal, true);
  const fat = normals(3000, 42).map((v, i) => (i % 50 === 0 ? v * 9 : v));
  const jb = S.jarqueBera(fat);
  assert.equal(jb.normal, false);
  assert.ok(jb.excessKurtosis > 2, `excess kurtosis ${jb.excessKurtosis} should be large`);
});

test("Ljung-Box finds no structure in white noise and finds it in AR(1)", () => {
  assert.equal(S.ljungBox(normals(2000, 51), 10).autocorrelated, false);
  const ar = [];
  let p = 0;
  const sh = normals(2000, 52);
  for (let i = 0; i < 2000; i++) { p = 0.4 * p + sh[i]; ar.push(p); }
  assert.equal(S.ljungBox(ar, 10).autocorrelated, true);
});

/* ══════════════════════════════════════════════════════════════════════════
   RISK MEASURES
   ══════════════════════════════════════════════════════════════════════════ */

test("Gaussian VaR matches μ + zσ and CVaR exceeds VaR", () => {
  const r = normals(6000, 61, 0.0004, 0.012);
  const v = S.valueAtRisk(r, 0.95);
  const expected = Math.abs(S.mean(r) + S.normInv(0.05) * S.stdev(r));
  close(v.gaussian, expected, 1e-9);
  assert.ok(v.cvarHistorical > v.historical, "CVaR must be a larger loss than VaR");
  assert.ok(v.cvarGaussian > v.gaussian);
  // for genuinely normal data the three methods should broadly agree
  assert.ok(Math.abs(v.cornishFisher / v.gaussian - 1) < 0.1);
});

test("historical VaR exceeds Gaussian VaR when the left tail is fat", () => {
  const base = normals(4000, 62, 0, 0.01);
  const fat = base.map((v, i) => (i % 60 === 0 ? -Math.abs(v) * 8 : v));
  const v = S.valueAtRisk(fat, 0.99);
  assert.ok(v.historical > v.gaussian, "the empirical 99% loss should exceed the normal one");
  assert.ok(v.fatTailPremium > 0, "fat-tail premium should be positive");
});

test("drawdowns reconstructs depth, trough and recovery exactly", () => {
  //            0    1    2    3   4    5    6    7
  const eq = [100, 120, 90, 110, 130, 100, 140, 150];
  const d = S.drawdowns(eq);
  close(d.maxDD, 90 / 120 - 1, 1e-12);   // −25% from the peak of 120
  const worst = d.episodes[0];
  assert.equal(worst.peakIdx, 1);
  assert.equal(worst.troughIdx, 2);
  assert.equal(worst.recoveryIdx, 4);    // first bar strictly above 120
  assert.equal(worst.underwater, false);
  close(d.currentDD, 0, 1e-12);          // ends at a new high
});

test("drawdowns marks an unrecovered episode as underwater", () => {
  const d = S.drawdowns([100, 150, 120, 130, 125]);
  const worst = d.episodes[0];
  assert.equal(worst.underwater, true);
  assert.equal(worst.recoveryIdx, null);
  assert.ok(d.currentDD < 0);
});

test("performance computes CAGR, Sharpe and maxDD consistently", () => {
  // 252 bars of exactly +0.1%/day ⇒ deterministic, zero vol, no drawdown
  const r = new Array(252).fill(0.001);
  const p = S.performance(r);
  close(p.totalReturn, Math.pow(1.001, 252) - 1, 1e-12);
  close(p.cagr, Math.pow(1.001, 252) - 1, 1e-9);
  close(p.maxDD, 0, 1e-12);
  close(p.vol, 0, 1e-12);
  assert.equal(p.winRateDaily, 1);
});

test("Sharpe scales by √252 and nets out the risk-free rate", () => {
  const r = normals(2520, 71, 0.0005, 0.01);
  const p = S.performance(r, { rf: 0 });
  close(p.sharpe, (S.mean(r) / S.stdev(r)) * Math.sqrt(252), 1e-9);
  const withRf = S.performance(r, { rf: 0.05 });
  assert.ok(withRf.sharpe < p.sharpe, "a positive risk-free rate must reduce the Sharpe ratio");
});

/* ══════════════════════════════════════════════════════════════════════════
   ALIGNMENT
   ══════════════════════════════════════════════════════════════════════════ */

test("alignByDate keeps only days present in every series", () => {
  const day = (s) => new Date(s + "T00:00:00Z").getTime();
  const a = [{ t: day("2024-01-01"), c: 1 }, { t: day("2024-01-02"), c: 2 }, { t: day("2024-01-03"), c: 3 }];
  const b = [{ t: day("2024-01-02"), c: 20 }, { t: day("2024-01-03"), c: 30 }, { t: day("2024-01-04"), c: 40 }];
  const al = S.alignByDate({ a, b });
  assert.deepEqual(al.dates, ["2024-01-02", "2024-01-03"]);
  assert.deepEqual(al.closes.a, [2, 3]);
  assert.deepEqual(al.closes.b, [20, 30]);
});

test("alignByDate drops null closes rather than aligning around them", () => {
  const day = (s) => new Date(s + "T00:00:00Z").getTime();
  const a = [{ t: day("2024-01-01"), c: 1 }, { t: day("2024-01-02"), c: null }, { t: day("2024-01-03"), c: 3 }];
  const b = [{ t: day("2024-01-01"), c: 10 }, { t: day("2024-01-02"), c: 20 }, { t: day("2024-01-03"), c: 30 }];
  const al = S.alignByDate({ a, b });
  assert.deepEqual(al.dates, ["2024-01-01", "2024-01-03"]);
});

/* ══════════════════════════════════════════════════════════════════════════
   INDICATOR SERIES
   ══════════════════════════════════════════════════════════════════════════ */

test("smaSeries is null until the window fills, then exact", () => {
  const s = Q.smaSeries([1, 2, 3, 4, 5], 3);
  assert.equal(s[0], null);
  assert.equal(s[1], null);
  close(s[2], 2); close(s[3], 3); close(s[4], 4);
});

test("emaSeries seeds on the SMA and applies the standard smoothing constant", () => {
  const v = [1, 2, 3, 4, 5];
  const e = Q.emaSeries(v, 3);
  close(e[2], 2);                     // seed = SMA(1,2,3)
  close(e[3], 4 * 0.5 + 2 * 0.5);     // k = 2/(3+1) = 0.5
  close(e[4], 5 * 0.5 + 3 * 0.5);
});

test("rsiSeries pins at 100 on an unbroken advance and 0 on an unbroken decline", () => {
  const up = Array.from({ length: 40 }, (_, i) => 100 + i);
  close(Q.rsiSeries(up, 14).at(-1), 100, 1e-9);
  const down = Array.from({ length: 40 }, (_, i) => 100 - i);
  close(Q.rsiSeries(down, 14).at(-1), 0, 1e-9);
});

test("rsiSeries final value agrees with the technicals.js implementation", () => {
  const T = require("./technicals");
  const px = normals(300, 81, 0, 1).reduce((acc, v) => { acc.push(acc.at(-1) * (1 + v * 0.01)); return acc; }, [100]);
  close(Q.rsiSeries(px, 14).at(-1), T.rsi(px, 14), 1e-9, "series and scalar RSI must agree");
});

test("atrSeries and adxSeries agree with technicals.js at the final bar", () => {
  const T = require("./technicals");
  const n = 400, sh = normals(n, 82, 0, 1);
  const c = [100], h = [], l = [];
  for (let i = 0; i < n; i++) c.push(c[i] * (1 + sh[i] * 0.012));
  c.forEach((v, i) => { h.push(v * (1 + Math.abs(sh[i % n]) * 0.004)); l.push(v * (1 - Math.abs(sh[i % n]) * 0.004)); });
  close(Q.atrSeries(h, l, c, 14).at(-1), T.atr(h, l, c, 14), 1e-9);
  close(Q.adxSeries(h, l, c, 14).at(-1), T.adx(h, l, c, 14), 1e-9);
});

test("donchianSeries excludes the current bar from its own channel", () => {
  const h = [1, 2, 3, 10, 4];
  const l = [1, 2, 3, 1, 4];
  const d = Q.donchianSeries(h, l, 3);
  assert.equal(d.hi[2], null, "not enough prior bars");
  close(d.hi[3], 3);   // max of bars 0..2, excluding bar 3 itself
  close(d.hi[4], 10);  // max of bars 1..3
});

/* ══════════════════════════════════════════════════════════════════════════
   BACKTEST ENGINE
   ══════════════════════════════════════════════════════════════════════════ */

/** Synthetic OHLCV series from a close path. */
function candles(closes, startMs = Date.UTC(2015, 0, 2)) {
  return closes.map((c, i) => ({
    t: startMs + i * 86400000,
    o: c * 0.999, h: c * 1.004, l: c * 0.996, c, v: 1e6,
  }));
}
function geomPath(n, seed, drift = 0.0004, vol = 0.012, p0 = 100) {
  const sh = normals(n, seed);
  const out = [p0];
  for (let i = 0; i < n; i++) out.push(out[i] * (1 + drift + vol * sh[i]));
  return out;
}

test("simulate executes on the NEXT bar — no look-ahead is possible", () => {
  // Price jumps +50% on bar 2. A signal raised at bar 1 earns it; a signal
  // raised at bar 2 (the same bar as the jump) must not.
  const ctx = Q.buildCtx(candles([100, 100, 150, 150, 150]));
  const early = Q.simulate(ctx, [0, 1, 1, 1, 1], { costBps: 0 });
  const late = Q.simulate(ctx, [0, 0, 1, 1, 1], { costBps: 0 });
  close(early.returns[1], 0.5, 1e-9, "position held into the jump captures it");
  close(late.returns[1], 0, 1e-9, "position taken on the jump bar must not capture it");
});

test("simulate charges costs on both legs of a round trip", () => {
  const ctx = Q.buildCtx(candles([100, 100, 100, 100, 100]));
  const flat = Q.simulate(ctx, [0, 1, 1, 0, 0], { costBps: 50 }); // 0.5% per side
  const total = flat.returns.reduce((a, b) => a + b, 0);
  close(total, -0.01, 1e-9, "one entry + one exit at 50bp = 100bp of drag");
  close(flat.turnover, 2, 1e-9);
});

test("a permanently-long position reproduces buy-and-hold exactly", () => {
  const px = geomPath(500, 91);
  const ctx = Q.buildCtx(candles(px));
  const sim = Q.simulate(ctx, new Array(px.length).fill(1), { costBps: 0 });
  const perf = S.performance(sim.returns);
  const bh = S.performance(S.simpleReturns(px));
  close(perf.totalReturn, bh.totalReturn, 1e-9);
  close(sim.exposure, 1, 1e-9);
});

test("a permanently-flat position produces exactly zero return", () => {
  const ctx = Q.buildCtx(candles(geomPath(300, 92)));
  const sim = Q.simulate(ctx, new Array(301).fill(0), { costBps: 25 });
  close(sim.returns.reduce((a, b) => a + b, 0), 0, 1e-12);
  assert.equal(sim.trades.length, 0);
  close(sim.exposure, 0, 1e-12);
});

test("trade bookkeeping records entries, exits and returns correctly", () => {
  const ctx = Q.buildCtx(candles([100, 100, 110, 121, 121, 121]));
  //  pos:      0    1    1    0    0    0   → held from the next bar
  const sim = Q.simulate(ctx, [0, 1, 1, 0, 0, 0], { costBps: 0 });
  assert.equal(sim.trades.length, 1);
  const t = sim.trades[0];
  assert.equal(t.side, 1);
  close(t.entryPrice, 100);   // signal at bar 1 ⇒ established at bar 1's close
  close(t.exitPrice, 121);    // signal off at bar 3 ⇒ liquidated at bar 3's close
  close(t.grossReturn, 0.21, 1e-9);
  assert.equal(t.bars, 2);
  // the ledger must reconcile with the compounded return stream
  const compounded = sim.returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
  close(compounded, t.grossReturn, 1e-9, "trade ledger and equity curve must agree");
});

test("tradeStats computes win rate, profit factor and expectancy", () => {
  const trades = [
    { netReturn: 0.10, bars: 5, mfe: 0.12, mae: -0.01 },
    { netReturn: 0.20, bars: 8, mfe: 0.22, mae: -0.02 },
    { netReturn: -0.05, bars: 3, mfe: 0.01, mae: -0.06 },
    { netReturn: -0.05, bars: 4, mfe: 0.00, mae: -0.07 },
  ];
  const t = Q.tradeStats(trades);
  assert.equal(t.n, 4);
  close(t.winRate, 0.5);
  close(t.profitFactor, 0.3 / 0.1, 1e-9);
  close(t.expectancy, 0.05, 1e-9);
  close(t.avgWin, 0.15, 1e-9);
  close(t.avgLoss, -0.05, 1e-9);
  close(t.payoff, 3, 1e-9);
  assert.equal(t.maxConsecLosses, 2);
  assert.equal(t.maxConsecWins, 2);
});

test("every catalogued strategy runs and returns a coherent report", () => {
  const pts = candles(geomPath(1400, 93));
  for (const spec of Q.strategyCatalogue()) {
    const r = Q.backtest(pts, { strategy: spec.id, surface: false, walkForward: false, mc: false });
    assert.ok(!r.error, `${spec.id}: ${r.error}`);
    assert.ok(r.performance.exposure >= 0 && r.performance.exposure <= 1, `${spec.id}: exposure out of range`);
    assert.ok(r.performance.maxDD <= 0, `${spec.id}: maxDD must be ≤ 0`);
    assert.ok(r.trades.n >= 0);
    assert.ok(r.curve.length > 10, `${spec.id}: curve too short`);
    assert.ok(spec.params.every((p) => r.meta.params[p.key] >= p.min && r.meta.params[p.key] <= p.max),
      `${spec.id}: params escaped their declared bounds`);
  }
});

test("resolveParams clamps out-of-range input and falls back on garbage", () => {
  const p = Q.resolveParams("sma_cross", { fast: 999, slow: "not a number" });
  assert.equal(p.fast, 60);   // clamped to max
  assert.equal(p.slow, 100);  // default
  assert.equal(Q.resolveParams("nope", {}), null);
});

test("backtest refuses a series that is too short to say anything", () => {
  const r = Q.backtest(candles(geomPath(50, 94)));
  assert.ok(r.error, "short series must produce an explicit error, not a fake result");
});

test("higher costs can only reduce returns", () => {
  const pts = candles(geomPath(1200, 95));
  const cheap = Q.backtest(pts, { strategy: "macd_trend", costBps: 0, surface: false, walkForward: false, mc: false });
  const dear = Q.backtest(pts, { strategy: "macd_trend", costBps: 100, surface: false, walkForward: false, mc: false });
  assert.ok(dear.performance.totalReturn < cheap.performance.totalReturn,
    "a 100bp cost must drag on a strategy that trades");
  assert.ok(dear.performance.costDrag > cheap.performance.costDrag);
});

test("parameter surface covers the grid and reports a plateau ratio", () => {
  const ctx = Q.buildCtx(candles(geomPath(1000, 96)));
  const s = Q.parameterSurface(ctx, "sma_cross", Q.resolveParams("sma_cross", {}), { costBps: 10 });
  assert.ok(s.xs.length > 2 && s.ys.length > 2);
  assert.equal(s.sharpe.length, s.ys.length);
  assert.equal(s.sharpe[0].length, s.xs.length);
  assert.ok(s.plateauRatio == null || (s.plateauRatio >= 0 && s.plateauRatio <= 1));
});

test("walk-forward grades each fold on data the optimiser never saw", () => {
  const ctx = Q.buildCtx(candles(geomPath(1600, 97)));
  const w = Q.walkForward(ctx, "sma_cross", Q.resolveParams("sma_cross", {}), { costBps: 10, folds: 4 });
  assert.ok(w && w.folds.length >= 2);
  for (const f of w.folds) {
    assert.ok(f.isTo < f.oosFrom, `fold ${f.fold}: out-of-sample window must start after the in-sample one ends`);
    assert.ok(f.bars > 0);
  }
});

test("bootstrap is deterministic for a fixed seed and brackets the median", () => {
  const r = normals(800, 98, 0.0005, 0.01);
  const a = Q.bootstrap(r, { runs: 200, seed: 123 });
  const b = Q.bootstrap(r, { runs: 200, seed: 123 });
  assert.deepEqual(a.cagr, b.cagr, "same seed must give identical results");
  assert.ok(a.cagr.p5 <= a.cagr.median && a.cagr.median <= a.cagr.p95, "percentiles must be ordered");
  assert.ok(a.maxDD.worst <= a.maxDD.median);
  assert.ok(a.probProfit >= 0 && a.probProfit <= 1);
  const c = Q.bootstrap(r, { runs: 200, seed: 999 });
  assert.notDeepEqual(a.cagr, c.cagr, "a different seed should give a different draw");
});

/* ══════════════════════════════════════════════════════════════════════════
   FACTOR ATTRIBUTION
   ══════════════════════════════════════════════════════════════════════════ */

test("factorAttribution recovers known betas and a known alpha", () => {
  const n = 1500;
  const mkt = normals(n, 101, 0.0003, 0.01);
  const smb = normals(n, 102, 0.0001, 0.006);
  const noise = normals(n, 103, 0, 0.004);
  const trueAlpha = 0.0002;   // ≈5% a year
  const asset = mkt.map((m, i) => trueAlpha + 1.3 * m + (-0.4) * smb[i] + noise[i]);

  const a = Q.factorAttribution(asset, { Market: mkt, Size: smb }, { rf: 0, marketKey: "Market" });
  assert.ok(Math.abs(a.loadings[0].beta - 1.3) < 0.05, `market β ${a.loadings[0].beta} should be ≈1.3`);
  assert.ok(Math.abs(a.loadings[1].beta - -0.4) < 0.08, `size β ${a.loadings[1].beta} should be ≈−0.4`);
  assert.ok(Math.abs(a.alpha.daily - trueAlpha) < 0.0002, `alpha ${a.alpha.daily} should be ≈${trueAlpha}`);
  close(a.alpha.annualised, a.alpha.daily * 252, 1e-12);
  assert.ok(a.fit.r2 > 0.85, `R² ${a.fit.r2} should be high for a well-specified model`);
  assert.ok(a.fit.systematicShare > 0.8);
});

test("factorAttribution reports no alpha when there genuinely is none", () => {
  const n = 1500;
  const mkt = normals(n, 111, 0.0003, 0.01);
  const asset = mkt.map((m, i) => 0.9 * m + normals(n, 112)[i] * 0.003);
  const a = Q.factorAttribution(asset, { Market: mkt }, { rf: 0, marketKey: "Market" });
  assert.equal(a.alpha.significant, false, `spurious alpha detected (p = ${a.alpha.pHAC})`);
});

test("VIF flags collinear factors and stays near 1 for orthogonal ones", () => {
  const n = 1200;
  const f1 = normals(n, 121, 0, 0.01);
  const f2 = normals(n, 122, 0, 0.01);
  // Nearly — but not exactly — a copy of f1. An exact linear combination would
  // make X'X singular, which the regression correctly refuses to invert.
  const jitter = normals(n, 124, 0, 0.0008);
  const dup = f1.map((v, i) => v * 0.95 + f2[i] * 0.05 + jitter[i]);
  const asset = f1.map((v, i) => v + f2[i] * 0.5 + normals(n, 123)[i] * 0.002);

  const clean = Q.factorAttribution(asset, { A: f1, B: f2 }, { rf: 0, marketKey: "A" });
  assert.ok(clean.fit.maxVif < 1.5, `orthogonal factors should have VIF ≈1, got ${clean.fit.maxVif}`);

  const messy = Q.factorAttribution(asset, { A: f1, B: f2, C: dup }, { rf: 0, marketKey: "A" });
  assert.ok(messy.fit.maxVif > 5, `near-duplicate factor should trip the VIF threshold, got ${messy.fit.maxVif}`);
  assert.ok(messy.loadings.some((l) => l.collinear), "at least one loading must be flagged collinear");
});

test("capture ratios and downside beta separate asymmetric exposure", () => {
  const n = 1500;
  const mkt = normals(n, 131, 0, 0.012);
  // 1.4× on the way up, 0.6× on the way down — a genuinely convex payoff
  const asset = mkt.map((m) => (m > 0 ? 1.4 * m : 0.6 * m));
  const a = Q.factorAttribution(asset, { Market: mkt }, { rf: 0, marketKey: "Market" });
  assert.ok(a.capture.upCapture > 1.2, `up capture ${a.capture.upCapture} should exceed 1`);
  assert.ok(a.capture.downCapture < 0.8, `down capture ${a.capture.downCapture} should be below 1`);
  assert.ok(a.capture.downBeta < a.capture.upBeta, "downside beta must be the lower of the two");
});

/* ══════════════════════════════════════════════════════════════════════════
   PAIRS
   ══════════════════════════════════════════════════════════════════════════ */

function pairDates(n) {
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(2015, 0, 2) + i * 86400000).toISOString().slice(0, 10));
}

test("pairsAnalysis detects a genuinely cointegrated pair", () => {
  // B is a random walk; A tracks it with a stationary AR(1) deviation.
  const n = 1200;
  const shB = normals(n, 141, 0, 0.012);
  const shE = normals(n, 142, 0, 0.02);
  const b = [100];
  for (let i = 0; i < n; i++) b.push(b[i] * (1 + shB[i]));
  let e = 0;
  const a = b.map((v, i) => { e = 0.93 * e + shE[i % n]; return v * Math.exp(e * 0.05); });

  const r = Q.pairsAnalysis({ dates: pairDates(n + 1), a, b, symA: "A", symB: "B" }, {});
  assert.ok(!r.error, r.error);
  assert.equal(r.cointegration.cointegrated, true, `EG stat ${r.cointegration.stat} vs 5% ${r.cointegration.crit[5]}`);
  assert.ok(r.meanReversion.halfLifeDays > 0 && r.meanReversion.halfLifeDays < 60,
    `half-life ${r.meanReversion.halfLifeDays} should be short for an AR(0.93) deviation`);
  assert.ok(Math.abs(r.hedge.beta - 1) < 0.25, `hedge ratio ${r.hedge.beta} should be ≈1`);
});

test("pairsAnalysis rejects two independent random walks", () => {
  const n = 1200;
  const mk = (seed) => {
    const sh = normals(n, seed, 0, 0.012);
    const p = [100];
    for (let i = 0; i < n; i++) p.push(p[i] * (1 + sh[i]));
    return p;
  };
  const r = Q.pairsAnalysis({ dates: pairDates(n + 1), a: mk(151), b: mk(152), symA: "A", symB: "B" }, {});
  assert.equal(r.cointegration.cointegrated, false,
    `independent random walks were called cointegrated (stat ${r.cointegration.stat})`);
  assert.equal(r.tradeable, false);
});

test("pairsAnalysis uses Engle-Granger criticals, not Dickey-Fuller ones", () => {
  const n = 900;
  const sh = normals(n, 161, 0, 0.012);
  const b = [100];
  for (let i = 0; i < n; i++) b.push(b[i] * (1 + sh[i]));
  const a = b.map((v, i) => v * (1 + normals(n, 162, 0, 0.02)[i % n]));
  const r = Q.pairsAnalysis({ dates: pairDates(n + 1), a, b, symA: "A", symB: "B" }, {});
  const df = S.criticalValues("df_c", r.cointegration.nobs);
  assert.ok(r.cointegration.crit[5] < df[5],
    "the pairs desk must apply the stricter EG critical value to a fitted residual");
});

test("pairsAnalysis honours the z-score bands it is given", () => {
  const n = 900;
  const sh = normals(n, 171, 0, 0.012);
  const b = [100];
  for (let i = 0; i < n; i++) b.push(b[i] * (1 + sh[i]));
  let e = 0;
  const a = b.map((v, i) => { e = 0.9 * e + normals(n, 172, 0, 0.02)[i % n]; return v * Math.exp(e * 0.05); });
  const wide = Q.pairsAnalysis({ dates: pairDates(n + 1), a, b, symA: "A", symB: "B" }, { entryZ: 3 });
  const tight = Q.pairsAnalysis({ dates: pairDates(n + 1), a, b, symA: "A", symB: "B" }, { entryZ: 1 });
  assert.ok(tight.strategy.trades.n >= wide.strategy.trades.n,
    "a tighter entry band cannot produce fewer trades");
  assert.equal(wide.meta.entryZ, 3);
});

test("pairsAnalysis refuses mismatched or too-short inputs", () => {
  assert.ok(Q.pairsAnalysis({ dates: [], a: [1, 2], b: [1, 2], symA: "A", symB: "B" }, {}).error);
  const long = new Array(200).fill(100);
  assert.ok(Q.pairsAnalysis({ dates: pairDates(200), a: long, b: [1, 2, 3], symA: "A", symB: "B" }, {}).error);
});

/* ══════════════════════════════════════════════════════════════════════════
   RETURN PROFILE
   ══════════════════════════════════════════════════════════════════════════ */

test("returnProfile produces a complete, internally consistent report", () => {
  const pts = candles(geomPath(1500, 181));
  const p = Q.returnProfile(pts);
  assert.ok(!p.error, p.error);

  assert.equal(p.meta.bars, 1501);
  assert.ok(p.performance.vol > 0);
  assert.ok(p.performance.maxDD <= 0);
  assert.ok(p.tailRisk.var95.historical > 0, "VaR is reported as a positive loss magnitude");
  assert.ok(p.tailRisk.var99.historical >= p.tailRisk.var95.historical, "99% VaR ≥ 95% VaR");
  assert.ok(p.tailRisk.var95.cvarHistorical >= p.tailRisk.var95.historical, "CVaR ≥ VaR");

  assert.equal(p.distribution.histogram.length, 41);
  assert.ok(p.distribution.p1 < p.distribution.p5, "quantiles must be ordered");
  assert.ok(p.distribution.p95 < p.distribution.p99);

  assert.ok(p.seasonality.matrix.length > 3, "several calendar years should be covered");
  p.seasonality.matrix.forEach((row) => assert.equal(row.months.length, 12));
  assert.equal(p.seasonality.months.length, 12);
  assert.equal(p.seasonality.dayOfWeek.length, 5);

  assert.ok(p.volatility.percentile >= 0 && p.volatility.percentile <= 1);
  assert.ok(p.volatility.ewmaForecast > 0);
  assert.ok(p.efficiency.varianceRatios.length === 4);
  assert.ok(p.rolling.length > 5);
  assert.ok(p.microstructure, "synthetic candles carry opens, so the gap split must be computed");
});

test("returnProfile monthly matrix compounds to the yearly figure", () => {
  const p = Q.returnProfile(candles(geomPath(1500, 182)));
  for (const row of p.seasonality.matrix) {
    const months = row.months.filter((m) => m != null);
    if (months.length < 12) continue;                     // partial years are expected
    const comp = months.reduce((acc, m) => acc * (1 + m), 1) - 1;
    close(row.total, comp, 1e-9, `year ${row.year}`);
  }
});

test("returnProfile refuses a series that is too short", () => {
  assert.ok(Q.returnProfile(candles(geomPath(100, 183))).error);
});

test("returnProfile drawdown episodes are ordered by depth and carry dates", () => {
  const p = Q.returnProfile(candles(geomPath(2000, 184)));
  for (let i = 1; i < p.drawdowns.length; i++) {
    assert.ok(p.drawdowns[i].depth >= p.drawdowns[i - 1].depth, "episodes must be sorted deepest-first");
  }
  for (const e of p.drawdowns) {
    assert.match(e.peak, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(e.trough, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.peak <= e.trough, "the peak must precede the trough");
    if (e.recovery) assert.ok(e.trough <= e.recovery, "recovery must follow the trough");
  }
});
