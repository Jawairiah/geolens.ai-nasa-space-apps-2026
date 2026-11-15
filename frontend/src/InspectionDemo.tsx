import {useEffect, useState, type FormEvent} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {download, number, request, type Evidence, type Study} from './api';
import './inspections.css';

type Role = 'reviewer' | 'inspector';
type Stage = 'review' | 'assigned' | 'submitted' | 'closed';
type Event = {role: Role; title: string; note: string};
type DemoCase = {stage: Stage; site?: string; events: Event[]};

const stages: Record<Stage, string> = {
  review: 'Ready to assign', assigned: 'Visit assigned', submitted: 'Practice notes submitted', closed: 'Demo case closed',
};

export function InspectionDemo() {
  const selected = useLocation().state?.evidence as Evidence | undefined;
  const [evidence, setEvidence] = useState<Evidence>();
  const [study, setStudy] = useState<Study>();
  const [role, setRole] = useState<Role>('reviewer');
  const [demo, setDemo] = useState<DemoCase>();
  const [error, setError] = useState('');
  const [attempt, retry] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    Promise.all([
      request<Study>('/study'),
      selected ?? request<Evidence>('/compare?reveal=true', {pair: ['PK702', 'PK714'], start: 2003, end: 2024, quality: 'standard'}),
    ]).then(([metadata, report]) => {
      if (!active) return;
      setStudy(metadata);
      setEvidence(report);
    }).catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [selected, attempt]);

  function addEvent(stage: Stage, title: string, note: string, site?: string) {
    setDemo(previous => ({stage, site: site ?? previous?.site, events: [...(previous?.events ?? []), {role, title, note}]}));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const note = String(fields.get('note') ?? '').trim();
    if (!note) return;
    if (!demo && role === 'reviewer') addEvent('review', 'Case opened', note);
    if (demo?.stage === 'review' && role === 'reviewer') {
      const site = String(fields.get('site') ?? '').trim();
      if (site) {
        addEvent('assigned', 'Practice visit assigned', note, site);
        setRole('inspector');
      }
    }
    if (demo?.stage === 'assigned' && role === 'inspector') {
      addEvent('submitted', 'Practice notes submitted', note);
      setRole('reviewer');
    }
    if (demo?.stage === 'submitted' && role === 'reviewer') {
      const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
      if (action === 'return') {
        addEvent('assigned', 'Returned for follow-up', note);
        setRole('inspector');
      } else {
        addEvent('closed', 'Demo case closed', note);
      }
    }
  }

  const names = evidence?.request.pair.map(id => study?.regions.features.find(region => region.id === id)?.properties.name ?? id);
  const trend = evidence?.runs[0]?.terra.delta;
  const isReviewer = role === 'reviewer';
  const canAct = demo?.stage === 'assigned' ? !isReviewer : demo?.stage !== 'closed' && isReviewer;
  return <main className="workspace inspection-workspace demo-workspace">
    <header className="inspection-header">
      <div><h1>Inspection demo</h1><p>See how a satellite finding can become a field follow-up.</p></div>
    </header>
    <p className="demo-notice">This practice case uses real satellite results. Practice notes stay in this browser tab and clear when you leave the demo.</p>
    {error && <p className="message" role="alert">{error} <button type="button" className="text-button" onClick={() => retry(attempt + 1)}>Retry</button></p>}
    {!evidence && !error && <p role="status">Loading the satellite comparison…</p>}
    {evidence && <div className="inspection-grid demo-grid">
      <aside className="panel inspection-list demo-evidence">
        <h2>Satellite evidence</h2>
        <strong>{names?.join(' and ')}</strong>
        <p>{evidence.request.start}–{evidence.request.end} · {evidence.manifest.name}</p>
        {trend?.slope != null && <p>Terra trend difference (first district minus second): <strong>{number(trend.slope)} NDVI points per decade</strong> over {trend.months} shared months.</p>}
        <button className="text-button" type="button" onClick={() => download(evidence)}>Download satellite evidence JSON</button>
        <Link to="/inspections" state={{evidence}}>Staff sign-in</Link>
      </aside>
      <section className="panel inspection-case">
        <div className="demo-controls" role="group" aria-label="Demo role">
          {(['reviewer', 'inspector'] as const).map(item =>
            <button className={role === item ? 'primary' : 'outline'} type="button" key={item}
              aria-pressed={role === item} onClick={() => setRole(item)}>{item === 'reviewer' ? 'Demo reviewer' : 'Demo inspector'}</button>)}
        </div>
        <p role="status">{demo ? stages[demo.stage] : 'No practice case yet'}</p>
        {demo?.site && <p><strong>Practice site</strong> · {demo.site}</p>}
        {canAct ? <form className="project-form" key={role + (demo?.stage ?? 'new')} onSubmit={submit}>
          <h2>{!demo ? 'Open a practice case' : demo.stage === 'review' ? 'Assign a practice visit' : demo.stage === 'assigned' ? 'Submit practice notes' : 'Review the practice notes'}</h2>
          {demo?.stage === 'review' && <label>Practice site<input name="site" required maxLength={180}/></label>}
          <label>{!demo ? 'What should the inspector verify?' : demo.stage === 'review' ? 'Visit instructions' : demo.stage === 'assigned' ? 'Practice field observations' : 'Practice decision or follow-up instructions'}
            <textarea name="note" required maxLength={1200} rows={3}/></label>
          <div className="inspection-actions">
            <button className="primary" value="advance">{!demo ? 'Open practice case' : demo.stage === 'review' ? 'Assign visit' : demo.stage === 'assigned' ? 'Submit practice notes' : 'Close practice case'}</button>
            {demo?.stage === 'submitted' && <button className="outline" value="return">Return for follow-up</button>}
          </div>
        </form> : demo?.stage !== 'closed' && <p>{isReviewer ? 'Switch to the demo inspector to submit practice notes.' : 'Switch to the demo reviewer to open, assign or review the case.'}</p>}
        {demo && <><h3>Practice activity</h3><ol className="inspection-events">{demo.events.map((entry, index) =>
          <li key={index}><strong>{entry.title} · Demo {entry.role}</strong><p>{entry.note}</p></li>)}</ol>
          <button className="text-button" type="button" onClick={() => {setDemo(undefined); setRole('reviewer');}}>Reset practice case</button></>}
      </section>
    </div>}
  </main>;
}
