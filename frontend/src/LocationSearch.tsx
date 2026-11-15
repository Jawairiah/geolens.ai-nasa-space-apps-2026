import {useState,type FormEvent} from 'react';
type Place={id:number;name:string;country?:string;latitude:number;longitude:number};
export function LocationSearch(){
 const [query,Q]=useState(''),[matches,M]=useState<Place[]>(),[selected,S]=useState<Place>(),[loading,L]=useState(false),[error,E]=useState('');
 async function search(event:FormEvent){event.preventDefault();if(!query.trim())return;L(true);E('');M(undefined);S(undefined);
  try{
   const url=new URL('https://geocoding-api.open-meteo.com/v1/search');
   url.search=new URLSearchParams({name:query.trim(),count:'5',language:'en'}).toString();
   const response=await fetch(url,{signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw new Error();
   M((await response.json()).results??[]);
  }catch{E('Location search is unavailable. Try again later.')}finally{L(false)}
 }
 return <section className="location"><form onSubmit={search}><label htmlFor="location">Find a place worldwide</label><div><input id="location" value={query} onChange={e=>Q(e.target.value)} minLength={2} required placeholder="Search a city"/><button className="outline" disabled={loading}>{loading?'Searching…':'Search'}</button></div></form>
 {error&&<p role="alert">{error}</p>}{matches?.length===0&&<p>No matching places.</p>}
 {matches?.map(place=><button className="text-button" key={place.id} onClick={()=>S(place)}>{place.name}{place.country?', '+place.country:''}</button>)}
 {selected&&<p>{selected.name} · {selected.latitude.toFixed(3)}°, {selected.longitude.toFixed(3)}°. Analysis is available for the Karachi districts. <a href={'https://www.openstreetmap.org/?mlat='+selected.latitude+'&mlon='+selected.longitude+'#map=10/'+selected.latitude+'/'+selected.longitude} target="_blank" rel="noreferrer">View location ↗</a></p>}
 </section>;
}
