import {useLocation, useParams} from 'react-router-dom';
import {EvidenceHeader, EvidencePending, EvidenceSection, readSelection, useEvidencePage, useLinkedEvidence} from './EvidencePages';
import {useEffect, useRef, useState} from 'react';
import {useExploreMotion} from './ExploreMotion';
import {Findings} from './Findings';
import {LocationSearch} from './LocationSearch';
import {StudyMap} from './Map';
import {number, request, type Evidence, type Scan, type Settings, type Study} from './api';
import {DistrictFields, LensIntro, SetupStage} from './InvestigationUI';
import {ForestEvidence} from './ForestEvidence';
import './explore.css';

const initialPair = ['PK702', 'PK714'];
const defaultSettings: Settings = {start: 2003, end: 2024, quality: 'standard'};
const years = Array.from({length: 22}, (_, i) => 2003 + i);

export function Workspace() {
  const {search} = useLocation();
  const {evidencePage} = useParams();
  const page = useEvidencePage();
  const initial = readSelection(search);
  const [study, setStudy] = useState<Study>();
  const [settings, setSettings] = useState<Settings>(initial ? {start: initial.start, end: initial.end, quality: initial.option === 'strict' ? 'strict' : 'standard'} : defaultSettings);
  const [pair, setPair] = useState(initial?.pair ?? initialPair);
  const [mapSlot, setMapSlot] = useState(0);
  const [scan, setScan] = useState<Scan>();
  const [report, setReport] = useState<Evidence>();
  const [busy, setBusy] = useState('Loading study…');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const results = useRef<HTMLElement>(null);
  const suggestions = useRef<HTMLElement>(null);
  const focusNewComparison = useRef(false);

  useEffect(() => {
    let active = true;
    request<Study>('/study').then(data => {
      if (active) setStudy(data);
    }).catch((err: Error) => {
      if (active) setError(err.message);
    }).finally(() => {
      if (active) setBusy('');
    });
    return () => { active = false; };
  }, []);

  const manifest = study?.manifest;
  const available = manifest?.mode === 'source extract';
  const motion = useExploreMotion(report, busy);
  const name = (id: string) => study?.regions.features.find(region => region.id === id)?.properties.name ?? id;
  const candidates = scan?.candidates.filter(candidate => filter !== 'opposite' || candidate.opposite) ?? [];
  if (filter === 'gap') candidates.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  function changeSettings(next: Settings) {
    setSettings(next);
    setScan(undefined);
    setReport(undefined);
    setError('');
  }

  function select(next: string[]) {
    setPair(next);
    setReport(undefined);
    setError('');
  }

  function selectOnMap(id: string) {
    if (busy || pair[mapSlot] === id) return;
    select(pair.includes(id) ? [pair[1], pair[0]] : pair.map((item, i) => i === mapSlot ? id : item));
    setMapSlot(1 - mapSlot);
  }

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label);
    setError('');
    try { await task(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(''); }
  }

  useEffect(() => {
    if (scan) suggestions.current?.focus();
  }, [scan]);

  useEffect(() => {
    if (report && focusNewComparison.current) {
      results.current?.focus();
      focusNewComparison.current = false;
    }
  }, [report]);

  async function compare(next: string[]) {
    select(next);
    await run('Comparing district trends…', async () => {
      const evidence = await request<Evidence>('/compare', {...settings, pair: next});
      focusNewComparison.current = true;
      setReport(evidence);
    });
  }

  const [restoring, setRestoring] = useState(false);
  useLinkedEvidence(report, value => ({...value.request, option: value.request.quality}), (selection, cancelled) => {
    setRestoring(true);
    setError('');
    setReport(undefined);
    request<Evidence>('/compare', {...selection, quality: selection.option})
      .then(value => { if (!cancelled()) setReport(value); })
      .catch(err => { if (!cancelled()) setError(err.message); })
      .finally(() => { if (!cancelled()) setRestoring(false); });
  });
  const context = report?.request ?? initial;
  return <main className="workspace investigation atlas lens-workspace lens-surface" data-theme="forest" ref={motion}>
    {evidencePage ? <EvidenceHeader lens="land-cover-forest" context={context} names={context?.pair.map(name)} setting={report && report.request.quality + " quality"}/> : <LensIntro lens="land-cover-forest"/>}
    {error && <div className="message" role="alert">{error} {!study && <button className="text-button" onClick={() => location.reload()}>Retry</button>}</div>}
    <p className="sr-only" role="status">{busy}</p>
    <div className={evidencePage ? "evidence-pages" : "investigation-grid lens-grid"}>
      {!evidencePage && <>
      <div className="atlas-map-column">
        {study ? <StudyMap study={study} trends={scan?.trends ?? {}} showScanHint pair={pair} busy={!!busy} select={selectOnMap}/>
          : <div className="atlas-map-placeholder">{error ? 'District map unavailable' : 'Loading district map…'}</div>}
        {manifest?.boundary_note && <p className="atlas-boundary">{manifest.boundary_note}</p>}
      </div>

      <aside aria-label="Comparison controls">
        <section className="panel setup lens-setup">
          <SetupStage title="Select districts">
            <DistrictFields study={study} pair={pair} slot={mapSlot} busy={!!busy} select={(id, index) => {
              select(pair.map((item, i) => i === index ? id : item));
              setMapSlot(1 - index);
            }}/>
          </SetupStage>
          <SetupStage title="Configure observations">
          <div className="district-selects">
            <label>From<select disabled={!!busy} value={settings.start} onChange={event => {
              const start = Number(event.target.value);
              changeSettings({...settings, start, end: Math.max(start, settings.end)});
            }}>{years.map(year => <option key={year}>{year}</option>)}</select></label>
            <label>To<select disabled={!!busy} value={settings.end} onChange={event => changeSettings({...settings, end: Number(event.target.value)})}>
              {years.filter(year => year >= settings.start).map(year => <option key={year}>{year}</option>)}
            </select></label>
          </div>
          <label className="atlas-quality">Observation quality
            <select disabled={!!busy} value={settings.quality} onChange={event => changeSettings({...settings, quality: event.target.value as Settings['quality']})}>
              <option value="standard">Standard</option><option value="strict">Strict</option>
            </select>
          </label>
          </SetupStage>
          <SetupStage title="Run investigation">
          <div className="setup-actions">
            <button className="primary" disabled={!!busy || !available} onClick={() => void compare(pair)}>Compare selected</button>
            <button className="outline" disabled={!!busy || !available} onClick={() => void run('Scanning district trends…', async () => {
              setScan(await request<Scan>('/scan', settings));
              setFilter('all');
            })}>Find contrasting districts</button>
          </div>
          </SetupStage>
          <details className="place-search"><summary>Search for a place</summary><LocationSearch/></details>
        </section>
      </aside>

      {scan && <section className="panel candidates atlas-candidates" ref={suggestions} tabIndex={-1} aria-labelledby="candidate-title">
        <div className="section-heading">
          <div><h2 id="candidate-title">Suggested comparisons</h2><p>Exploratory pairs from the Terra scan.</p></div>
          <label>Sort or filter <select value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">All qualifying pairs</option><option value="opposite">Opposite directions</option><option value="gap">Largest gap first</option>
          </select></label>
        </div>
        {candidates.length ? <div className="atlas-candidate-list">{candidates.map(candidate =>
          <button disabled={!!busy} aria-pressed={pair.join() === candidate.pair.join()} key={candidate.pair.join()} onClick={() => void compare(candidate.pair)}>
            <strong>{candidate.pair.map(name).join(' vs ')}</strong>
            <span>{number(Math.abs(candidate.delta)).replace('+', '')} NDVI points per decade apart</span>
          </button>)}</div> : <p>No pairs match this filter and date range.</p>}
      </section>}

      </>}
      <section className="result-column" id="comparison" ref={results} tabIndex={-1} aria-label="Comparison results">
        {report && (!evidencePage || page) ? <ForestEvidence key={JSON.stringify(report.request)} report={report} names={report.request.pair.map(name)}>
          <Findings report={report} names={report.request.pair.map(name)} busy={!!busy}
          reveal={() => void run('Checking Aqua…', async () => setReport(await request<Evidence>('/compare?reveal=true', report.request)))}/>
        </ForestEvidence>
          : evidencePage ? page && page.id !== "sources" && <EvidencePending busy={restoring} error={error}/> : <div className="panel result-empty"><h2>{busy || (available ? 'Comparison results' : 'Analysis unavailable')}</h2>
            <p>{available ? 'Run a comparison to see greenness trends and annual tree-canopy evidence.'
              : study ? 'Load a Terra and Aqua MODIS observation extract to compare districts.'
              : error ? 'Connect to the GeoLens API to check data availability.' : 'Waiting for the study to load.'}</p></div>}
      </section>

      {page?.id === "sources" && study && <EvidenceSection title="Study sources and coverage">
        <dl>
          <div><dt>Observations</dt><dd>{manifest?.name}</dd></div>
          {manifest?.start_month && manifest.end_month && <div><dt>Archive</dt><dd>{manifest.start_month} to {manifest.end_month}</dd></div>}
          {manifest?.accepted !== undefined && manifest.observed !== undefined && <div><dt>Coverage filter</dt><dd>{manifest.accepted.toLocaleString()} of {manifest.observed.toLocaleString()} district-month records passed</dd></div>}
          <div><dt>Boundaries</dt><dd><a href={study.regions.source}>OCHA Pakistan COD-AB</a> · {study.regions.license}</dd></div>
        </dl>
        <ul>
          <li><a href="https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD13A3">Terra MOD13A3</a> and <a href="https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MYD13A3">Aqua MYD13A3</a> · monthly greenness, 1 km</li>
          <li><a href="https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD44B">Terra MOD44B</a> · annual canopy estimates, 250 m</li>
          <li><a href="https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MCD12Q1">MODIS MCD12Q1</a> · 2023 land-cover classification, 500 m</li>
        </ul>
        <p>GeoLens compares districts on shared months and estimates trends and approximate uncertainty from the selected observations.</p>
        <a href="/method">Read the analysis method</a>
      </EvidenceSection>}
    </div>
  </main>;
}
