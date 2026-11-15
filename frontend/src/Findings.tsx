import {Link} from 'react-router-dom';
import {useState} from 'react';
import {download,number,type Compare,type Evidence,type Metric} from './api';

const interval=(m:Metric)=>m.interval?.map(number).join(' to ')??'Unavailable';
const includesZero=(m:Metric)=>!!m.interval&&m.interval[0]<=0&&m.interval[1]>=0;
const unit='NDVI points per decade';

function districtTrend(metric:Metric){
 if(metric.slope===null)return 'Too few usable observations';
 if(includesZero(metric))return 'Direction uncertain';
 return metric.slope>0?'Getting greener':'Getting less green';
}

function Chart({result,names,source}:{result:Compare;names:string[];source:string}){
 const [monthly,setMonthly]=useState(false);
 if(result.series.length<2)return <p>Too few shared observations to plot a time series.</p>;
 const years=new Map<number,[number,number,number]>();
 for(const [month,a,b] of result.series){
  const year=Math.floor(month/12), row=years.get(year)??[0,0,0];
  years.set(year,[row[0]+a,row[1]+b,row[2]+1]);
 }
 const rows=monthly?result.series:[...years].map(([year,[a,b,n]])=>[year*12,a/n,b/n]);
 const begin=rows[0][0],end=rows[rows.length-1][0];
 const values=rows.flatMap(row=>row.slice(1));
 const min=Math.min(...values)-.01,max=Math.max(...values)+.01;
 const x=(t:number)=>66+((t-begin)/Math.max(1,end-begin))*638;
 const y=(v:number)=>179-150*(v-min)/(max-min);
 const colors=['#6fe8cd','#f5b378'];
 return <section className="trend-chart">
  <div className="section-heading"><div><h3>How greenness changed over time</h3><p>{source} · {monthly?'Monthly readings':'Yearly averages of shared monthly readings'}</p></div><label><input type="checkbox" checked={monthly} onChange={e=>setMonthly(e.target.checked)}/> Monthly detail</label></div>
  <div className="series-legend">{names.map((name,i)=><span key={name}><i style={{background:colors[i]}}/>{name}</span>)}</div>
  <svg viewBox="0 0 734 222" role="img" aria-label={source+' vegetation greenness by year for '+names.join(' and ')}>
   <text x="15" y="15" className="axis-label">Greenness (NDVI)</text>
   {Array.from({length:5},(_,i)=>{const v=max-i*(max-min)/4;return <g key={i}><line x1="66" x2="704" y1={y(v)} y2={y(v)}/><text x="18" y={y(v)+4}>{v.toFixed(2)}</text></g>})}
   {Array.from(new Set([begin,...[2005,2010,2015,2020].map(year=>(year-2003)*12).filter(t=>t-begin>16&&end-t>16),end])).map(t=><text key={t} x={x(t)} y="201" textAnchor="middle">{2003+Math.floor(t/12)}</text>)}
   <text x="387" y="218" textAnchor="middle" className="axis-label">Year</text>
   {([1,2] as const).map((col,i)=><g key={col}><path d={rows.map((row,j)=>(j&&row[0]-rows[j-1][0]===(monthly?1:12)?'L':'M')+x(row[0])+' '+y(row[col])).join(' ')} stroke={colors[i]} fill="none" strokeWidth="2"/>{!monthly&&rows.map(row=><circle key={row[0]} cx={x(row[0])} cy={y(row[col])} r="3" fill={colors[i]}><title>{names[i]} · {2003+row[0]/12} · NDVI {row[col].toFixed(3)}</title></circle>)}</g>)}
  </svg>
  <p>Higher lines mean greener vegetation. The chart shows observations. The rates above estimate long-term change after accounting for seasonal patterns.</p>
 </section>;
}

export function Findings({report,names,busy,reveal}:{report:Evidence;names:string[];busy:boolean;reveal:()=>void}){
 const [matched,setMatched]=useState(false),[source,setSource]=useState<'terra'|'aqua'>('terra');
 const run=report.runs[0], aqua=matched?run.common?.aqua:run.aqua,terra=matched?run.common?.terra??run.terra:run.terra;
 const active=source==='aqua'&&aqua?aqua:terra;
 const delta=active.delta, leader=delta.slope!==null&&delta.slope<0?names[1]:names[0];
 const finding=delta.slope===null?'Too little data to compare trends':includesZero(delta)?'No clear difference in greenness trends':delta.slope===0?'The estimated rates are equal':leader+' has the stronger greenness trend';
 return <section className="findings panel" aria-label="Comparison results" data-finding>
  <header className="finding-head"><div className="finding-context"><span>{names.join(" vs ")}</span><span>{source==='aqua'?'Aqua':'Terra'} · {run.start}–{run.end}</span></div><h2>{finding}</h2>
  <p>{delta.slope===null?'Choose a longer date range or a different pair.':includesZero(delta)?'The estimated gap could be zero given the uncertainty in these observations.':'The estimated rate is more positive in this district. Check both district rates below to see if they are gaining or losing greenness.'}</p></header>
  <div className="finding-metrics">{[active.left,active.right].map((metric,i)=><div key={names[i]}><span className={'district-dot dot-'+i}/><b>{names[i]}</b><strong>{districtTrend(metric)}</strong><span>{number(metric.slope)} {unit}</span></div>)}<div><b>Difference in rates</b><strong>{delta.slope===null?'Unavailable':Math.abs(delta.slope).toFixed(3)}</strong><span>{delta.slope===null?'Insufficient shared data':unit+' apart'}</span></div></div>
  <Chart key={source} result={active} names={names} source={source==='aqua'?'Aqua':'Terra'}/>
  <div className="evidence-tools"><div className="section-heading"><div><h3>Does the other satellite see it too?</h3><p>Compare the same districts and years using Aqua’s observations.</p></div>{!aqua&&<button className="outline" disabled={busy} onClick={reveal}>{busy?'Checking…':'Check with Aqua'}</button>}</div>
  {aqua&&<><p>{terra.delta.slope==null||aqua.delta.slope==null?'Too few observations to compare satellite directions.':Math.sign(terra.delta.slope)===Math.sign(aqua.delta.slope)?'Both satellites estimate the gap in the same direction. Check the uncertainty for each.':'The satellites estimate the gap in different directions.'}</p><div className="switches" role="group" aria-label="Satellite and month alignment"><button aria-pressed={source==='terra'} onClick={()=>setSource('terra')}>View Terra</button><button aria-pressed={source==='aqua'} onClick={()=>setSource('aqua')}>View Aqua</button><label><input type="checkbox" checked={matched} onChange={e=>setMatched(e.target.checked)}/> Use only months available on both satellites</label></div></>}
  <div className="atlas-coverage"><h3>Uncertainty and data coverage</h3><p>Gap is calculated as {names[0]} minus {names[1]}. An interval that includes zero leaves the direction of the gap uncertain.</p>
  <div className="evidence-table"><table><thead><tr><th>Satellite</th><th>Estimated gap</th><th>Approx. 95% interval</th><th>Shared months</th></tr></thead><tbody>{([{name:'Terra',data:terra},...(aqua?[{name:'Aqua',data:aqua}]:[])]).map(({name,data})=><tr key={name}><th>{name}</th><td>{number(data.delta.slope)}</td><td>{interval(data.delta)}</td><td>{data.delta.months}</td></tr>)}</tbody></table></div><p>Rates are in {unit}. These comparisons are exploratory.</p></div>
  <details><summary>Stress-test the finding</summary><p>See how the estimated gap changes with a stricter quality filter or a shorter time window.</p><div className="evidence-table"><table><thead><tr><th>Settings</th><th>Terra gap</th>{run.aqua&&<th>Aqua gap</th>}</tr></thead><tbody>{report.runs.map(r=><tr key={r.label}><th>{r.label}<small>{r.start}–{r.end}</small></th><td>{number(r.terra.delta.slope)}<small>{interval(r.terra.delta)} · {r.terra.delta.months} months</small></td>{r.aqua&&<td>{number(r.aqua.delta.slope)}<small>{interval(r.aqua.delta)} · {r.aqua.delta.months} months</small></td>}</tr>)}</tbody></table></div></details>
  <div className="inspection-actions"><button className="text-button" onClick={()=>download(report)}>Download evidence JSON</button>{report.manifest.version && run.terra.delta.slope !== null && <Link className="outline" to="/inspections/demo" state={{evidence: report}}>Try inspection demo</Link>}</div></div>
 </section>;
}
