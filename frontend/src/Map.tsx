import {useState} from 'react';
import {number,type Study,type Metric,type Region} from './api';

const polygons=(region:Region)=>region.geometry.type==='Polygon'?[region.geometry.coordinates]:region.geometry.coordinates;
const project=([lon,lat]:number[])=>[(lon+180)/360*131072,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*131072];
export function StudyMap({study,trends,pair,select,busy,showScanHint}:{study:Study;trends:Record<string,Metric>;pair:string[];select:(id:string)=>void;busy:boolean;showScanHint?:boolean}){
 const [zoom,Z]=useState(1),[satellite,S]=useState(true);
 const regions=study.regions.features;
 const points=regions.flatMap(region=>polygons(region).flat(2).map(project));
 const minX=Math.min(...points.map(v=>v[0]))-25,minY=Math.min(...points.map(v=>v[1]))-25;
 const width=Math.max(...points.map(v=>v[0]))-minX+25,height=Math.max(...points.map(v=>v[1]))-minY+25;
 const cx=minX+width/2,cy=minY+height/2;
 const tiles=Array.from({length:25},(_,i)=>[Math.floor(cx/256)+i%5-2,Math.floor(cy/256)+Math.floor(i/5)-2]);
 const path=(region:Region)=>polygons(region).flatMap(poly=>poly.map(ring=>ring.map((point,i)=>(i?'L':'M')+project(point).map(n=>n.toFixed(2)).join(' ')).join(' ')+'Z')).join(' ');
 return <div className="map-frame"><div className="map-head"><span>Karachi districts</span><label><input type="checkbox" checked={satellite} onChange={e=>S(e.target.checked)}/> Satellite basemap</label></div>
 <div className="map-window"><svg className="district-map" viewBox={[(cx-width/zoom/2),(cy-height/zoom/2),width/zoom,height/zoom].join(' ')} aria-label="Karachi district boundaries">
 {satellite&&tiles.map(([x,y])=><image key={x+':'+y} x={x*256} y={y*256} width="256" height="256" href={'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/9/'+y+'/'+x}/>)}
 {regions.map(region=>{const value=trends[region.id]?.slope;return <path key={region.id} d={path(region)} className="district" fillRule="evenodd" fill={value==null?'#26394eba':Math.abs(value)<.006?'#5f748dbb':value>0?'#159d9ebd':'#c26755bd'} stroke={pair[0]===region.id?'#6fe8cd':pair[1]===region.id?'#f5b378':'#b9d9ef'} strokeWidth={pair.includes(region.id)?2.2:.8} tabIndex={0} role="button" aria-pressed={pair.includes(region.id)} aria-label={region.properties.name} onClick={()=>select(region.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(region.id)}}}><title>{region.properties.name}{value==null?'':' · '+number(value)+' NDVI per decade'}</title></path>})}
 {regions.map(region=>{const [x,y]=project(region.properties.center);return <text className="district-label" key={region.id} x={x} y={y}>{region.properties.name.replace('Karachi ','')}</text>})}
 </svg>{busy&&<div className="beam" data-scan-beam aria-hidden="true"/>}<div className="map-controls"><button type="button" aria-label="Zoom in" onClick={()=>Z(z=>Math.min(2,z+.2))}>+</button><button type="button" aria-label="Zoom out" onClick={()=>Z(z=>Math.max(.7,z-.2))}>−</button><button type="button" aria-label="Reset zoom" onClick={()=>Z(1)}>⌂</button></div>{satellite&&<small className="attribution">Imagery © Esri and contributors</small>}</div>
 <div className="legend"><span><i aria-hidden="true" className="district-dot dot-0"/> District A</span><span><i aria-hidden="true" className="district-dot dot-1"/> District B</span><span>{Object.keys(trends).length?"Terra trend · NDVI points per decade":showScanHint && study.manifest.mode==='source extract'?"Run a scan to color districts by trend.":"District boundaries"}</span>{Object.keys(trends).length>0&&<><span><i className="down"/> Decreasing</span><span><i className="flat"/> Near zero (within ±0.006)</span><span><i className="up"/> Increasing</span><span><i className="missing"/> Unavailable</span></>}<a href={study.regions.source} target="_blank" rel="noreferrer">OCHA district boundaries ↗</a></div></div>;
}
