import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {EarthGraphic} from './ExploreMotion';
import {request} from './api';

type LensCard = {id: string; name: string; question: string};
type Point = [number, number];
type Preview = {region: string; start: number; end: number; series: Record<string, Point[]>};
const topics: Record<string, {name: string; description: string; metric: string; unit: string; source: string}> = {
  'water-drought': {
    name: 'Water & Drought',
    description: 'Compare rainfall, soil moisture and evapotranspiration. See how a season compares with the historical baseline.',
    metric: 'Annual precipitation', unit: 'mm', source: 'NASA GPM IMERG',
  },
  'urban-heat-growth': {
    name: 'Urban Heat & Growth',
    description: 'Compare daytime and nighttime surface warming, then examine the heat gap between built-up and non-built land.',
    metric: 'Annual mean daytime surface temperature', unit: '°C', source: 'NASA Terra MODIS MOD11A2',
  },
  'land-cover-forest': {
    name: 'Land Cover & Forest Change',
    description: 'Compare satellite greenness trends with annual tree-canopy estimates across Karachi’s districts.',
    metric: 'Annual tree canopy', unit: '%', source: 'NASA Terra MODIS MOD44B',
  },
};

function PreviewChart({points, start, end, label, unit}: {points: Point[]; start: number; end: number; label: string; unit: string}) {
  const values = points.map(([, value]) => value);
  const floor = Math.min(...values);
  const ceiling = Math.max(...values);
  const step = Math.pow(10, Math.floor(Math.log10((ceiling - floor || 1) / 2)));
  const low = Math.floor(floor / step) * step;
  const high = Math.max(low + step, Math.ceil(ceiling / step) * step);
  const format = new Intl.NumberFormat('en', {maximumFractionDigits: 3});
  const x = (year: number) => 43 + 259 * (year - start) / (end - start);
  const y = (value: number) => 96 - 78 * (value - low) / (high - low);
  const [lastYear, lastValue] = points[points.length - 1];
  return <svg className="lens-chart" viewBox="0 0 316 123" role="img"
    aria-label={`${label}. ${points.length} complete years. ${lastYear}: ${format.format(lastValue)} ${unit}.`}>
    {[high, (high + low) / 2, low].map((tick, index) => <g key={tick}>
      <line x1="43" x2="302" y1={y(tick)} y2={y(tick)}/>
      {index !== 1 && <text x="36" y={y(tick) + 3} textAnchor="end">{format.format(tick)}</text>}
    </g>)}
    <text x="43" y="117">{start}</text><text x="302" y="117" textAnchor="end">{end}</text>
    <path d={points.map(([year, value], index) =>
      (points[index - 1]?.[0] === year - 1 ? 'L' : 'M') + x(year) + ' ' + y(value)).join(' ')}/>
    {points.map(([year, value]) => <circle key={year} cx={x(year)} cy={y(value)} r={year === lastYear ? 3.4 : 1.6}/>)}
  </svg>;
}

export function LensOverview({items}: {items: LensCard[]}) {
  const [preview, setPreview] = useState<Preview>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    request<Preview>('/lenses/previews')
      .then(data => { if (active) setPreview(data); })
      .catch(() => {}) // The investigation links remain usable if preview data cannot load.
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <div className="lens-index">
    {items.map(lens => {
      const topic = topics[lens.id];
      const points = preview?.series[lens.id] ?? [];
      const latest = points.at(-1);
      return <Link className={`lens-card lens-card--${lens.id}`} to={lens.id} key={lens.id}>
        <div className="lens-card-copy">
          <h2>{topic?.name ?? lens.name}</h2>
          <p className="lens-question">{lens.question}</p>
          {topic && <p>{topic.description}</p>}
        </div>
        {topic && <figure className="lens-preview">
          <figcaption><strong>{topic.metric} ({topic.unit})</strong>
            <span>{preview?.region ?? 'Malir'} · {topic.source}</span>
            {latest && <span className="lens-latest">{latest[0]}: {latest[1].toLocaleString('en', {maximumFractionDigits: 2})} {topic.unit}</span>}</figcaption>
          {preview && points.length > 1 ? <PreviewChart points={points} start={preview.start} end={preview.end}
            label={`${preview.region} ${topic.metric.toLowerCase()}`} unit={topic.unit}/>
            : <p className="lens-preview-state">{loading ? 'Loading annual data…' : 'Annual preview unavailable'}</p>}
        </figure>}
        <span className="lens-card-open">Open investigation <i aria-hidden="true"/></span>
      </Link>;
    })}
  </div>;
}

export function LensOverviewHeader() {
  return <header className="lens-overview-hero">
    <div className="lens-overview-intro">
      <h1>Investigation lenses</h1>
      <p>Explore how water, heat, and vegetation are changing across Karachi’s historical districts. Choose a lens to compare trends and ask what the evidence shows.</p>
    </div>
    <EarthGraphic/>
  </header>;
}
