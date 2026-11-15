import {useEffect, useState, type FormEvent} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {download, request, type Evidence} from './api';
import './inspections.css';

type CaseStatus = 'review' | 'assigned' | 'submitted' | 'closed';
type CaseRow = {id: number; title: string; status: CaseStatus; inspector: string | null};
type CaseDetail = CaseRow & {
  revision: number;
  site: string | null;
  evidence: Evidence;
  events: {id: number; created_at: string; actor: string; action: string; note: string}[];
};
type Queue = {role: 'reviewer' | 'inspector'; username: string; cases: CaseRow[]; inspectors: string[]};
const labels: Record<CaseStatus, string> = {review: 'In review', assigned: 'Assigned', submitted: 'Field evidence submitted', closed: 'Closed'};

export function Inspections() {
  const draft = useLocation().state?.evidence as Evidence | undefined;
  const [token, setToken] = useState('');
  const [queue, setQueue] = useState<Queue>();
  const [selected, setSelected] = useState<CaseDetail>();
  const [draftOpen, setDraftOpen] = useState(!!draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Clear previous errors when navigating here with a different comparison.
    setDraftOpen(!!draft);
    setError('');
  }, [draft]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await task(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function loadQueue(session: string) {
    setQueue(await request<Queue>('/inspections', undefined, session));
  }

  async function openCase(id: number, session = token) {
    setSelected(await request<CaseDetail>('/inspections/' + id, undefined, session));
  }

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      const session = await request<{token: string}>('/auth/login', {
        username: form.get('username'), password: form.get('password'),
      });
      await loadQueue(session.token);
      setToken(session.token);
    });
  }

  function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const form = new FormData(event.currentTarget);
    void run(async () => {
      const result = await request<{id: number}>('/inspections', {
        ...draft.request, source_version: draft.manifest.version,
        title: form.get('title'), question: form.get('question'),
      }, token);
      setDraftOpen(false);
      await openCase(result.id);
      await loadQueue(token);
    });
  }

  function updateCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const form = new FormData(event.currentTarget);
    const action = submitter?.value ?? form.get('action');
    void run(async () => {
      await request('/inspections/' + selected.id + '/actions', {
        action, note: form.get('note'), inspector: form.get('inspector'),
        site: form.get('site'), revision: selected.revision,
      }, token);
      await openCase(selected.id);
      await loadQueue(token);
    });
  }

  return <main className="workspace inspection-workspace">
    <header className="inspection-header">
      <div><h1>Inspections</h1><p>Review satellite evidence, assign field visits, and record outcomes.</p></div>
      {queue && <div className="inspection-account"><span>{queue.username} · {queue.role}</span>
        <button className="outline" disabled={busy} onClick={() => {setToken(''); setQueue(undefined); setSelected(undefined); setError('');}}>Sign out</button></div>}
    </header>
    {error && <p className="message" role="alert">{error}</p>}
    {!queue ? <form className="panel project-form inspection-signin" onSubmit={signIn}>
      <h2>Sign in</h2>
      <p>Inspection access is granted by a GeoLens administrator.</p>
      <label>Username<input name="username" autoComplete="username" required/></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required/></label>
      <button className="primary" disabled={busy}>Sign in</button>
    </form> : <div className="inspection-grid">
      <aside className="panel inspection-list">
        <h2>{queue.role === 'reviewer' ? 'Review queue' : 'My assignments'}</h2>
        {queue.cases.length ? queue.cases.map(item =>
          <button key={item.id} type="button" aria-pressed={selected?.id === item.id} disabled={busy}
            onClick={() => {setDraftOpen(false); void run(() => openCase(item.id));}}>
            <strong>{item.title}</strong><span>{labels[item.status]}</span>
          </button>) : <p>No cases yet.</p>}
        {queue.role === 'reviewer' && <Link to="/lenses/land-cover-forest">Find vegetation evidence</Link>}
      </aside>
      <div className="inspection-detail">
        {draftOpen && queue.role === 'reviewer' && <form className="panel project-form" onSubmit={createCase}>
          <h2>Open an inspection case</h2>
          <p>Attach the {draft?.request.start}–{draft?.request.end} MODIS comparison. A district trend can identify an area for review. Select a specific field site before assigning a visit.</p>
          <label>Case title<input name="title" maxLength={120} required/></label>
          <label>What should the field team verify?<textarea name="question" rows={3} maxLength={2000} required/></label>
          <button className="primary" disabled={busy}>Open case</button>
        </form>}
        {draftOpen && queue.role === 'inspector' && <p>Reviewers open cases. Select one of your assignments to submit field evidence.</p>}
        {selected && !draftOpen && <article className="panel inspection-case">
          <header><div><h2>{selected.title}</h2><p>{labels[selected.status]}{selected.inspector && ' · ' + selected.inspector}</p></div>
            <button className="outline" type="button" disabled={busy} onClick={() => void run(() => openCase(selected.id))}>Refresh case</button>
          </header>
          <p>{selected.evidence.manifest.name} · {selected.evidence.request.start}–{selected.evidence.request.end}</p>
          {selected.site && <p><strong>Field site</strong> {selected.site}</p>}
          <button className="text-button" type="button" onClick={() => download(selected.evidence)}>Download original comparison JSON</button>
          <h3>Activity</h3>
          <ol className="inspection-events">{selected.events.map(event => <li key={event.id}>
            <strong>{event.action[0].toUpperCase() + event.action.slice(1)} · {event.actor}</strong>
            <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
            <p>{event.note}</p>
          </li>)}</ol>
          {queue.role === 'reviewer' && selected.status === 'review' && (queue.inspectors.length ?
            <form className="project-form" key={selected.revision} onSubmit={updateCase}>
              <h3>Assign a field visit</h3>
              <label>Inspector<select name="inspector" required defaultValue=""><option value="" disabled>Select an inspector</option>{queue.inspectors.map(name => <option key={name}>{name}</option>)}</select></label>
              <label>Field site or coordinates<input name="site" maxLength={500} required/></label>
              <label>Field instructions<textarea name="note" rows={3} maxLength={4000} required/></label>
              <button name="action" value="assigned" className="primary" disabled={busy}>Assign visit</button>
            </form> : <p>An administrator must grant inspector access before you can assign this case.</p>)}
          {queue.role === 'inspector' && selected.status === 'assigned' && <form className="project-form" key={selected.revision} onSubmit={updateCase}>
            <h3>Submit field evidence</h3>
            <label>Visit date, observations, and evidence references<textarea name="note" rows={4} maxLength={4000} required/></label>
            <button name="action" value="submitted" className="primary" disabled={busy}>Submit evidence</button>
          </form>}
          {queue.role === 'reviewer' && selected.status === 'submitted' && <form className="project-form" key={selected.revision} onSubmit={updateCase}>
            <h3>Review field evidence</h3>
            <label>Outcome or follow-up instructions<textarea name="note" rows={4} maxLength={4000} required/></label>
            <div className="inspection-actions"><button name="action" value="closed" className="primary" disabled={busy}>Close case</button>
              <button name="action" value="returned" className="outline" disabled={busy}>Return for follow-up</button></div>
          </form>}
        </article>}
        {!draftOpen && !selected && <p>Select a case to see its supporting evidence and activity.</p>}
      </div>
    </div>}
  </main>;
}
