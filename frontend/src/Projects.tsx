import {useEffect,useState,type FormEvent} from 'react';
import {download,request,type Evidence,type Study} from './api';
type Project={id:number;title:string};
type Job={id:number;status:string;result?:Evidence|{error:string}};
function EvidenceDownload({evidence}:{evidence:Evidence}){
 return <button className="text-button" onClick={()=>download(evidence)}>Download evidence</button>;
}
export function Projects(){
 const [token,T]=useState(''),[error,E]=useState(''),[projects,P]=useState<Project[]>([]),[id,I]=useState(0),[jobs,J]=useState<Job[]>([]),[busy,B]=useState(false);
 const [sourceReady,setSourceReady]=useState<boolean>();
 useEffect(()=>{
  let active=true;
  request<Study>('/study').then(study=>{if(active)setSourceReady(study.manifest.mode==='source extract')}).catch(()=>{if(active)setSourceReady(false)});
  return()=>{active=false};
 },[]);
 useEffect(()=>{if(!token)return;request<Project[]>('/projects',undefined,token).then(P).catch(e=>E(e.message));},[token]);
 useEffect(()=>{if(!id||!token)return;let active=true;const poll=()=>request<Job[]>('/projects/'+id+'/jobs',undefined,token).then(rows=>{if(active)J(rows)}).catch(e=>{if(active)E(e.message)});void poll();const timer=setInterval(poll,2500);return()=>{active=false;clearInterval(timer)}},[id,token]);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const values=new FormData(e.currentTarget);B(true);E('');try{
 if(!token){const result=await request<{token:string}>('/auth/'+values.get('action'),{username:values.get('username'),password:values.get('password')});T(result.token)}
 else{const result=await request<Project>('/projects',{title:values.get('title'),cell:'PK714'},token);P(items=>[result,...items]);I(result.id)}
 }catch(e){E((e as Error).message)}finally{B(false)}}
 async function queue(){B(true);E('');try{await request('/projects/'+id+'/jobs',{pair:['PK714','PK712'],start:2003,end:2024,quality:'standard'},token);J(await request<Job[]>('/projects/'+id+'/jobs',undefined,token))}catch(e){E((e as Error).message)}finally{B(false)}}
 return <main className="workspace narrow"><div className="kicker">SAVED INVESTIGATIONS</div><h1>Projects</h1><p>Save a Karachi investigation and queue its preset two-satellite comparison.</p>{error&&<p role="alert" className="message">{error}</p>}
 <form className="panel project-form" onSubmit={submit}>{token?<><label>Project name <input required maxLength={100} name="title"/></label><button disabled={busy} className="primary">Create project</button></>:<><label>Account action <select name="action"><option value="login">Sign in</option><option value="register">Create account</option></select></label><label>Username <input required name="username" autoComplete="username"/></label><label>Password <input required minLength={12} type="password" name="password" autoComplete="current-password"/></label><button disabled={busy} className="primary">Continue</button></>}</form>
 {token&&<div className="panel project-form"><button className="text-button" onClick={()=>{T('');I(0);P([]);J([]);E('')}}>Sign out</button>{projects.length?<label>Project <select value={id} onChange={e=>{J([]);I(+e.target.value)}}><option value={0}>Select a project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>:<p>No saved projects yet.</p>}{id>0&&<><button className="outline" disabled={busy||!sourceReady} onClick={queue}>Queue preset comparison</button>{sourceReady===false&&<p>Satellite observations are unavailable. Load a source extract before queuing analysis.</p>}{jobs.length?jobs.map(j=><div className="check" key={j.id}><strong>Analysis {j.id}</strong><span>{j.status}</span>{j.result&&('error' in j.result?<p>{j.result.error}</p>:j.status==='complete'&&<EvidenceDownload evidence={j.result}/>)}</div>):<p>No analyses yet.</p>}</>}</div>}</main>;
}
