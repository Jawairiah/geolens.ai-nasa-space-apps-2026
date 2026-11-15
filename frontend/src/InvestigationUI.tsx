import {Link, useLocation} from 'react-router-dom';
import {useId, useState, type FormEventHandler, type ReactNode} from 'react';
import {EarthGraphic} from './ExploreMotion';
import {StudyMap} from './Map';
import {number, type Compare, type Metric, type Study} from './api';

export const lensContent = {
  'water-drought': {
    theme: 'water', name: 'Water & Drought Intelligence', question: 'Is Karachi getting drier?',
    description: 'Compare rainfall, seasonal anomalies, and modeled soil moisture and evapotranspiration across Karachi. The approximately 11 km rainfall grid limits fine-scale comparisons.',
    sources: ['NASA GPM IMERG Final V07', 'NASA GLDAS Noah v2.1'], coverage: 'Rainfall archive 2003–2024',
  },
  'urban-heat-growth': {
    theme: 'heat', name: 'Urban Heat & Growth Intelligence', question: 'Where is Karachi’s land surface warming?',
    description: 'Compare clear-sky day and night surface temperatures at about 1 km, and explore built-up, non-built, and greenness context.',
    sources: ['NASA Terra MODIS LST & NDVI', 'NASA MODIS MCD12Q1'], coverage: 'Surface temperature archive 2003–2024',
  },
  'land-cover-forest': {
    theme: 'forest', name: 'Land Cover & Forest Change', question: 'Where are greenness and tree canopy changing?',
    description: 'Compare vegetation greenness and tree canopy across Karachi’s historical districts.',
    sources: ['NASA Terra & Aqua MODIS NDVI', 'NASA MODIS MOD44B & MCD12Q1'], coverage: 'Study archive 2003–2024',
  },
} as const;

export function LensIntro({lens}: {lens: keyof typeof lensContent}) {
  const {search} = useLocation();
  const {name, question, description, sources, coverage} = lensContent[lens];
  return <header className="atlas-intro lens-intro">
    <div className="atlas-intro-copy">
      <span className="lens-name">{name}</span>
      <h1>{question}</h1>
      <p>{description}</p>
      <ul className="lens-source-list">
        {sources.map(source => <li key={source}>{source}</li>)}
        <li>{coverage}</li>
        <li><Link className="lens-source-entry" to={{pathname: "sources", search}}>Sources &amp; methods</Link></li>
      </ul>
    </div>
    <EarthGraphic/>
  </header>;
}

export function SetupStage({title, children}: {title: string; children: ReactNode}) {
  const id = useId();
  return <div className="setup-stage" role="group" aria-labelledby={id}>
    <h2 id={id}>{title}</h2>
    {children}
  </div>;
}

export function DistrictFields({study, pair, slot, busy, select}: {
  study?: Study; pair: string[]; slot: number; busy: boolean; select: (id: string, slot: number) => void;
}) {
  return <>
    <p>Choose below or select a district on the map to set <strong>District {slot === 0 ? 'A' : 'B'}</strong>.</p>
    <div className="district-selects lens-district-fields">{pair.map((id, index) => <label key={index}>
      <span><i aria-hidden="true" className={'district-dot dot-' + index}/> District {index === 0 ? 'A' : 'B'}</span>
      <select name={index === 0 ? 'first' : 'second'} disabled={busy || !study} value={study ? id : ''} onChange={event => select(event.target.value, index)}>
        {!study && <option value="">Awaiting districts</option>}
        {study?.regions.features.map(region =>
          <option key={region.id} value={region.id} disabled={region.id === pair[1 - index]}>{region.properties.name}</option>)}
      </select>
    </label>)}</div>
  </>;
}

export function LensSetup({study, busy, error, submit, action, initialPair, children}: {
  study?: Study; busy: boolean; error: string; submit: FormEventHandler<HTMLFormElement>; action: string; initialPair?: string[]; children: ReactNode;
}) {
  const [pair, setPair] = useState(initialPair ?? ['PK702', 'PK714']);
  const [slot, setSlot] = useState(0);
  function select(id: string, index: number) {
    if (busy || pair[index] === id) return;
    setPair(pair.includes(id) ? [pair[1], pair[0]] : pair.map((current, i) => i === index ? id : current));
    setSlot(1 - index);
  }
  return <div className="investigation-grid lens-grid">
    <div className="atlas-map-column">
      {study ? <StudyMap study={study} trends={{}} pair={pair} busy={busy} select={id => select(id, slot)}/>
        : <div className="atlas-map-placeholder" role="status">{error ? 'District map unavailable' : 'Loading district map…'}</div>}
      {study?.manifest.boundary_note && <p className="atlas-boundary">{study.manifest.boundary_note}</p>}
    </div>
    <form className="panel setup lens-setup" onSubmit={submit}>
      <SetupStage title="Select districts"><DistrictFields study={study} pair={pair} slot={slot} busy={busy} select={select}/></SetupStage>
      <SetupStage title="Configure observations">{children}</SetupStage>
      <SetupStage title="Run investigation">
        <button className="primary" disabled={busy || !study}>{busy ? 'Analyzing…' : action}</button>
        <p className="sr-only" role="status">{busy && 'Retrieving and comparing observations.'}</p>
      </SetupStage>
    </form>
  </div>;
}

export function FindingsSummary({start, end, items}: {
  start: number; end: number; items: {label: string; value: number | null; unit: string; detail?: string}[];
}) {
  return <section className="panel lens-findings" aria-label="Key findings">
    <h2>Key findings <span>{start}–{end}</span></h2>
    <dl>{items.map(({label, value, unit, detail}) => <div key={label}>
      <dt>{label}</dt><dd><strong>{value == null ? 'Unavailable' : number(value)}</strong>
      {value != null && <span>{unit}</span>}{detail && <small>{detail}</small>}</dd>
    </div>)}</dl>
  </section>;
}

export function trendFinding(label: string, metric: Metric, unit: string) {
  return {label, value: metric.slope, unit, detail: metric.interval ? 'Approx. 95% interval ' + metric.interval.map(number).join(' to ') : 'Approx. 95% interval unavailable'};
}

type MonthlySignal = {id: string; label: string; source: string; unit: string; result: Compare};

export function MonthlyHistory({signals, names, start, end}: {
  signals: MonthlySignal[]; names: string[]; start: number; end: number;
}) {
  const [selected, setSelected] = useState(signals[0].id);
  const [monthIndex, setMonthIndex] = useState<number>();
  const signal = signals.find(item => item.id === selected) ?? signals[0];
  const {series} = signal.result;
  const observation = series[monthIndex ?? series.length - 1];
  const values = series.flatMap(([, a, b]) => [a, b]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const min = lo === hi ? lo - 1 : lo;
  const max = lo === hi ? hi + 1 : hi;
  const x = (month: number) => 68 + 660 * (month - (start - 2003) * 12) / ((end - start + 1) * 12 - 1);
  const y = (value: number) => 168 - 148 * (value - min) / (max - min);
  const date = (month: number) => (2003 + Math.floor(month / 12)) + '-' + String(1 + month % 12).padStart(2, '0');
  const path = (index: 1 | 2) => series.map((row, i) => (i && series[i - 1][0] === row[0] - 1 ? 'L' : 'M') + x(row[0]) + ' ' + y(row[index])).join(' ');
  return <section className="panel lens-history" aria-label="Historical trends">
    <div className="lens-history-head">
      <div><h2>Historical observations</h2><p>{signal.source} · {start}–{end} · {series.length} shared months · {signal.unit}</p></div>
      {signals.length > 1 && <label>Chart variable<select value={signal.id} onChange={event => {
        setSelected(event.target.value);
        setMonthIndex(undefined);
      }}>{signals.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>}
    </div>
    {observation ? <>
      <div className="lens-chart-scroll" tabIndex={0} role="region" aria-label="Monthly observation chart">
        <svg viewBox="0 0 760 205" role="img" aria-label={signal.label + ' in ' + signal.unit + ' for ' + names.join(' and ')}>
          {[min, (min + max) / 2, max].map(value => <g key={value}>
            <path d={'M68 ' + y(value) + 'H728'} className="lens-chart-grid"/>
            <text x="61" y={y(value) + 4} textAnchor="end">{value.toLocaleString(undefined, {maximumFractionDigits: 2})}</text>
          </g>)}
          <text x="68" y="192">{start}</text><text x="728" y="192" textAnchor="end">{end}</text>
          {([1, 2] as const).map(index => <path key={index} d={path(index)} className={'lens-chart-series series-' + index}/>)}
          <path d={'M' + x(observation[0]) + ' 20V168'} className="lens-chart-grid"/>
          {([1, 2] as const).map(index => <circle key={index} cx={x(observation[0])} cy={y(observation[index])} r="5" className={'series-' + index}/>)}
        </svg>
      </div>
      <div className="lens-chart-readout">
        <label>Inspect month<select value={observation[0]} onChange={event => setMonthIndex(series.findIndex(([month]) => month === Number(event.target.value)))}>
          {series.map(([month]) => <option key={month} value={month}>{date(month)}</option>)}
        </select></label>
        {names.map((name, index) => <p key={name}><i aria-hidden="true" className={'district-dot dot-' + index}/> {name} <strong>{observation[index + 1].toFixed(2)} {signal.unit}</strong></p>)}
      </div>
    </> : <p>No matched monthly values are available for this variable in the selected period.</p>}
  </section>;
}
