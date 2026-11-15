import {EvidenceHeader, EvidenceLinks, EvidencePending, EvidenceSection, ObservationCollection, observationMonth, readSelection, useEvidencePage, useLinkedEvidence} from './EvidencePages';
import {useLocation, useParams} from 'react-router-dom';
import {useEffect, useState, type FormEvent, type ReactNode} from 'react';
import {FindingsSummary, LensSetup, trendFinding} from './InvestigationUI';
import {ChallengeChat, pairedSignal} from './ChallengeChat';
import {download, number, request, type Compare, type Metric, type Study} from './api';

type Pass = 'day' | 'night';
type HeatResult = {
  request: {pair: string[]; start: number; end: number; overpass: Pass};
  district: Record<Pass, Compare>;
  day_night: Record<string, Compare>;
  urban: Record<Pass, Record<string, Compare>>;
  land: Record<string, {annual: {year: number; classified_area: {built_km2: number; classified_land_km2: number} | null; ndvi: number | null; ndvi_months: number}[]; greenness_trend: Metric}>;
  map: Record<string, Metric>;
  method: string;
  reference_area_m2: Record<string, {urban: number; reference: number}>;
};
const years = Array.from({length: 22}, (_, i) => 2003 + i);

function TrendTable({rows}: {rows: {label: string; metric: Metric}[]}) {
  return <div className="evidence-table"><table>
    <thead><tr><th>Series</th><th>°C per decade</th><th>Approx. 95% interval</th><th>Shared months</th></tr></thead>
    <tbody>{rows.map(({label, metric}) => <tr key={label}>
      <th scope="row">{label}</th><td>{number(metric.slope)}</td>
      <td>{metric.interval?.map(number).join(' to ') ?? 'Unavailable'}</td><td>{metric.months}</td>
    </tr>)}</tbody>
  </table></div>;
}

function HeatMap({study, metrics}: {study: Study; metrics: HeatResult['map']}) {
  const districtRings = study.regions.features.map(region => ({
    ...region, rings: region.geometry.type === 'Polygon' ? region.geometry.coordinates : region.geometry.coordinates.flat(),
  }));
  const coordinates = districtRings.flatMap(region => region.rings.flat());
  const x0 = Math.min(...coordinates.map(point => point[0]));
  const x1 = Math.max(...coordinates.map(point => point[0]));
  const y0 = Math.min(...coordinates.map(point => point[1]));
  const y1 = Math.max(...coordinates.map(point => point[1]));
  const x = (lon: number) => (lon - (x0 + x1) / 2) * 0.9;
  const y = (lat: number) => (y0 + y1) / 2 - lat;
  const width = (x1 - x0) * 0.9 + 0.06;
  const height = y1 - y0 + 0.06;
  function category(metric: Metric) {
    if (!metric.interval) return ['#1c293d', 'Unavailable'];
    if (metric.interval[0] > 0) return ['#ea8757', 'Warming'];
    if (metric.interval[1] < 0) return ['#66b9df', 'Cooling'];
    return ['#756d80', 'Inconclusive'];
  }
  return <section className="heat-map">
    <h3>District surface temperature trends</h3>
    <svg viewBox={[-width / 2, -height / 2, width, height].join(' ')} role="img" aria-label="Map of estimated trends across the six historical Karachi districts">
      {districtRings.map(region => <path key={region.id} d={region.rings.map(ring =>
        ring.map(([lon, lat], i) => (i ? 'L' : 'M') + x(lon) + ' ' + y(lat)).join(' ') + 'Z').join(' ')}
        fill={category(metrics[region.id])[0]} fillRule="evenodd" stroke="#d6dde8" strokeWidth="0.002">
        <title>{region.properties.name} · {category(metrics[region.id])[1]} · {number(metrics[region.id].slope)} °C per decade</title>
      </path>)}
    </svg>
    <ul>{districtRings.map(region => <li key={region.id}>{region.properties.name} · {category(metrics[region.id])[1]} · {number(metrics[region.id].slope)} °C/decade</li>)}</ul>
    <p>Direction is labeled when the district’s interval excludes zero. These map estimates use each district’s available months.</p>
  </section>;
}

function HeatSeries({result, names, start, end}: {result: Compare; names: string[]; start: number; end: number}) {
  if (result.series.length < 2) return <p>Too few shared months to draw a time series.</p>;
  const values = result.series.flatMap(([, a, b]) => [a, b]);
  const low = Math.floor(Math.min(...values) / 5) * 5;
  const high = Math.max(low + 5, Math.ceil(Math.max(...values) / 5) * 5);
  const left = (start - 2003) * 12;
  const months = (end - start + 1) * 12 - 1;
  const x = (t: number) => 54 + 585 * (t - left) / months;
  const y = (v: number) => 194 - 170 * (v - low) / (high - low);
  const colors = ['#efa475', '#86d0ef'];
  return <figure className="heat-series">
    <figcaption>Matched monthly surface temperatures (°C)</figcaption>
    <p>{names.map((name, i) => <span key={name} style={{color: colors[i]}}>{i > 0 && ' · '}{name}</span>)}</p>
    <svg viewBox="0 0 670 230" role="img" aria-label="Monthly surface temperature series. Missing months appear as gaps. Exact values follow in the table.">
      {[low, (low + high) / 2, high].map(value => <g key={value}><line x1="54" x2="639" y1={y(value)} y2={y(value)}/><text x="5" y={y(value) + 5}>{value}°</text></g>)}
      <text x="54" y="221">{start}</text><text x="639" y="221" textAnchor="end">{end}</text>
      {([1, 2] as const).map((col, i) => <path key={col} fill="none" stroke={colors[i]} strokeWidth="2"
        d={result.series.map(([t], index) => {
          const previous = result.series[index - 1]?.[0];
          return (previous === t - 1 ? 'L' : 'M') + x(t) + ' ' + y(result.series[index][col]);
        }).join(' ')}/>)}
    </svg>
  </figure>;
}

export function UrbanHeat({sources}: {sources: ReactNode}) {
  const {search} = useLocation();
  const {evidencePage} = useParams();
  const page = useEvidencePage();
  const initial = readSelection(search);
  const [study, setStudy] = useState<Study>();
  const [result, setResult] = useState<HeatResult>();
  const [start, setStart] = useState(initial?.start ?? 2003);
  const [end, setEnd] = useState(initial?.end ?? 2024);
  const [pass, setPass] = useState<Pass>(initial?.option === 'night' ? 'night' : 'day');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    request<Study>('/study').then(value => { if (active) setStudy(value); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setResult(undefined);
    setError('');
    try {
      setResult(await request<HeatResult>('/lenses/urban-heat-growth/investigate', {
        pair: [fields.get('first'), fields.get('second')], start, end, overpass: pass,
      }));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  const name = (id: string) => study?.regions.features.find(region => region.id === id)?.properties.name ?? id;
  const active = result?.district[result.request.overpass];
  useLinkedEvidence(result, value => ({...value.request, option: value.request.overpass}), (selection, cancelled) => {
    setBusy(true);
    setError('');
    setResult(undefined);
    request<HeatResult>('/lenses/urban-heat-growth/investigate', {...selection, overpass: selection.option})
      .then(value => { if (!cancelled()) setResult(value); })
      .catch(err => { if (!cancelled()) setError(err.message); })
      .finally(() => { if (!cancelled()) setBusy(false); });
  });
  const comparison = result?.request ?? initial;
  if (evidencePage) return <div className="evidence-pages">
    <EvidenceHeader lens="urban-heat-growth" context={comparison} names={comparison?.pair.map(name)} setting={result && (result.request.overpass === 'day' ? 'Daytime' : 'Nighttime')}/>
    {page?.id === 'sources' && <>
      {sources}
      <EvidenceSection title="Measurement and quality filters">
        <p>{result?.method ?? 'GeoLens uses clear-sky Terra MODIS surface temperatures at about 1 km. Land surface temperature describes the ground and built surfaces.'}</p>
        <p>The trend model uses month fixed effects and calendar-lag uncertainty. It requires at least 60 shared months and half of the selected period.</p>
      <h3>Built-up classification and greenness</h3>
      <p>Annual MCD12Q1 class areas and <a href="https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD13A3">Terra MOD13A3 greenness</a> provide district-level context through 2023. Annual NDVI requires all 12 eligible months. Changes in class labels can reflect classification variability. Use site-scale imagery or records to verify urban expansion and where it overlaps with changes in vegetation.</p>
      </EvidenceSection>
    </>}
    {page && page.id !== 'sources' && (result && study && active ? page.id === 'trends' ? <>
      <div className="panel lens-history"><HeatSeries result={active} names={result.request.pair.map(name)} start={result.request.start} end={result.request.end}/></div>
      <div className="panel lens-history"><HeatMap study={study} metrics={result.map}/></div>
      <EvidenceSection title="Daytime and nighttime district trends">
      <p>{result.request.start}–{result.request.end}. The gap is {name(result.request.pair[0])} minus {name(result.request.pair[1])}. Day and night can have different usable months.</p>
      <TrendTable rows={(['day', 'night'] as const).flatMap(overpass => [
        {label: overpass + ' · ' + name(result.request.pair[0]), metric: result.district[overpass].left},
        {label: overpass + ' · ' + name(result.request.pair[1]), metric: result.district[overpass].right},
        {label: overpass + ' · district gap', metric: result.district[overpass].delta},
      ])}/>
      <details><summary>Did daytime and nighttime warm at different rates?</summary>
        <p>These estimates use months with both daytime and nighttime values for each district.</p>
        <TrendTable rows={result.request.pair.map(id => ({label: name(id) + ' · daytime minus nighttime', metric: result.day_night[id].delta}))}/>
      </details>
</EvidenceSection>
      <EvidenceSection title="Built-up versus non-built surface heat">
      <p>The reference uses land classified as non-built in 2003, 2013, and 2023 within each district. It can include agricultural or natural land. Built-up and reference samples share composite dates. Mixed land cover and coastal conditions can influence the gap.</p>
      <ul>{result.request.pair.map(id => {
        const area = result.reference_area_m2[id];
        return <li key={id}>{name(id)} · {(area.urban / 1e6).toFixed(1)} km² built-up and {(area.reference / 1e6).toFixed(1)} km² non-built reference{Math.min(area.urban, area.reference) < 5 && ' · less than the 5 km² minimum for one class'}</li>;
      })}</ul>
      {(['day', 'night'] as const).map(overpass => <details key={overpass} open={overpass === result.request.overpass}>
        <summary>{overpass === 'day' ? 'Daytime' : 'Nighttime'} urban-reference trends</summary>
        <TrendTable rows={result.request.pair.flatMap(id => [
          {label: name(id) + ' · built-up', metric: result.urban[overpass][id].left},
          {label: name(id) + ' · non-built', metric: result.urban[overpass][id].right},
          {label: name(id) + ' · heat gap', metric: result.urban[overpass][id].delta},
        ])}/>
        <div className="evidence-table"><table><thead><tr><th>District</th><th>Mean matched built-up minus non-built (°C)</th></tr></thead><tbody>
          {result.request.pair.map(id => {
            const rows = result.urban[overpass][id].series;
            return <tr key={id}><th scope="row">{name(id)}</th><td>{rows.length ? number(rows.reduce((total, [, urban, rural]) => total + urban - rural, 0) / rows.length) : 'Unavailable'}</td></tr>;
          })}
        </tbody></table></div>
      </details>)}
</EvidenceSection>
    </> : <>
      <ObservationCollection groups={[
        ...(['day', 'night'] as const).flatMap(overpass => {
          const label = overpass === 'day' ? 'Daytime' : 'Nighttime';
          return [
            {title: label + ' district temperatures', headings: ['Month', ...result.request.pair.map(id => name(id) + ' (°C)')],
              rows: result.district[overpass].series.map(([month, a, b]) => {const date = observationMonth(month); return {key: date, date, cells: [date, a.toFixed(2), b.toFixed(2)]};})},
            {title: label + ' built-up and non-built temperatures', headings: ['District', 'Month', 'Built-up (°C)', 'Non-built (°C)', 'Gap (°C)'],
              rows: result.request.pair.flatMap(id => result.urban[overpass][id].series.map(([month, urban, reference]) => {
                const date = observationMonth(month);
                return {key: id + date, date, cells: [name(id), date, urban.toFixed(2), reference.toFixed(2), number(urban - reference)]};
              }))},
          ];
        }),
        ...result.request.pair.map(id => ({title: name(id) + ' annual land-cover context',
          headings: ['Year', 'Built-up class (km²)', 'Classified land (km²)', 'Annual NDVI', 'NDVI months'],
          rows: result.land[id].annual.map(row => ({key: String(row.year), date: String(row.year), cells: [
            row.year, row.classified_area?.built_km2.toFixed(2) ?? 'Unavailable',
            row.classified_area?.classified_land_km2.toFixed(2) ?? 'Unavailable', row.ndvi?.toFixed(3) ?? 'Unavailable', row.ndvi_months,
          ]})),
        })),
      ]}/>
      <button className="text-button" onClick={() => download(result, 'geolens-urban-heat-evidence.json')}>Download urban heat evidence JSON</button>
    </> : <EvidencePending busy={busy || !!result && !study && !error} error={error}/>)}
  </div>;
  return <section className="lens-analysis">
    <LensSetup study={study} busy={busy} error={error} submit={run} action="Run heat comparison" initialPair={initial?.pair}>
      <div className="district-selects">
        <label>Trend start<select value={start} disabled={busy} onChange={event => {const year = Number(event.target.value); setStart(year); setEnd(Math.max(end, year));}}>
          {years.map(year => <option key={year}>{year}</option>)}</select></label>
        <label>Trend end<select value={end} disabled={busy} onChange={event => setEnd(Number(event.target.value))}>
          {years.filter(year => year >= start).map(year => <option key={year}>{year}</option>)}</select></label>
      </div>
      <label>Map and monthly values<select value={pass} disabled={busy} onChange={event => setPass(event.target.value as Pass)}>
        <option value="day">Daytime</option><option value="night">Nighttime</option></select></label>
    </LensSetup>
    {error && <p className="message" role="alert">{error}</p>}
    {!result && !busy && !error && <div className="panel lens-empty"><h2>Comparison results</h2><p>Compare two districts to view surface warming, urban heat contrasts, and district land-cover context.</p></div>}
    {result && active && <>
      <FindingsSummary start={result.request.start} end={result.request.end} items={[
        trendFinding(name(result.request.pair[0]) + " · " + result.request.overpass + " surface temperature", active.left, "°C per decade"),
        trendFinding(name(result.request.pair[1]) + " · " + result.request.overpass + " surface temperature", active.right, "°C per decade"),
        trendFinding("District surface temperature gap · A minus B", active.delta, "°C per decade"),
        ...result.request.pair.map(id => trendFinding(name(id) + " · built-up minus non-built (" + result.request.overpass + ")", result.urban[result.request.overpass][id].delta, "°C per decade")),
      ]}/>
      <EvidenceLinks selection={{...result.request, option: result.request.overpass}}/>
      <ChallengeChat start={result.request.start} end={result.request.end} signals={[result.request.overpass, result.request.overpass === "day" ? "night" : "day"].map(overpass =>
        pairedSignal(overpass, overpass === "day" ? "Daytime surface temperature" : "Nighttime surface temperature",
          "°C per decade", "NASA Terra MODIS MOD11A2", result.request.pair.map(name), result.district[overpass as Pass]))}/>
    </>}
  </section>;
}
