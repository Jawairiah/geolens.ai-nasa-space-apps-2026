import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Link,Navigate,NavLink,Route,Routes,useLocation} from 'react-router-dom';
import {Lenses} from './Lenses';
import {Landing} from './Landing';
import {Workspace} from './Workspace';
import {InspectionDemo} from './InspectionDemo';
import {Inspections} from './Inspections';
import {Projects} from './Projects';
import './style.css';
import './investigation.css';

function BackNavigation() {
  const {pathname, state, search} = useLocation();
  const lensPath = pathname.match(/^\/lenses\/([^/]+)\/[^/]+$/);
  const [to, label] = lensPath ? ['/lenses/' + lensPath[1] + search, 'lens overview'] : pathname.startsWith('/lenses/') ? ['/lenses', 'lenses']
    : pathname === '/' ? ['/lenses', 'lenses']
    : pathname === '/inspections/demo' && state?.evidence ? ['/lenses/land-cover-forest', 'land cover lens']
    : pathname === '/inspections' ? ['/inspections/demo', 'inspection demo']
    : ['/','home'];
  return <nav className="page-navigation" aria-label="Page navigation">
    <Link className="page-back" to={to} state={pathname === '/inspections' ? state : undefined}><span aria-hidden="true">←</span>Back to {label}</Link>
  </nav>;
}

function Method(){return <main className="workspace narrow"><div className="kicker">SCIENTIFIC METHOD</div><h1>How GeoLens works</h1><section className="panel prose"><h2>Two observation records</h2><p>GeoLens estimates seasonal-adjusted vegetation trends from Terra and Aqua MODIS monthly products on the same geographic grid. Comparisons are available once a satellite observation extract has been loaded.</p><h2>Paired analysis</h2><p>Compare area A and B on common months. GeoLens fits the trend in A minus B and estimates approximate uncertainty using calendar-lag autocorrelation correction.</p><h2>Evidence limits</h2><p>Discovered pairs are exploratory. Stress tests show sensitivity to quality and dates. Shared MODIS processing means cross-satellite agreement is supporting evidence.</p></section></main>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><header className="top"><Link className="brand" to="/"><span className="brand-mark" aria-hidden="true"><img src="/assets/geolens-logo.png" alt="" width={296} height={322}/></span>GeoLens</Link><nav aria-label="Main navigation"><NavLink to="/lenses">Lenses</NavLink><NavLink to="/inspections/demo">Inspection demo</NavLink><NavLink to="/method">Method</NavLink></nav><span className="top-tag">EARTH INTELLIGENCE</span></header><BackNavigation/><Routes><Route path="/" element={<Landing/>}/><Route path="/explore" element={<Navigate replace to="/lenses/land-cover-forest"/>}/><Route path="/lenses/land-cover-forest/:evidencePage?" element={<Workspace/>}/><Route path="/lenses" element={<Lenses/>}/><Route path="/lenses/:lensId/:evidencePage?" element={<Lenses/>}/><Route path="/projects" element={<Projects/>}/><Route path="/inspections/demo" element={<InspectionDemo/>}/><Route path="/inspections" element={<Inspections/>}/><Route path="/method" element={<Method/>}/><Route path="*" element={<main className="workspace"><h1>Page unavailable</h1><Link to="/">Return to GeoLens</Link></main>}/></Routes></BrowserRouter></React.StrictMode>);
