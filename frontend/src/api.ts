export type Metric={slope:number|null;interval:[number,number]|null;months:number};
export type Compare={left:Metric;right:Metric;delta:Metric;series:[number,number,number][]};
export type Run={label:string;start:number;end:number;terra:Compare;aqua?:Compare;common?:{terra:Compare;aqua:Compare}};
export type Settings={start:number;end:number;quality:'standard'|'strict'};
export type Evidence={request:Settings & {pair:string[]};manifest:{mode:string;name:string;version?:string;boundary_note?:string;start_month?:string;end_month?:string;accepted?:number;observed?:number};method:string;runs:Run[]};
export type Region={id:string;properties:{name:string;center:number[]};geometry:{type:"Polygon";coordinates:number[][][]}|{type:"MultiPolygon";coordinates:number[][][][]}};
export type Study={manifest:Evidence["manifest"];regions:{features:Region[];source:string;license:string}};
export type Scan={trends:Record<string,Metric>;candidates:{pair:string[];delta:number;opposite:boolean}[]};
export async function request<T>(path:string, body?:unknown, token?:string):Promise<T>{
  const response=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const payload=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(typeof payload?.detail==='string'?payload.detail:'Request failed ('+response.status+').');
  return payload as T;
}
export const number=(n:number|null|undefined)=>n==null?'—':(n>0?'+':'')+n.toFixed(3);
export function download(evidence:unknown, filename = 'geolens-evidence.json'){
  const url=URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
