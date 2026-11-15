import {useId, useState} from 'react';
import type {Compare} from './api';
import './challenge-chat.css';

const prompts = [
  'What is changing?',
  'Where is it changing?',
  'How much is it changing?',
  'Is the change statistically significant?',
] as const;

type Estimate = {slope: number | null; interval: [number, number] | null};
type Finding = {name: string; metric: Estimate; count: string};
type Signal = {id: string; name: string; unit: string; source: string; districts: Finding[]; gap?: Finding};

export function pairedSignal(id: string, name: string, unit: string, source: string, names: string[], result: Compare): Signal {
  const observation = (label: string, metric: Compare['left']): Finding =>
    ({name: label, metric, count: `${metric.months} shared months`});
  return {id, name, unit, source, districts: [observation(names[0], result.left), observation(names[1], result.right)],
    gap: observation(`${names[0]} minus ${names[1]}`, result.delta)};
}

const decimal = new Intl.NumberFormat('en', {maximumSignificantDigits: 4});
function value(n: number) {
  return (n > 0 ? '+' : '') + decimal.format(n);
}
function significant(interval: Estimate['interval']) {
  return !!interval && (interval[0] > 0 || interval[1] < 0);
}

function describe({metric, count}: Finding, index: number, unit: string) {
  const {slope, interval} = metric;
  if (slope === null) return 'Trend unavailable · ' + count;
  if (index === 2) return `${value(slope)} ${unit} · ${count}`;
  if (index === 3) {
    const conclusion = interval ? significant(interval) ? 'Yes at the approximate 95% level' : 'Inconclusive at the approximate 95% level' : 'Interval unavailable';
    return interval ? `${conclusion} · ${value(interval[0])} to ${value(interval[1])} ${unit}` : conclusion;
  }
  if (slope === 0) return 'Estimated trend is flat';
  return `Estimated ${slope > 0 ? 'increase' : 'decrease'}${significant(interval) ? '' : ' · direction uncertain'}`;
}

export function ChallengeChat({signals, start, end}: {signals: Signal[]; start: number; end: number}) {
  const title = useId();
  const [selection, setSelection] = useState('');
  const [question, setQuestion] = useState<number>();
  const signal = signals.find(item => item.id === selection) ?? signals[0];
  const rows = signal.gap && question !== undefined && question >= 2 ? [...signal.districts, signal.gap] : signal.districts;
  const intros = [
    `The comparison estimates trends in ${signal.name.toLowerCase()} over ${start}–${end}.`,
    'Here is the estimated direction in each selected historical Karachi district.',
    'These are fitted rates per decade. The district gap, where available, is the first district’s rate minus the second’s.',
    'An approximate 95% interval that excludes zero indicates statistical significance for that estimate. These intervals are pointwise and exploratory.',
  ];
  return <section className="challenge-chat" aria-labelledby={title}>
    <header className="challenge-head">
      <span className="challenge-orbit" aria-hidden="true"><i/></span>
      <div><h2 id={title}>Ask about this comparison</h2><p>Four NASA challenge questions, answered from your selected data.</p></div>
    </header>
    <div className="challenge-body">
      <div className="challenge-prompts">
        {signals.length > 1 && <label className="challenge-source">Evidence to discuss
          <select value={signal.id} onChange={event => {setSelection(event.target.value); setQuestion(undefined);}}>
            {signals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>}
        <div role="group" aria-label="NASA challenge questions">
          {prompts.map((prompt, index) => <button key={prompt} type="button" aria-pressed={question === index} onClick={() => setQuestion(index)}>{prompt}</button>)}
        </div>
      </div>
      <div className="challenge-conversation" aria-live="polite" aria-atomic="true">
        {question === undefined ? <div className="challenge-welcome">
          <span className="challenge-speaker">GeoLens</span>
          <p>Choose a question to see what the evidence says about {signal.name.toLowerCase()}.</p>
        </div> : <div className="challenge-exchange" key={signal.id + question}>
          <p className="challenge-user">{prompts[question]}</p>
          <div className="challenge-reply">
            <span className="challenge-speaker">GeoLens</span>
            <p>{intros[question]}</p>
            <dl>{rows.map(row => <div key={row.name}><dt>{row.name}</dt><dd>{describe(row, question, signal.unit)}</dd></div>)}</dl>
            {question === 3 && <p>Intervals that include zero leave the direction uncertain.</p>}
          </div>
        </div>}
        <p className="challenge-foot">{signal.source} · {start}–{end}</p>
      </div>
    </div>
  </section>;
}
