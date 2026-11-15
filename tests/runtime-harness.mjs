// CPU integration harness: real Three.js scene/math, mocked DOM/audio/GPU.
// These checks do NOT validate WebGL rendering, GPU speed, or browser gestures.
import * as Three from 'three';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

class Element {
  constructor(){this.textContent='';this.innerHTML='';this.children=[];this.events=new Map();this.style={};this.attributes={};this.removed=false;const classes=new Set();this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)};}
  appendChild(child){this.children.push(child);return child}
  append(...children){this.children.push(...children)}
  replaceChildren(...children){this.children=children}
  remove(){this.removed=true}
  addEventListener(name,fn){this.events.set(name,fn)}
  setAttribute(name,value){this.attributes[name]=String(value)}
  setPointerCapture(){}
  releasePointerCapture(){}
  hasPointerCapture(){return true}
  getContext(){return {
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},beginPath(){},
    moveTo(){},bezierCurveTo(){},stroke(){},roundRect(){},fill(){},ellipse(){},save(){},restore(){},
    clip(){},fillRect(){},setLineDash(){},fillText(){}
  }}
}
export function boot({saved,html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),width=1363,height=936,touch=false,pixelRatio=1,renderFailure=false}={}){
  const elements=new Map(),errors=[],queue=[],timers=new Map();let frameId=0;
  const env={now:0,frames:0,errors,queue,elements,storage:new Map(saved?[["milo-life-v1",JSON.stringify(saved)]]:[])};
  const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
  const docEvents=new Map();
  const document={hidden:false,querySelector:element,createElement:()=>new Element(),addEventListener:(name,fn)=>docEvents.set(name,fn)};
  class Renderer {
    constructor(options){this.domElement=new Element();this.shadowMap={};this.capabilities={getMaxAnisotropy:()=>4};this.info={render:{calls:0}};this.options=options;this.sizes=[];env.renderer=this}
    setDrawingBufferSize(width,height,ratio){this.sizes.push({width,height,ratio})}
    render(scene,camera){if(renderFailure)throw Error('Simulated first-render failure');scene.updateMatrixWorld();camera.updateMatrixWorld();env.frames++}
    getContext(){return {isContextLost:()=>false}}
  }
  class Clock {getDelta(){return 1/60}}
  const BaseDate=Date;
  class TestDate extends BaseDate {constructor(...args){super(...(args.length?args:[1794690000000+env.now]))}static now(){return 1794690000000+env.now}}
  const context={document,console:{log(){},warn(){},error:e=>errors.push(e)},TEST_THREE:{...Three,WebGLRenderer:Renderer,Clock},Date:TestDate,
    performance:{now:()=>env.now},innerWidth:width,innerHeight:height,devicePixelRatio:pixelRatio,
    matchMedia:()=>({matches:touch}),
    localStorage:{getItem:key=>env.storage.get(key)||null,setItem:(key,value)=>env.storage.set(key,value)},
    requestAnimationFrame:fn=>{const id=++frameId;queue.push({id,fn});return id},cancelAnimationFrame(id){const i=queue.findIndex(frame=>frame.id===id);if(i>=0)queue.splice(i,1)},
    setTimeout:(fn,ms)=>{const id=timers.size+1;timers.set(id,{fn,at:env.now+ms});return id},clearTimeout:id=>timers.delete(id),
    URLSearchParams,location:{search:'',reload(){}},addEventListener:(name,fn)=>docEvents.set(name,fn)};
  context.window=context;
  env.context=vm.createContext(context);
  env.document=document;env.element=element;env.docEvents=docEvents;
  const module=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const instrumented=module.replace(/const THREE = await import\([^;]+;/,'const THREE = TEST_THREE;').replace(/\}\s*catch\(error\)\{\s*\n document\.querySelector\("#loadError"\)/,'}catch(error){\n document.querySelector("#loadError")');
  // Export closure bindings in memory only; never add a debug API to the game.
  const end=instrumented.lastIndexOf('}catch(error){');
  const exposed=instrumented.slice(0,end)+`
window.testGame={
 state,scene,camera,dog,spots,clearAt,clearSegment,nearest,route,blockers,save,startNew,plan,apply,
 syncProps,propMeshes,DOG_RADIUS,focus,miloRoom,wallSections,animateDog,legs,
 get gaitPhase(){return gaitPhase},get gaitWeight(){return gaitWeight},
 navigate(target){current={id:"explorar",name:"Test",place:"patio"};carrying=null;carryPhase="";dogTarget=target;moving=true;plan()},
 transport(id="coleccionar"){current={...behaviours.find(b=>b.id===id)};beginTransport(current);moving=true;plan()},
 get current(){return current},get moving(){return moving},get target(){return dogTarget},
 get waypoints(){return waypoints},get carrying(){return carrying},get phase(){return carryPhase},
 get cameraView(){return cameraView},get radius(){return radius},get azimuth(){return azimuth},get elevation(){return elevation}
};
`+instrumented.slice(end);
  for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(script,env.context,{timeout:1000});
  try {vm.runInContext(exposed,env.context,{timeout:10000})}catch(e){errors.push(e)}
  env.game=context.testGame;
  env.step=(frames=1)=>{for(let i=0;i<frames;i++){env.now+=1000/60;const next=queue.shift();if(next)next.fn();for(const [id,timer] of timers)if(timer.at<=env.now){timers.delete(id);timer.fn()}}};
  env.emit=(target,name,event={})=>{const handler=target.events.get(name);if(!handler)throw Error(`Missing listener: ${name}`);return handler({preventDefault(){},...event})};
  return env;
}
