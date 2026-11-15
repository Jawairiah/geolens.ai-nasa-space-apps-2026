import {lazy, Suspense, useState} from 'react';
import {Link} from 'react-router-dom';
import './landing-guide.css';

const Globe = lazy(() => import('./Globe').then(module => ({default: module.Globe})));

const uses = [
  {
    title: 'Water teams and communities',
    link: '/lenses/water-drought',
    label: 'Open Water & Drought',
    text: 'Check whether the monsoon was wetter or drier than usual. Water planners can use the historical comparison alongside local drainage records and reports of water stress.',
  },
  {
    title: 'Residents and city planners',
    link: '/lenses/urban-heat-growth',
    label: 'Open Urban Heat & Growth',
    text: 'See where land surfaces have warmed and where built-up areas differ from nearby non-built land. Use those patterns to prioritize local checks for shade and cooling needs.',
  },
  {
    title: 'Parks teams and community groups',
    link: '/lenses/land-cover-forest',
    label: 'Open Land Cover & Forest Change',
    text: 'Compare vegetation greenness with tree-canopy estimates. Parks staff and community groups can use the evidence to decide which areas deserve a closer look or a field visit.',
  },
];

export function Landing() {
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [offset, setOffset] = useState(0);

  return <main className="landing">
    <div className="stars" aria-hidden="true"/>
    <div className="hero">
      <div className="hero-copy">
        <h1>See how Karachi’s <em>environment is changing.</em></h1>
        <p>Use NASA Earth observation data to investigate rainfall, surface heat, and vegetation across six historical Karachi districts.</p>
        <div className="actions">
          <Link className="primary" to="/lenses">Start an investigation</Link>
          <a className="outline" href="#karachi-benefits">How it helps Karachi</a>
        </div>
        <p className="landing-access">The three lenses are open to everyone. No account required.</p>
      </div>
      <div className={'orbital ' + (playing ? '' : 'paused')}>
        <div className="earth-wrap">
          <Suspense fallback={<div className="earth" aria-hidden="true"/>}><Globe playing={playing} offset={offset}/></Suspense>
          <div className="orbit"><i/></div><div className="orbit orbit-two"><i/></div>
        </div>
        <div className="globe-controls">
          <button type="button" aria-label="Rotate Earth west" onClick={() => setOffset(value => value - 24)}>←</button>
          <button type="button" onClick={() => setPlaying(!playing)}>{playing ? 'Pause motion' : 'Resume motion'}</button>
          <button type="button" aria-label="Rotate Earth east" onClick={() => setOffset(value => value + 24)}>→</button>
        </div>
        <a href="https://science.nasa.gov/resource/blue-marble/">Earth imagery · NASA Blue Marble</a>
      </div>
    </div>

    <section className="landing-guide" aria-labelledby="landing-workflow">
      <div><h2 id="landing-workflow">From a question to evidence</h2>
        <p>Choose a lens and compare two districts. Then ask GeoLens what changed, where it changed, how much it changed, and whether the change is statistically significant.</p>
        <Link to="/method">Read the method</Link>
      </div>
      <div className="landing-evidence">
        <h3>Check the result yourself</h3>
        <p>Every comparison shows its data source and uncertainty. Download the evidence to share the finding or review the original values.</p>
        <Link to="/inspections/demo">Try a practice inspection</Link>
      </div>
    </section>

    <section className="landing-benefits" id="karachi-benefits" aria-labelledby="landing-audiences">
      <h2 id="landing-audiences">How Karachi can use GeoLens</h2>
      <div className="landing-use-list">
        {uses.map(use => <article key={use.link}><h3>{use.title}</h3><p>{use.text}</p><Link to={use.link}>{use.label}</Link></article>)}
      </div>
      <p className="landing-scope">GeoLens provides historical, district-scale evidence. For a street, park, or individual site, combine these trends with local observations and records.</p>
    </section>
  </main>;
}
