/**
 * Runs the Index Analyser's walk-forward reliability backtest off the main thread
 * (it takes a few seconds; on the main thread it would stall every request).
 * Usage: runEvaluate(b5, { days, h }) → Promise<evaluate() result>
 */
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

if (!isMainThread && parentPort) {
  const Q = require("./indexquant");
  try { parentPort.postMessage({ ok: true, result: Q.evaluate(workerData.b5, workerData.opts) }); }
  catch (e) { parentPort.postMessage({ ok: false, error: String((e && e.message) || e) }); }
}

function runEvaluate(b5, opts = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { b5, opts } });
    const timer = setTimeout(() => { w.terminate(); reject(new Error("evaluation timed out")); }, 60_000);
    w.once("message", (m) => { clearTimeout(timer); w.terminate(); m.ok ? resolve(m.result) : reject(new Error(m.error)); });
    w.once("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

module.exports = { runEvaluate };
