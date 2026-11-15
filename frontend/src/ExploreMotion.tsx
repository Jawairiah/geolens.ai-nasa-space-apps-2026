import {useLayoutEffect,useRef} from 'react';
import gsap from 'gsap';
import type {Evidence} from './api';

export function EarthGraphic(){
 return <div className="atlas-earth-scene" aria-hidden="true">
   <div className="atlas-orbit atlas-orbit-outer"/>
   <div className="atlas-orbit"/>
   <div className="atlas-earth"/>
   <div className="atlas-track"><i/></div>
 </div>;
}

export function useExploreMotion(report:Evidence|undefined,busy:string){
 const root=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{
  const media=gsap.matchMedia(root);
  media.add('(prefers-reduced-motion: no-preference)',()=>{
   gsap.from('.atlas-earth-scene',{x:20,opacity:.4,duration:1.1,ease:'expo.out'});
   gsap.fromTo('.atlas-track',{rotate:-12},{rotate:348,duration:4.5,ease:'sine.inOut'});
  });
  return ()=>media.revert();
 },[]);
 useLayoutEffect(()=>{
  if(!report)return;
  const media=gsap.matchMedia(root);
  media.add('(prefers-reduced-motion: no-preference)',()=>{
   gsap.from('[data-finding]',{y:10,opacity:.7,duration:.58,ease:'expo.out'});
  });
  return ()=>media.revert();
 },[report]);
 useLayoutEffect(()=>{
  if(!busy)return;
  const media=gsap.matchMedia(root);
  media.add('(prefers-reduced-motion: no-preference)',()=>{
   if(!root.current?.querySelector('[data-scan-beam]'))return;
   gsap.fromTo('[data-scan-beam]',{yPercent:-100},{yPercent:100,duration:1.45,ease:'sine.inOut',repeat:-1});
  });
  return ()=>media.revert();
 },[busy]);
 return root;
}
