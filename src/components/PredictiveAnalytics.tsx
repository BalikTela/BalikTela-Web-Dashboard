import { useEffect, useState } from 'react';
import { AlertCircle, Download, LoaderCircle, RotateCcw } from 'lucide-react';
import { FORECAST_METHOD_LABELS, type PredictiveReport } from '../../shared/predictive';
import { formatMass } from '../../shared/metrics';
import { useAuth } from '../context/AuthContext';
import { platformApi } from '../services/platformApi';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { ForecastPlot, RateSparkline } from './PredictiveCharts';
import '../styles/predictive.css';
import { createSessionCache } from '../lib/sessionCache';

type View = 'Collection forecast' | 'Declared waste' | 'Recycler tendencies';
const views: View[] = ['Collection forecast', 'Declared waste', 'Recycler tendencies'];
const number = (value: number) => value.toLocaleString('en-PH');
const date = (value: string) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const endDate = (value: string) => date(new Date(Date.parse(value) - 86400000).toISOString());
const reportCache = createSessionCache<string, { report: PredictiveReport; expiresAt: number }>();

export function PredictiveAnalytics() {
  const { user, access } = useAuth();
  const [region, setRegion] = useState('All regions');
  const [materialCategory, setMaterialCategory] = useState('All materials');
  const [historyWeeks, setHistoryWeeks] = useState('26');
  const [view, setView] = useState<View>('Collection forecast');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; report?: PredictiveReport; error?: string }>({ key: '' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const query = { region, materialCategory, historyWeeks };
  const key = JSON.stringify([user?.id, user?.role, user?.scope, query]);
  const permitted = Boolean(access?.permissions.includes('analytics.predictive.read'));
  const current = state.key === key ? state : undefined;
  const report = current?.report;

  useEffect(() => {
    if (!permitted) return;
    const cached = reportCache.get(key);
    if (cached && cached.expiresAt > Date.now()) { setState({ key, report: cached.report }); return; }
    const controller = new AbortController();
    setState({ key });
    void platformApi.predictiveAnalytics({ region, materialCategory, historyWeeks }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      reportCache.set(key, { report: result, expiresAt: Date.now() + 300_000 });
      while (reportCache.size > 24) reportCache.delete(reportCache.keys().next().value!);
      setState({ key, report: result });
    }).catch(error => { if (!controller.signal.aborted) setState({ key, error: error.message ?? 'Unable to load the model run.' }); });
    return () => controller.abort();
  }, [key, region, materialCategory, historyWeeks, attempt, permitted]);

  const regions = report?.regions ?? (user?.role !== 'Administrator' && user?.scope.regions.length ? user.scope.regions : ['Metro Manila', 'Central Visayas', 'Western Visayas', 'Davao Region']);
  const materials = report?.materials ?? ['Cotton', 'Polyester', 'Denim', 'Mixed fabric', 'Uniforms', 'Household linen'];
  const clear = () => { setRegion('All regions'); setMaterialCategory('All materials'); };
  const download = async () => {
    setExportError(''); setExporting(true);
    try { await platformApi.exportPredictiveDataset(query); }
    catch (error) { setExportError(error instanceof Error ? error.message : 'Dataset export failed.'); }
    finally { setExporting(false); }
  };

  if (!permitted) return <div className="predictive-notice">Predictive analytics is available to authorized administrators, researchers, and government users only.</div>;

  return <div className="predictive section-enter">
    <header className="predictive-heading">
      <div><h3>Forward view</h3><p>Four-week projections from a fixed training snapshot.</p></div>
      {access?.permissions.includes('reports.export') ? <Button variant="outline" onClick={download} disabled={exporting || !report} className="gap-2">{exporting ? <LoaderCircle className="animate-spin" size={15} /> : <Download size={15} />}Dataset CSV</Button> : null}
    </header>
    <div className="predictive-filters">
      <label>Forecast region<Select aria-label="Forecast region" value={region} onChange={event => setRegion(event.target.value)}><option>All regions</option>{regions.map(item => <option key={item}>{item}</option>)}</Select></label>
      <label>Material category<Select aria-label="Forecast material category" value={materialCategory} onChange={event => setMaterialCategory(event.target.value)}><option>All materials</option>{materials.map(item => <option key={item}>{item}</option>)}</Select></label>
      <label>Historical view<Select aria-label="Forecast historical view" value={historyWeeks} onChange={event => setHistoryWeeks(event.target.value)}>{[13, 26, 52, 120].map(item => <option key={item} value={item}>Last {item} weeks</option>)}</Select></label>
      <Button variant="ghost" size="icon" onClick={clear} title="Clear forecast filters" aria-label="Clear forecast filters"><RotateCcw size={16} /></Button>
    </div>
    {exportError ? <p className="predictive-error" role="alert">{exportError}</p> : null}
    {current?.error ? <div className="predictive-status" role="alert"><AlertCircle size={20} /><p>{current.error}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry forecast</Button></div>
      : !report ? <div className="predictive-status" role="status"><LoaderCircle className="animate-spin" size={20} />Evaluating historical records...</div>
        : <>
          <div className="predictive-provenance"><span><strong>{number(report.scope.records)}</strong> scoped records / {report.scope.activeWeeks} active weeks</span><span>Observed through <strong>{endDate(report.manifest.cutoffExclusive)}</strong></span><span>Snapshot <code>{report.manifest.sha256.slice(0, 10)}</code></span></div>
          {report.status !== 'ready' ? <div className="predictive-status"><AlertCircle size={22} /><h4>More supporting history is required</h4><p>{report.message}</p><Button variant="outline" onClick={clear}>Use broader scope</Button></div> : <>
            <div className="predictive-views" role="tablist" aria-label="Prediction target">{views.map((item, index) => <button key={item} type="button" role="tab" tabIndex={view === item ? 0 : -1} aria-selected={view === item} aria-controls="predictive-output" id={`predictive-tab-${item.split(' ')[0]}`} onClick={() => setView(item)} onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % views.length : event.key === 'ArrowLeft' ? (index + views.length - 1) % views.length : event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : null;
              if (next === null) return;
              event.preventDefault(); setView(views[next]); document.getElementById(`predictive-tab-${views[next].split(' ')[0]}`)?.focus();
            }}>{item}</button>)}</div>
            <section id="predictive-output" role="tabpanel" aria-labelledby={`predictive-tab-${view.split(' ')[0]}`}>
              {view === 'Recycler tendencies' ? <MaterialChoices report={report} /> : <VolumeForecast report={report} target={view === 'Collection forecast' ? 'collected' : 'declared'} />}
            </section>
          </>}
          <details className="predictive-methodology"><summary>Dataset, evaluation & limitations</summary><div className="predictive-method-body"><h4>9,600 synthetic records. 120 weekly observations.</h4><p>Chronological 70 / 15 / 15 split. Full bundled dataset; scoped models use the same date boundaries.</p><div className="predictive-splits">{report.manifest.partitions.map(part => <div key={part.name}><span>{part.name}</span><strong>{number(part.records)} <small>records / {part.weeks} weeks</small></strong><p>{date(part.start)} - {endDate(part.endExclusive)}</p></div>)}</div><p>Four statistical baselines compete on validation MAE. The selected method is frozen before rolling-origin testing; each forecast uses earlier observations only. Test blocks contain 15 origins and 60 overlapping horizon predictions per volume target.</p><p>Nominal 80% weekly ranges use validation-error quantiles. Actual held-out coverage is shown, not assumed. No uncertainty range is claimed for the four-week sum.</p><ul>{report.limitations.map(item => <li key={item}>{item}</li>)}</ul><p>Version <code>{report.manifest.version}</code> / Seed {report.manifest.seed}. Bundled CSV exports follow the selected region, material, and assigned access scope; the historical view changes the chart only.</p></div></details>
        </>}
  </div>;
}

function VolumeForecast({ report, target }: { report: PredictiveReport; target: 'collected' | 'declared' }) {
  const model = report.models![target];
  const collected = target === 'collected';
  const rows = report.forecast.map(week => ({ week: week.weekStart, value: collected ? week.collectedKg : week.declaredKg, lower: collected ? week.collectedLowerKg : week.declaredLowerKg, upper: collected ? week.collectedUpperKg : week.declaredUpperKg }));
  return <div className="predictive-volume">
    <div className="predictive-summary">
      <div className="predictive-primary"><p>{collected ? 'Projected collection' : 'Projected declared textile waste'}</p><strong>{formatMass(report.totals[collected ? 'collectedKg' : 'declaredKg'])}</strong><span>Four weeks from {date(report.forecast[0].weekStart)}</span></div>
      <div><p>Test MAE</p><strong>{formatMass(model.test.maeKg)}</strong><span>Mean absolute error / week</span></div>
      <div><p>Test WAPE</p><strong>{model.test.wapePercent === null ? 'Not available' : `${model.test.wapePercent}%`}</strong><span>Absolute error / observed mass</span></div>
      <div><p>Test range coverage</p><strong>{model.test.intervalCoveragePercent}%</strong><span>Nominal 80% empirical range</span></div>
    </div>
    <div className="predictive-chart-heading"><div><h4>{collected ? 'Weekly textile collection' : 'Weekly declared textile waste'}</h4><p>{FORECAST_METHOD_LABELS[model.method]} / Selected on validation, refit through 11 Oct 2026</p></div><div className="predictive-legend"><span><i />Historical</span><span><i className="forecast" />Forecast</span><span><i className="range" />80% range</span></div></div>
    <div className="predictive-chart"><ForecastPlot report={report} target={target} /></div>
    <div className="predictive-table-wrap"><table className="predictive-table" aria-label={`${collected ? 'Collection' : 'Declared waste'} weekly projections`}><thead><tr><th>Week starting</th><th>Forecast</th><th>Range lower</th><th>Range upper</th></tr></thead><tbody>{rows.map(row => <tr key={row.week}><th scope="row">{date(row.week)}</th><td>{formatMass(row.value)}</td><td>{formatMass(row.lower)}</td><td>{formatMass(row.upper)}</td></tr>)}</tbody></table></div>
    <p className="predictive-footnote">{collected ? 'Collection is a portion of declared mass, not proof of completed recycling or landfill diversion.' : 'Projected material declared to the simulated platform, not total Philippine waste generation.'} Validation MAE: {formatMass(model.validation.maeKg)}. Held-out test: {model.test.predictions} overlapping predictions. Displayed mass is rounded to 0.001 t; totals are calculated before display rounding.</p>
  </div>;
}

function MaterialChoices({ report }: { report: PredictiveReport }) {
  const preferences = report.preferences!;
  const top = preferences.ranked[0];
  return <div>
    <div className="predictive-summary predictive-selection-summary"><div className="predictive-primary"><p>Highest selection likelihood</p><strong className="predictive-material-name">{top.materialCategory}</strong><span>{(top.selectionProbability * 100).toFixed(1)}% per simulated offer</span></div><div><p>Test Brier score</p><strong>{preferences.testBrierScore.toFixed(4)}</strong><span>Lower is better; 0 is perfect</span></div><div><p>Pooled baseline Brier</p><strong>{preferences.baselineBrierScore.toFixed(4)}</strong><span>Category-blind comparison</span></div><div><p>Held-out offers</p><strong>{number(preferences.testOffers)}</strong><span>Final 18 weeks / log loss {preferences.testLogLoss.toFixed(4)}</span></div></div>
    <div className="predictive-chart-heading"><div><h4>Materials a simulated recycler is more likely to select</h4><p>Category-conditioned offer response / Last {preferences.windowWeeks} weeks, selected by validation log loss</p></div></div>
    <div className="predictive-table-wrap"><table className="predictive-table predictive-choices" aria-label="Recycler material tendencies"><thead><tr><th>Material</th><th>Selected / offered</th><th>Selection likelihood</th><th>Change vs prior {preferences.windowWeeks} weeks</th><th>Observed selected share</th><th>12-week trend</th></tr></thead><tbody>{preferences.ranked.map(item => <tr key={item.materialCategory}><th scope="row">{item.materialCategory}</th><td>{number(item.selected)} / {number(item.offers)}</td><td><div className="predictive-probability"><span>{(item.selectionProbability * 100).toFixed(1)}%</span><progress value={item.selectionProbability} max="1" aria-label={`${item.materialCategory} selection likelihood`} /></div></td><td>{item.changePoints === null ? 'Not available' : `${item.changePoints > 0 ? '+' : ''}${item.changePoints.toFixed(1)} pp`}</td><td>{item.observedSelectedSharePercent.toFixed(1)}%</td><td><RateSparkline values={item.weeklyRates} /></td></tr>)}</tbody></table></div>
    <p className="predictive-footnote">Selection likelihood = (selected offers + 1) / (offers + 2), using Beta(1,1) smoothing. Independent likelihoods do not sum to 100%. Observed selected share = category selections / all selections in the recent window. Trend lines show observed weekly selection rates. No individual recycler or real-world preference is inferred.</p>
  </div>;
}
