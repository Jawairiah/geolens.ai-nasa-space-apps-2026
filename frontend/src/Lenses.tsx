import {EvidenceHeader, EvidenceLinks, EvidencePending, EvidenceSection, ObservationCollection, observationMonth, readSelection, useEvidencePage, useLinkedEvidence} from './EvidencePages';
import {useEffect, useState, type FormEvent} from 'react';
import {useLocation, useParams} from 'react-router-dom';
import {download, number, request, type Compare, type Metric, type Study} from './api';
import {ChallengeChat, pairedSignal} from './ChallengeChat';
import {LensOverview, LensOverviewHeader} from './LensOverview';
import {UrbanHeat} from './UrbanHeat';
import {FindingsSummary, LensIntro, LensSetup, MonthlyHistory, lensContent, trendFinding} from './InvestigationUI';
import './lenses.css';

type Lens = {
  id: string;
  name: string;
  question: string;
  investigations: string[];
  core_variables: {name: string; product: string; asset: string; kind: string}[];
};

export function Lenses() {
  const {lensId, evidencePage} = useParams();
  const [items, setItems] = useState<Lens[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    request<{lenses: Lens[]}>('/lenses').then(result => {
      if (active) setItems(result.lenses);
    }).catch(err => {
      if (active) setError(err.message);
    });
    return () => { active = false; };
  }, []);
  const lens = items?.find(item => item.id === lensId);
  const design = lensId === "water-drought" || lensId === "urban-heat-growth" ? lensId : undefined;
  return <main className={lensId ? "workspace lens-workspace lens-surface" : "workspace lens-overview"} data-theme={design && lensContent[design].theme}>
    {design ? !evidencePage && <LensIntro lens={design}/> : lensId ? <h1>Investigation lens</h1> : <LensOverviewHeader/>}
    {error && <p role="alert" className="message">{error} <button className="text-button" onClick={() => location.reload()}>Retry</button></p>}
    {!items && !error && <p role="status">Loading investigation lenses…</p>}
    {items && !lensId && <LensOverview items={items}/>}
    {items && lensId && !lens && <p>This investigation lens is unavailable.</p>}
    {lens && <>
      {lens.id === 'water-drought' && <Rainfall sources={lens}/>}
      {lens.id === 'urban-heat-growth' && <UrbanHeat sources={<LensSources lens={lens}/>}/>}
    </>}
  </main>;
}

function LensSources({lens}: {lens: Lens}) {
  return <EvidenceSection title="Dataset catalog and scope">
        <h2>Investigation questions</h2>
        <ul>{lens.investigations.map(question => <li key={question}>{question}</li>)}</ul>
        <h2>Core variables and sources</h2>
        <dl>{lens.core_variables.map(variable => <div key={variable.asset}>
          <dt>{variable.name}</dt>
          <dd><a href={'https://developers.google.com/earth-engine/datasets/catalog/' + variable.asset.replaceAll('/', '_')}>{variable.product}</a> · {variable.kind}</dd>
        </div>)}</dl>
      </EvidenceSection>;
}

type Seasonal = {season_total_mm: number | null; baseline_mean_mm: number | null; anomaly_mm: number | null; baseline_seasons: number};
type RainResult = {
  comparison: Compare; units: string; method: string;
  request: {pair: string[]; start: number; end: number};
  season: {year: number; baseline_start: number; baseline_end: number; districts: Record<string, Seasonal>};
  sensitivity: {excluded_years: number[]; delta: Metric};
  historical: {soil: Compare; evap: Compare; windows: Record<string, unknown>; monthly_values: Record<string, Record<string, Partial<Record<"soil" | "evap", number>>>>; mismatch: Record<string, {status: string; matched_months: number[]; trends: Record<string, Metric>}>} | null;
  soil: {districts: Record<string, Record<string, {value: number; valid_area_m2: number}>>} | null;
};

function Rainfall({sources}: {sources: Lens}) {
  const {search} = useLocation();
  const {evidencePage} = useParams();
  const page = useEvidencePage();
  const initial = readSelection(search);
  const [study, setStudy] = useState<Study>();
  const [result, setResult] = useState<RainResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    request<Study>('/study').then(data => { if (active) setStudy(data); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  const [startYear, setStartYear] = useState(initial?.start ?? 2003);
  const [endYear, setEndYear] = useState(initial?.end ?? 2024);
  const years = Array.from({length: 22}, (_, index) => 2003 + index);
  async function compareRainfall(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setResult(undefined);
    setError('');
    setBusy(true);
    try {
      setResult(await request<RainResult>('/lenses/water-drought/investigate', {
        pair: [values.get('first'), values.get('second')], start: Number(values.get('start')), end: Number(values.get('end')), season_year: Number(values.get('season')),
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const names = result?.request.pair.map(id => study?.regions.features.find(region => region.id === id)?.properties.name ?? id) ?? [];
  useLinkedEvidence(result, value => ({...value.request, option: String(value.season.year)}), (selection, cancelled) => {
    setBusy(true);
    setError('');
    setResult(undefined);
    request<RainResult>('/lenses/water-drought/investigate', {...selection, season_year: Number(selection.option)})
      .then(value => { if (!cancelled()) setResult(value); })
      .catch(err => { if (!cancelled()) setError(err.message); })
      .finally(() => { if (!cancelled()) setBusy(false); });
  });
  const context = result?.request ?? initial;
  if (evidencePage) return <div className="evidence-pages">
    <EvidenceHeader lens="water-drought" context={context} names={context?.pair.map(id => study?.regions.features.find(region => region.id === id)?.properties.name ?? id)} setting={result && 'Monsoon ' + result.season.year}/>
    {page?.id === 'sources' && <>
      <LensSources lens={sources}/>
      <EvidenceSection title="How water trends are calculated">
        <p>{result?.method ?? 'GeoLens estimates trends on shared months from the selected districts. Run a comparison for the methods and uncertainty specific to that result.'}</p>
        <p>GLDAS Noah v2.1 uses a 0.25° grid. NASA SMAP provides 9 km morning retrievals. The 2024 screen averages pixels with at least five passing retrieval days in a month.</p>
      </EvidenceSection>
    </>}
    {page && page.id !== 'sources' && (result ? page.id === 'trends' ? <>
      <MonthlyHistory start={result.request.start} end={result.request.end} names={names} signals={[
        {id: "rain", label: "Monthly precipitation", source: "NASA GPM IMERG Final V07", unit: "mm", result: result.comparison},
        ...(result.historical ? [
          {id: "soil", label: "Modeled soil moisture", source: "NASA GLDAS Noah v2.1 model", unit: "kg/m²", result: result.historical.soil},
          {id: "evap", label: "Modeled evapotranspiration", source: "NASA GLDAS Noah v2.1 model", unit: "mm", result: result.historical.evap},
        ] : []),
      ]}/>
      <EvidenceSection title="Precipitation trends">
      <p>Rates in {result.units}.</p>
      <div className="evidence-table"><table><thead><tr><th>Series</th><th>Rate</th><th>Approx. 95% interval</th><th>Shared months</th></tr></thead>
        <tbody>{([['District A', result.comparison.left], ['District B', result.comparison.right], ['A minus B', result.comparison.delta]] as [string, Metric][]).map(([label, metric]) =>
          <tr key={label}><th scope="row">{label}</th><td>{number(metric.slope)}</td><td>{metric.interval?.map(number).join(' to ') ?? 'Unavailable'}</td><td>{metric.months}</td></tr>)}</tbody></table></div>
      <p>{result.comparison.delta.interval ? result.comparison.delta.interval[0] <= 0 && result.comparison.delta.interval[1] >= 0 ? 'The precipitation trend difference is inconclusive at the reported uncertainty level.' : 'The precipitation trend difference excludes zero at the reported uncertainty level.' : 'The selected period has too few shared months to estimate the trend difference.'}</p>
</EvidenceSection>
      <EvidenceSection title="Monsoon and flood-year sensitivity">      <h3>July–September precipitation anomaly</h3>
      <p>{result.season.year} compared with the same months in {result.season.baseline_start}–{result.season.baseline_end}. A negative anomaly means less precipitation than the baseline average.</p>
      <div className="evidence-table"><table><thead><tr><th>District</th><th>Season (mm)</th><th>Baseline (mm)</th><th>Difference (mm)</th><th>Baseline seasons</th></tr></thead>
        <tbody>{result.request.pair.map(id => {
          const season = result.season.districts[id];
          return <tr key={id}><th scope="row">{study?.regions.features.find(region => region.id === id)?.properties.name ?? id}</th>
            <td>{season.season_total_mm?.toFixed(1) ?? '—'}</td><td>{season.baseline_mean_mm?.toFixed(1) ?? '—'}</td><td>{number(season.anomaly_mm)}</td><td>{season.baseline_seasons}</td></tr>;
        })}</tbody></table></div>
      <h3>Flood-year sensitivity</h3>
      {result.sensitivity.excluded_years.length ? <p>With {result.sensitivity.excluded_years.join(' and ')} excluded, the A-minus-B trend is {number(result.sensitivity.delta.slope)} {result.units} from {result.sensitivity.delta.months} shared months. Approximate 95% interval: {result.sensitivity.delta.interval?.map(number).join(' to ') ?? 'unavailable'}.</p> : <p>The selected trend period contains neither 2010 nor 2022.</p>}
</EvidenceSection>
      <EvidenceSection title="Modeled drought indicators">      <h3>Long-term modeled soil moisture and evapotranspiration</h3>
      <p>NASA GLDAS Noah v2.1 at 0.25° resolution. These are published model outputs. The coarse grid can overlap districts and evapotranspiration describes a landscape water flux.</p>
      {result.historical ? <>
        {(['soil', 'evap'] as const).map(key => {
          const soil = key === 'soil';
          const series = result.historical![key];
          const label = soil ? 'Top 10 cm soil moisture' : 'Monthly evapotranspiration';
          const units = soil ? 'kg/m² per decade' : 'mm of monthly ET per decade';
          return <section key={key}><h4>{label}</h4><p>Trend rates in {units}.</p>
            <div className="evidence-table"><table><thead><tr><th>Series</th><th>Rate</th><th>Approx. 95% interval</th><th>Shared months</th></tr></thead>
              <tbody>{([['District A', series.left], ['District B', series.right], ['A minus B', series.delta]] as [string, Metric][]).map(([name, metric]) =>
                <tr key={name}><th scope="row">{name}</th><td>{number(metric.slope)}</td><td>{metric.interval?.map(number).join(' to ') ?? 'Unavailable'}</td><td>{metric.months}</td></tr>)}</tbody></table></div>
          </section>;
        })}
        <h3>Rainfall–soil moisture mismatch screen</h3>
        <p>Uses months shared by IMERG precipitation, GLDAS soil moisture, and Terra MODIS greenness. A potential mismatch is flagged when soil moisture and greenness intervals are both below zero while the precipitation interval includes zero. An inconclusive rainfall trend can still include meaningful changes. Use this flag to prioritize further investigation.</p>
        <div className="evidence-table"><table><thead><tr><th>District</th><th>Shared months</th><th>Result</th><th>Matched trend estimates</th></tr></thead><tbody>
          {result.request.pair.map(id => {
            const check = result.historical!.mismatch[id];
            return <tr key={id}><th scope="row">{study?.regions.features.find(region => region.id === id)?.properties.name ?? id}</th><td>{check.matched_months.length}</td><td>{check.status}</td><td><ul className="water-matched-trends">{([["precipitation", "Precipitation", result.units], ["soil_moisture", "Soil moisture", "kg/m² per decade"], ["greenness", "Terra NDVI", "NDVI points per decade"]] as const).map(([key, label, unit]) => {
              const metric = check.trends[key];
              return <li key={key}>{label}: {number(metric.slope)} {unit}{metric.interval && <> · 95% interval {metric.interval.map(number).join(" to ")}</>}</li>;
            })}</ul></td></tr>;
          })}
        </tbody></table></div>
      </> : <p>The verified GLDAS archive is unavailable.</p>}
</EvidenceSection>
    </> : <>
      <ObservationCollection groups={[
        {title: 'GPM IMERG monthly rainfall', headings: ['Month', ...names.map(name => name + ' (mm)')],
          rows: result.comparison.series.map(([month, a, b]) => {const date = observationMonth(month); return {key: date, date, cells: [date, a.toFixed(2), b.toFixed(2)]};})},
        ...(result.historical ? (['soil', 'evap'] as const).map(key => ({
          title: key === 'soil' ? 'GLDAS monthly soil moisture' : 'GLDAS monthly evapotranspiration',
          headings: ['Month', ...names.map(name => name + (key === 'soil' ? ' (kg/m²)' : ' (mm)'))],
          rows: Object.keys(result.historical!.windows).sort().map(date => ({key: date, date, cells: [date, ...result.request.pair.map(id => result.historical?.monthly_values[id][date]?.[key]?.toFixed(3) ?? 'Unavailable')]})),
        })) : []),
        ...(result.soil ? [{title: 'SMAP satellite soil moisture (2024)', headings: ['Month', ...names.map(name => name + ' (m³/m³)')],
          rows: Array.from({length: 12}, (_, month) => '2024-' + String(month + 1).padStart(2, '0')).map(date => ({
            key: date, date, cells: [date, ...result.request.pair.map(id => result.soil?.districts[id][date]?.value.toFixed(3) ?? 'Unavailable')],
          }))}] : []),
      ]}/>
      <button className="text-button" onClick={() => download(result, 'geolens-water-evidence.json')}>Download water investigation evidence JSON</button>
    </> : <EvidencePending busy={busy} error={error}/>)}
  </div>;
  return <section className="lens-analysis">
    <LensSetup study={study} busy={busy} error={error} submit={compareRainfall} action="Compare precipitation" initialPair={initial?.pair}>
      <div className="district-selects">
        <label>Trend start<select name="start" value={startYear} disabled={busy} onChange={event => {
          const year = Number(event.target.value);
          setStartYear(year);
          setEndYear(Math.max(year, endYear));
        }}>{years.map(year => <option key={year}>{year}</option>)}</select></label>
        <label>Trend end<select name="end" value={endYear} disabled={busy} onChange={event => setEndYear(Number(event.target.value))}>
          {years.filter(year => year >= startYear).map(year => <option key={year}>{year}</option>)}
        </select></label>
      </div>
      <label>Monsoon season<select name="season" defaultValue={initial?.option || "2024"} disabled={busy}>{[2021, 2022, 2023, 2024].map(year => <option key={year}>{year}</option>)}</select></label>
    </LensSetup>
    {error && <p role="alert" className="message">{error}</p>}
    {!result && !busy && !error && <div className="panel lens-empty"><h2>Comparison results</h2><p>Compare two districts to see monthly precipitation, a seasonal anomaly, and the uncertainty around the trend difference.</p></div>}
    {result && <>
      <FindingsSummary start={result.request.start} end={result.request.end} items={[
        trendFinding(names[0] + " · rainfall", result.comparison.left, result.units),
        trendFinding(names[1] + " · rainfall", result.comparison.right, result.units),
        trendFinding("District rainfall gap · A minus B", result.comparison.delta, result.units),
        ...result.request.pair.map((id, index) => ({label: names[index] + " · seasonal anomaly", value: result.season.districts[id].anomaly_mm, unit: "mm", detail: "July–September " + result.season.year})),
      ]}/>
      <EvidenceLinks selection={{...result.request, option: String(result.season.year)}}/>
      <ChallengeChat start={result.request.start} end={result.request.end} signals={[
        pairedSignal("rain", "Monthly precipitation", result.units, "NASA GPM IMERG Final V07", names, result.comparison),
        ...(result.historical ? [
          pairedSignal("soil", "Modeled surface soil moisture", "kg/m² per decade", "NASA GLDAS Noah v2.1 model", names, result.historical.soil),
          pairedSignal("et", "Modeled monthly evapotranspiration", "mm of monthly ET per decade", "NASA GLDAS Noah v2.1 model", names, result.historical.evap),
        ] : []),
      ]}/>
    </>}
  </section>;
}
