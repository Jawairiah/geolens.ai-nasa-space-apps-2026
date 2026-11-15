import {useEffect,useRef} from 'react';
import {AmbientLight,DirectionalLight,Mesh,MeshPhongMaterial,PerspectiveCamera,Scene,SphereGeometry,TextureLoader,WebGLRenderer,SRGBColorSpace} from 'three';

export function Globe({playing,offset}:{playing:boolean;offset:number}){
 const host=useRef<HTMLDivElement>(null), motion=useRef({playing,offset});
 motion.current={playing,offset};
 useEffect(()=>{
  const target=host.current;
  if(!target)return;
  let renderer:WebGLRenderer;
  try{renderer=new WebGLRenderer({alpha:true,antialias:true})}catch{return}
  const scene=new Scene(), camera=new PerspectiveCamera(34,1,.1,30);
  camera.position.z=4;
  const texture=new TextureLoader().load('/assets/earth.jpg');
  texture.colorSpace=SRGBColorSpace;
  const geometry=new SphereGeometry(1,48,32), material=new MeshPhongMaterial({map:texture,shininess:7});
  const earth=new Mesh(geometry,material);
  earth.rotation.z=.16;
  scene.add(earth,new AmbientLight(0xb5d7ff,.8));
  const sun=new DirectionalLight(0xfff8e8,2.25);
  sun.position.set(-3,2,4);scene.add(sun);
  target.appendChild(renderer.domElement);
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
  const resize=new ResizeObserver(()=>renderer.setSize(target.clientWidth,target.clientHeight,false));
  resize.observe(target);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let raf=0,angle=1.2,last=0,dragX:number|undefined;
  function frame(now:number){
   if(last&&motion.current.playing&&!reduced.matches&&dragX===undefined)angle+=Math.min(50,now-last)*.00008;
   last=now;earth.rotation.y=angle+motion.current.offset/75;renderer.render(scene,camera);
   raf=requestAnimationFrame(frame);
  }
  raf=requestAnimationFrame(frame);
  function down(e:PointerEvent){dragX=e.clientX;target!.setPointerCapture(e.pointerId)}
  function move(e:PointerEvent){if(dragX!==undefined){angle+=(e.clientX-dragX)*.01;dragX=e.clientX}}
  function up(){dragX=undefined}
  target.addEventListener('pointerdown',down);target.addEventListener('pointermove',move);
  target.addEventListener('pointerup',up);target.addEventListener('pointercancel',up);
  return ()=>{cancelAnimationFrame(raf);resize.disconnect();target.removeEventListener('pointerdown',down);target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',up);target.removeEventListener('pointercancel',up);renderer.domElement.remove();renderer.dispose();geometry.dispose();material.dispose();texture.dispose()};
 },[]);
 return <div className="earth globe" ref={host} role="img" aria-label="Interactive 3D Earth using Blue Marble imagery"/>;
}
