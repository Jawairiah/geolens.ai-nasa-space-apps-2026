import {useEffect, useRef, useState, type ReactNode, type ComponentProps} from 'react';
import {Link, NavLink, useLocation, useParams} from 'react-router-dom';
import {lensContent} from './InvestigationUI';

const pages = [
  {id: 'trends', title: 'Trend estimates', description: 'Charts, trend rates, and uncertainty'},
  {id: 'observations', title: 'Observation records', description: 'Monthly and annual values, quality, and downloads'},
  {id: 'sources', title: 'Sources & methods', description: 'Dataset links, coverage, and analysis methods'},
] as const;

export type ComparisonContext = {pair: string[]; start: number; end: number};
type SavedSelection = ComparisonContext & {option: string};

export function useEvidencePage() {
  const {evidencePage} = useParams();
  return pages.find(page => page.id === evidencePage);
}

export function readSelection(search: string): SavedSelection | undefined {
  const query = new URLSearchParams(search);
  const pair = query.getAll('district');
  const start = Number(query.get('start'));
  const end = Number(query.get('end'));
  if (pair.length !== 2 || new Set(pair).size !== 2 || pair.some(id => !/^PK\d{3}$/.test(id)) ||
      !Number.isInteger(start) || !Number.isInteger(end) || start < 2003 || end > 2024 || end < start) return;
  return {pair, start, end, option: query.get('option') ?? ''};
}

// Restore shareable evidence links while keeping an already loaded comparison in memory.
export function useLinkedEvidence<T>(value: T | undefined, identify: (value: T) => SavedSelection,
    restore: (selection: SavedSelection, cancelled: () => boolean) => void) {
  const {search} = useLocation();
  const current = useRef({value, identify, restore});
  current.current = {value, identify, restore};
  useEffect(() => {
    const selection = readSelection(search);
    if (!selection) return;
    const {value, identify, restore} = current.current;
    if (value && selectionKey(identify(value)) === selectionKey(selection)) return;
    let cancelled = false;
    restore(selection, () => cancelled);
    return () => { cancelled = true; };
  }, [search]);
}

function selectionKey({pair, start, end, option}: SavedSelection) {
  return new URLSearchParams([['district', pair[0]], ['district', pair[1]], ['start', String(start)], ['end', String(end)], ['option', option]]).toString();
}

export function EvidenceLinks({selection}: {selection: SavedSelection}) {
  return <section className="evidence-links" aria-label="Explore comparison evidence">
    <h2>Explore the evidence</h2>
    <div>{pages.map(page => <Link key={page.id} to={{pathname: page.id, search: '?' + selectionKey(selection)}}>
      <strong>{page.title} <span aria-hidden="true">↗</span></strong><span>{page.description}</span>
    </Link>)}</div>
  </section>;
}

export function EvidenceHeader({lens, context, names, setting}: {
  lens: keyof typeof lensContent; context?: ComparisonContext; names?: string[]; setting?: string;
}) {
  const page = useEvidencePage();
  const {search, pathname} = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus({preventScroll: true});
  }, [pathname]);
  const path = '/lenses/' + lens;
  return <header className="evidence-heading">
    <p className="lens-name">{lensContent[lens].name}</p>
    <h1 tabIndex={-1} ref={heading}>{page?.title ?? 'Evidence page unavailable'}</h1>
    {context && <p className="evidence-context">{names?.join(' vs ')} <span>{context.start}–{context.end}{setting && ' · ' + setting}</span></p>}
    <nav aria-label="Comparison pages">
      <NavLink end to={{pathname: path, search}}>Overview</NavLink>
      {pages.map(item => <NavLink key={item.id} to={{pathname: path + '/' + item.id, search}}>{item.title}</NavLink>)}
    </nav>
  </header>;
}

export function EvidenceSection({title, children}: {title: string; children: ReactNode}) {
  return <section className="panel evidence-block"><h2>{title}</h2>{children}</section>;
}

export function EvidencePending({busy, error}: {busy: boolean; error?: string}) {
  return <p className="panel evidence-block" role={error ? 'alert' : 'status'}>
    {error || (busy ? 'Loading comparison evidence…' : 'Run a comparison from the Overview to open the evidence for your selected districts.')}
  </p>;
}

export function RecordsTable({headings, rows, title}: {
  headings: string[]; rows: {key: string; date: string; cells: ReactNode[]}[]; title: string;
}) {
  const [year, setYear] = useState('');
  const [index, setIndex] = useState(0);
  const years = Array.from(new Set(rows.map(row => row.date.slice(0, 4)))).sort();
  const filtered = year ? rows.filter(row => row.date.startsWith(year)) : rows;
  const pageSize = 12;
  const last = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const page = Math.min(index, last);
  return <>
    <div className="record-controls">
      <label>Year <select value={year} onChange={event => {setYear(event.target.value); setIndex(0);}}>
        <option value="">All years</option>{years.map(value => <option key={value}>{value}</option>)}
      </select></label>
      {filtered.length > 0 && <span role="status">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length} records</span>}
    </div>
    {filtered.length ? <div className="evidence-table" tabIndex={0} role="region" aria-label={title}>
      <table><thead><tr>{headings.map(heading => <th scope="col" key={heading}>{heading}</th>)}</tr></thead>
      <tbody>{filtered.slice(page * pageSize, (page + 1) * pageSize).map(row =>
        <tr key={row.key}>{row.cells.map((cell, column) => column === 0 ? <th scope="row" key={column}>{cell}</th> : <td key={column}>{cell}</td>)}</tr>)}</tbody></table>
    </div> : <p>No observation records are available for this selection.</p>}
    {last > 0 && <div className="record-controls record-pagination">
      <button className="outline" type="button" disabled={page === 0} onClick={() => setIndex(page - 1)}>Previous records</button>
      <button className="outline" type="button" disabled={page === last} onClick={() => setIndex(page + 1)}>Next records</button>
    </div>}
  </>;
}

export function observationMonth(month: number) {
  return (2003 + Math.floor(month / 12)) + '-' + String(month % 12 + 1).padStart(2, '0');
}

type RecordGroup = ComponentProps<typeof RecordsTable>;
export function ObservationCollection({groups}: {groups: RecordGroup[]}) {
  const [selected, setSelected] = useState(groups[0].title);
  const group = groups.find(item => item.title === selected) ?? groups[0];
  return <EvidenceSection title="Browse observations">
    <label className="record-dataset">Dataset <select value={group.title} onChange={event => setSelected(event.target.value)}>
      {groups.map(item => <option key={item.title}>{item.title}</option>)}
    </select></label>
    <RecordsTable {...group} key={group.title}/>
  </EvidenceSection>;
}
