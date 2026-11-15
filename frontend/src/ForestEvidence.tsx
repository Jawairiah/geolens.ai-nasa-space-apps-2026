import {EvidenceLinks, EvidenceSection, ObservationCollection, observationMonth, useEvidencePage} from './EvidencePages';
import {useEffect, useState, type ReactNode} from 'react';
import {FindingsSummary, trendFinding} from './InvestigationUI';
import {ChallengeChat, pairedSignal} from './ChallengeChat';
import {download, number, request, type Evidence, type Metric} from './api';


type CanopyDistrict = {
  annual: Record<string, number>;
  quality_share: Record<string, number>;
  trend: Omit<Metric, 'months'> & {years: number};
  land_area_m2: number;
  support_area_m2: number;
  endpoint_change: number | null;
  land_cover_2023: {built_km2: number; classified_land_km2: number} | null;
};
type CanopyResult = {
  districts: Record<string, CanopyDistrict>;
  cover_snapshot: string | null;
  method: string;
  trend_method: string;
};

export function ForestEvidence({report, names, children}: {report: Evidence; names: string[]; children: ReactNode}) {
  const page = useEvidencePage();
  const [result, setResult] = useState<CanopyResult>();
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);
  const {request: specification} = report;
  const key = JSON.stringify(specification);
  useEffect(() => {
    let active = true;
    setError('');
    request<CanopyResult>('/lenses/land-cover-forest/investigate', JSON.parse(key)).then(data => {
      if (active) setResult(data);
    }).catch((err: Error) => {
      if (active) setError(err.message);
    });
    return () => { active = false; };
  }, [key, attempt]);

  const pairs = specification.pair.map((id, index) => ({id, name: names[index], canopy: result?.districts[id]}));
  const run = report.runs[0];
  const canopyStatus = error ? <p className="message" role="alert">{error} <button className="text-button" onClick={() => retry(attempt + 1)}>Retry</button></p>
    : !result && <p role="status">Loading tree-canopy evidence…</p>;
  if (!page) return <div className="forest-evidence lens-results">
    <FindingsSummary start={specification.start} end={specification.end} items={[
      trendFinding(names[0] + " · Terra NDVI", run.terra.left, "NDVI points per decade"),
      trendFinding(names[1] + " · Terra NDVI", run.terra.right, "NDVI points per decade"),
      trendFinding("Greenness gap · A minus B", run.terra.delta, "NDVI points per decade"),
      ...pairs.flatMap(({name, canopy}) => canopy ? [{label: name + " · tree canopy", value: canopy.trend.slope, unit: "percentage points per decade", detail: canopy.trend.years + " annual estimates"}] : []),
    ]}/>
    <EvidenceLinks selection={{...specification, option: specification.quality}}/>
    <ChallengeChat start={specification.start} end={specification.end} signals={[
      pairedSignal("terra", "Terra vegetation greenness (NDVI)", "NDVI points per decade", "NASA Terra MODIS MOD13A3", names, run.terra),
      ...(run.aqua ? [pairedSignal("aqua", "Aqua vegetation greenness (NDVI)", "NDVI points per decade", "NASA Aqua MODIS MYD13A3", names, run.aqua)] : []),
      ...(run.common ? [
        pairedSignal("terra-shared", "Terra NDVI · cross-satellite shared months", "NDVI points per decade", "NASA Terra MODIS MOD13A3", names, run.common.terra),
        pairedSignal("aqua-shared", "Aqua NDVI · cross-satellite shared months", "NDVI points per decade", "NASA Aqua MODIS MYD13A3", names, run.common.aqua),
      ] : []),
      ...(result ? [{id: "canopy", name: "Annual tree canopy", unit: "percentage points per decade", source: "NASA Terra MODIS MOD44B", districts: pairs.flatMap(({name, canopy}) => canopy ? [{name, metric: canopy.trend, count: canopy.trend.years + " annual estimates"}] : [])}] : []),
    ]}/>
  </div>;
  if (page.id === 'trends') return <>
    {children}
    <EvidenceSection title="Tree canopy trends">
    <p>Annual NASA MOD44B tree-canopy estimates use a fixed set of 250 m pixels with valid canopy estimates in every archive year. The vegetation comparison above uses monthly NDVI, which also responds to crops, grass, and shrubs.</p>
      {result ? <>
        <CanopyChart pairs={pairs} start={specification.start} end={specification.end}/>
        <div className="evidence-table"><table>
          <thead><tr><th>District</th><th>Trend (pp/decade)</th><th>Approx. 95% interval</th><th>Endpoint change (pp)</th><th>Annual estimates</th><th>Land with fixed support</th></tr></thead>
          <tbody>{pairs.map(({id, name, canopy}) => canopy && <tr key={id}><th scope="row">{name}</th>
            <td>{number(canopy.trend.slope)}</td><td>{canopy.trend.interval?.map(number).join(' to ') ?? 'Unavailable'}</td>
            <td>{number(canopy.endpoint_change)}</td><td>{canopy.trend.years}</td>
            <td>{canopy.land_area_m2 ? (100 * canopy.support_area_m2 / canopy.land_area_m2).toFixed(1) + '%' : 'Unavailable'}</td>
          </tr>)}</tbody>
        </table></div>
        <p>Rates and endpoint changes use percentage points of canopy cover. Trend estimates require at least eight annual values. An interval that spans zero leaves the trend direction inconclusive.</p>
        <h3>Do greenness and canopy agree?</h3>
        <ul>{pairs.map(({id, name, canopy}, index) => {
          const ndvi = index === 0 ? report.runs[0].terra.left : report.runs[0].terra.right;
          const direction = (interval?: [number, number] | null) => !interval ? 'unavailable' : interval[0] > 0 ? 'increasing' : interval[1] < 0 ? 'decreasing' : 'inconclusive';
          return <li key={id}><strong>{name}</strong> · Terra NDVI {direction(ndvi.interval)} · canopy {direction(canopy?.trend.interval)}</li>;
        })}</ul>
      </> : canopyStatus}
    </EvidenceSection>
  </>;
  if (page.id === 'sources') return result ? <>
        <EvidenceSection title="Canopy methods and quality"><p>{result.method} {result.trend_method}</p>
          <p>Changes in district averages support screening for canopy change. Identifying individual loss sites or causes requires finer-scale evidence.</p>
          <a href="https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD44B">NASA MOD44B catalog</a>
        </EvidenceSection>
  </> : canopyStatus;
  return <>
    <ObservationCollection key={result ? 'canopy-loaded' : 'greenness-only'} groups={[
      ...(result ? [{
        title: 'Annual tree canopy and input quality',
        headings: ['Year', ...names.flatMap(name => [name + ' canopy cover (%)', name + ' input quality (%)'])],
        rows: Array.from({length: specification.end - specification.start + 1}, (_, i) => specification.start + i).map(year => ({
          key: String(year), date: String(year), cells: [year, ...pairs.flatMap(({canopy}) => [
            canopy?.annual[year]?.toFixed(2) ?? 'Unavailable',
            canopy?.quality_share[year] === undefined ? 'Unavailable' : (100 * canopy.quality_share[year]).toFixed(1),
          ])],
        })),
      }] : []),
      ...([{label: 'Terra', comparison: run.terra}, ...(run.aqua ? [{label: 'Aqua', comparison: run.aqua}] : [])]).map(({label, comparison}) => ({
        title: label + ' monthly vegetation greenness',
        headings: ['Month', ...names.map(name => name + ' NDVI')],
        rows: comparison.series.map(([month, a, b]) => {const date = observationMonth(month); return {key: date, date, cells: [date, a.toFixed(3), b.toFixed(3)]};}),
      })),
    ]}/>
    {result ? <>
        {result.cover_snapshot && <EvidenceSection title="2023 land-cover snapshot">
          <p>MCD12Q1’s built-up class is a land-cover snapshot. The 2023 snapshot is shown independently of the selected trend period. Verifying conversion requires separate evidence.</p>
          <div className="evidence-table"><table><thead><tr><th>District</th><th>Built-up class (km²)</th><th>Classified land (km²)</th></tr></thead>
            <tbody>{pairs.map(({id, name, canopy}) => <tr key={id}><th scope="row">{name}</th>
              <td>{canopy?.land_cover_2023?.built_km2.toFixed(2) ?? 'Unavailable'}</td>
              <td>{canopy?.land_cover_2023?.classified_land_km2.toFixed(2) ?? 'Unavailable'}</td>
            </tr>)}</tbody></table></div>
        </EvidenceSection>}
        <button className="text-button" onClick={() => download({greenness: report, canopy: result}, 'geolens-forest-evidence.json')}>Download combined forest evidence JSON</button>
    </> : canopyStatus}
  </>;
}
type DistrictSeries = {name: string; canopy?: {annual: Record<string, number>}};

export function CanopyChart({pairs, start, end}: {pairs: DistrictSeries[]; start: number; end: number}) {
  const values = pairs.flatMap(pair => Object.values(pair.canopy?.annual ?? {}));
  if (values.length < 2 || start === end) return null;
  const high = Math.max(1, Math.ceil(Math.max(...values)));
  const x = (year: number) => 50 + 585 * (year - start) / (end - start);
  const y = (value: number) => 194 - 170 * value / high;
  const colors = ['#75e2bd', '#dfa86b'];
  return <figure className="heat-series">
    <figcaption>Annual tree canopy (% of fixed land area)</figcaption>
    <p>{pairs.map(({name}, i) => <span key={name} style={{color: colors[i]}}>{i > 0 && ' · '}{name}</span>)}</p>
    <svg viewBox="0 0 670 230" role="img" aria-label="Annual district canopy estimates. Exact values are in the annual canopy table.">
      {[0, high / 2, high].map(value => <g key={value}><line x1="50" x2="635" y1={y(value)} y2={y(value)}/><text x="5" y={y(value) + 5}>{value}%</text></g>)}
      <text x="50" y="221">{start}</text><text x="635" y="221" textAnchor="end">{end}</text>
      {pairs.map(({name, canopy}, i) => {
        const entries = Object.entries(canopy?.annual ?? {}).map(([year, value]) => [Number(year), value]);
        return <g key={name}>
          <path fill="none" stroke={colors[i]} strokeWidth="2" d={entries.map(([year, value], index) =>
            (entries[index - 1]?.[0] === year - 1 ? 'L' : 'M') + x(year) + ' ' + y(value)).join(' ')}/>
          {entries.map(([year, value]) => <circle key={year} cx={x(year)} cy={y(value)} r="2.2" fill={colors[i]}/>)}
        </g>;
      })}
    </svg>
  </figure>;
}
