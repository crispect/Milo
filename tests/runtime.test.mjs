import test from 'node:test';
import assert from 'node:assert/strict';
import {boot} from './runtime-harness.mjs';
import * as THREE from 'three';

test('CPU startup builds the scene and reaches the first animation frame',()=>{
  const env=boot();
  assert.deepEqual(env.errors.map(e=>e.message||String(e)),[]);
  assert.ok(env.game);
  assert.equal(env.frames,1);
  assert.equal(env.element('#load').style.display,'none');
});

test('all 144 destination pairs, including Milo’s room, have collision-free routes',()=>{
  const {game:g}=boot();let checked=0;
  for(const a of Object.values(g.spots))for(const b of Object.values(g.spots)){
    let prev=g.nearest(a.x,a.z);const route=g.route(prev,b);
    assert.ok(route,`${a.label} -> ${b.label}`);
    for(const point of route){assert.ok(g.clearSegment(prev,point));prev=point}
    const target=g.nearest(b.x,b.z);
    assert.ok(Math.hypot(prev.x-target.x,prev.z-target.z)<1e-6);checked++;
  }
  assert.equal(checked,144);
});

test('Milo walks to all twelve destinations without clipping or stalling',()=>{
  const env=boot(),g=env.game;
  for(const target of Object.values(g.spots)){
    g.navigate(target);assert.ok(g.moving,`No route to ${target.label}`);
    let frames=0;
    while(g.moving&&frames++<12000){env.step();assert.ok(g.clearAt(g.dog.position.x,g.dog.position.z))}
    assert.ok(frames<12000,`Stalled before ${target.label}`);
    const end=g.nearest(target.x,target.z);
    assert.ok(Math.hypot(g.dog.position.x-end.x,g.dog.position.z-end.z)<.001);
  }
  assert.deepEqual(env.errors,[]);
});

test('full animated dog geometry fits inside its collision circle',()=>{
  const env=boot(),g=env.game;let max=0;
  for(let i=0;i<12;i++){
    env.step(9);
    g.dog.traverse(mesh=>{
      if(!mesh.isMesh||mesh.isInstancedMesh)return;
      const vertices=mesh.geometry.getAttribute('position'),point=new THREE.Vector3();
      for(let j=0;j<vertices.count;j++){
        point.fromBufferAttribute(vertices,j).applyMatrix4(mesh.matrixWorld);
        max=Math.max(max,Math.hypot(point.x-g.dog.position.x,point.z-g.dog.position.z));
      }
    });
  }
  assert.ok(max<=g.DOG_RADIUS,`Visible radius ${max} > collider ${g.DOG_RADIUS}`);
});

test('ten simulated minutes keep finite positions outside every obstacle',()=>{
  const seed=boot().game.state;
  seed.seed=123456;seed.events=[];
  const env=boot({saved:seed}),g=env.game;
  let still=0,maxStill=0,last={x:NaN,z:NaN};
  for(let i=0;i<36000;i++){
    env.step();const {x,z}=g.dog.position;
    assert.ok(g.clearAt(x,z));
    still=g.moving&&Math.hypot(x-last.x,z-last.z)<1e-9?still+1:0;
    maxStill=Math.max(maxStill,still);last={x,z};
  }
  assert.ok(maxStill<120,`Stalled for ${maxStill/60}s`);
  assert.deepEqual(env.errors,[]);
});

test('page hide saves the actual position and reload restores it',()=>{
  const env=boot(),g=env.game;g.navigate(g.spots.patio);env.step(203);
  env.docEvents.get('pagehide')();
  const saved=JSON.parse(env.storage.get('milo-life-v1'));
  assert.deepEqual(saved.position,{x:g.dog.position.x,z:g.dog.position.z});
  const next=boot({saved});assert.deepEqual(next.errors,[]);
  assert.ok(Math.hypot(next.game.dog.position.x-saved.position.x,next.game.dog.position.z-saved.position.z)<.03);
});

test('toys stay on the floor until pickup and persist at the delivery point',()=>{
  const env=boot(),g=env.game;g.transport();
  const prop=g.carrying;assert.ok(prop);
  g.syncProps();const mesh=g.propMeshes.get(prop.id);
  assert.equal(mesh.position.x,prop.x);assert.equal(mesh.position.z,prop.z);
  let frames=0;
  while(g.phase==='pickup'&&frames++<12000)env.step();
  assert.equal(g.phase,'delivery');
  const destination={...g.current.destination};
  while(g.phase==='delivery'&&frames++<24000)env.step();
  assert.equal(g.phase,'');
  assert.equal(prop.x,destination.x);assert.equal(prop.z,destination.z);
  assert.ok(g.clearAt(prop.x,prop.z));
});

test('portrait camera shortcuts frame the room and house, rotate, and resume following',()=>{
  const env=boot({width:390,height:844}),g=env.game;
  env.element('#houseView').onclick();
  env.step(75);
  assert.equal(g.cameraView,'house');
  const corners=[[-12,0,-10.5],[12,0,15.5],[12,3,15.5],[-12,3,-10.5]];
  for(const corner of corners){
    const point=new THREE.Vector3(...corner).project(g.camera);
    assert.ok(Math.abs(point.x)<.98&&Math.abs(point.y)<.98,'House fits in a portrait frame');
  }
  const angle=g.azimuth;
  env.element('#rotateView').onclick();
  env.step(75);
  assert.ok(Math.abs(g.azimuth-angle+Math.PI/2)<.001);
  env.element('#roomView').onclick();
  env.step(75);
  assert.equal(g.cameraView,'den');
  assert.ok(Math.hypot(g.focus.x-g.miloRoom.x,g.focus.z-g.miloRoom.z)<.001);
  assert.ok(g.wallSections.filter(w=>w.roomFront).every(w=>w.opacity<.15),'Front wall reveals room contents');
  const radius=g.radius;
  env.emit(env.renderer.domElement,'wheel',{deltaY:-100});
  assert.ok(g.radius<radius);
  env.element('#follow').onclick();
  env.step(75);
  assert.equal(g.cameraView,'milo');
  assert.ok(Math.hypot(g.focus.x-g.dog.position.x,g.focus.z-g.dog.position.z)<.13);
  assert.deepEqual(env.errors,[]);
});

test('journal and personality panels open and close',()=>{
  const env=boot();env.element('#journal').onclick();
  assert.ok(env.element('#panel').classList.contains('open'));
  assert.match(env.element('#panelContent').innerHTML,/Historia completa/);
  env.element('#panelClose').onclick();assert.ok(!env.element('#panel').classList.contains('open'));
  env.element('#personality').onclick();assert.match(env.element('#panelContent').innerHTML,/Energía/);
});

test('WebGL loss preserves progress, displays a retry and restores one animation loop',()=>{
  const env=boot();env.step(10);const before=env.frames;
  env.emit(env.renderer.domElement,'webglcontextlost');env.step(2);
  assert.equal(env.frames,before);
  assert.equal(env.element('#load').style.display,'grid');
  assert.equal(env.element('#loadError').children[1].textContent,'Reintentar');
  assert.ok(env.storage.has('milo-life-v1'));
  env.emit(env.renderer.domElement,'webglcontextrestored');env.step();
  assert.equal(env.frames,before+2);
  assert.equal(env.queue.length,1);
  assert.equal(env.element('#load').style.display,'none');
  env.emit(env.renderer.domElement,'webglcontextlost');
  env.emit(env.renderer.domElement,'webglcontextrestored');
  assert.equal(env.queue.length,1,'Immediate restoration must not duplicate the loop');
});

test('a render exception stops scheduling frames and shows a retry',()=>{
  const env=boot();env.renderer.render=()=>{throw Error('Simulated render failure')};
  env.step();
  assert.equal(env.queue.length,0);
  assert.equal(env.element('#load').style.display,'grid');
  assert.equal(env.errors.length,1);
});

test('a first-render failure stays visible and does not overwrite the previous visit',()=>{
  const saved=JSON.parse(JSON.stringify(boot().game.state));saved.lastVisit=42;
  const env=boot({saved,renderFailure:true});
  assert.equal(env.frames,0);assert.equal(env.queue.length,0);
  assert.equal(env.element('#load').style.display,'grid');
  assert.equal(JSON.parse(env.storage.get('milo-life-v1')).lastVisit,42);
});


test('gait follows traveled distance and smoothly settles when stationary',()=>{
  const g=boot().game;
  const initial=g.gaitPhase;
  for(let i=0;i<60;i++)g.animateDog(1/60,.65/60);
  assert.ok(g.gaitPhase>initial);
  assert.ok(g.gaitWeight>.99);
  const stoppedPhase=g.gaitPhase;
  let previous=g.gaitWeight;
  for(let i=0;i<120;i++){
    g.animateDog(1/60,0);
    assert.equal(g.gaitPhase,stoppedPhase);
    assert.ok(g.gaitWeight<=previous);previous=g.gaitWeight;
    for(const leg of g.legs)assert.ok(Number.isFinite(leg.paw.position.y));
  }
  assert.ok(g.gaitWeight<1e-6);
});


test('touch moves the floor with a finger and pinches about the midpoint without jumps',()=>{
 const width=390,height=844,env=boot({width,height}),g=env.game,c=env.renderer.domElement;
 const floor=new THREE.Vector3(g.focus.x,.03,g.focus.z);
 const project=()=>{
  const point=floor.clone().project(g.camera);
  return {x:(point.x+1)*width/2,y:(1-point.y)*height/2};
 };
 const finger=(type,pointerId,x,y)=>env.emit(c,type,{pointerId,clientX:x,clientY:y});
 const origin=project(),angle=g.azimuth;
 finger('pointerdown',1,origin.x,origin.y);
 finger('pointermove',1,origin.x+35,origin.y+22);
 env.step();
 assert.equal(g.cameraView,'free');
 assert.equal(g.azimuth,angle);
 const moved=project();
 assert.ok(Math.hypot(moved.x-origin.x-35,moved.y-origin.y-22)<.01);
 finger('pointerup',1,moved.x,moved.y);
 finger('pointerdown',1,moved.x-43,moved.y);finger('pointerdown',2,moved.x+43,moved.y);
 const radius=g.radius;
 finger('pointermove',2,moved.x+63,moved.y);
 assert.ok(g.radius<radius,'First movement should zoom');
 finger('pointermove',1,moved.x-63,moved.y);env.step();
 const pinched=project();
 assert.ok(Math.hypot(moved.x-pinched.x,moved.y-pinched.y)<.01);
 const before=g.focus.clone();
 finger('pointerup',2,moved.x+63,moved.y);
 finger('pointermove',1,moved.x-62,moved.y);env.step();
 assert.ok(g.focus.distanceTo(before)<.03,'Lifting a finger should not recenter the camera');
 const manual=g.focus.clone();
 env.step(60);assert.ok(g.focus.distanceTo(manual)<1e-9);
 finger('pointercancel',1,moved.x-62,moved.y);
 finger('pointermove',1,moved.x+200,moved.y+100);
 assert.ok(g.focus.distanceTo(manual)<1e-9);
 finger('pointerdown',3,100,100);env.docEvents.get('blur')();finger('pointermove',3,200,200);
 assert.ok(g.focus.distanceTo(manual)<1e-9);
});

test('existing saves receive six room toys and Milo plays with one and saves its new location',()=>{
 const seed=boot().game.state;
 seed.props=seed.props.filter(prop=>prop.home!=='milo');
 const oldToy=seed.props[0];
 oldToy.x=-2.1;oldToy.z=1.8;
 const env=boot({saved:seed}),g=env.game;
 const toys=g.state.props.filter(prop=>prop.home==='milo');
 assert.equal(toys.length,6);
 assert.deepEqual({...g.state.props.find(prop=>prop.id===oldToy.id)},{...oldToy});
 for(const prop of toys){
  assert.ok(g.clearAt(prop.x,prop.z),prop.id);
  assert.ok(g.propMeshes.get(prop.id).children.length>0,prop.id);
 }
 const eventCount=g.state.events.length;
 g.transport('jugarCuarto');
 const prop=g.carrying,initial={x:prop.x,z:prop.z};
 assert.equal(prop.home,'milo');
 let frames=0;
 while(g.phase==='pickup'&&frames++<12000)env.step();
 assert.equal(g.phase,'delivery');
 while(g.phase==='delivery'&&frames++<24000)env.step();
 assert.equal(g.phase,'');
 assert.ok(Math.hypot(prop.x-initial.x,prop.z-initial.z)>.3);
 assert.ok(g.clearAt(prop.x,prop.z)&&prop.z<g.miloRoom.front&&prop.x>g.miloRoom.left&&prop.x<g.miloRoom.right);
 assert.ok(g.state.events.slice(eventCount).some(event=>event.kind==='juego'&&event.message.includes(prop.label)));
 const saved=JSON.parse(env.storage.get('milo-life-v1'));
 assert.equal(saved.props.find(toy=>toy.id===prop.id).x,prop.x);
 assert.equal(saved.props.find(toy=>toy.id===prop.id).z,prop.z);
});
