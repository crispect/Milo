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

test('all 100 room routes are reachable and each segment stays outside obstacles',()=>{
  const {game:g}=boot();let checked=0;
  for(const a of Object.values(g.spots))for(const b of Object.values(g.spots)){
    let prev=g.nearest(a.x,a.z);const route=g.route(prev,b);
    assert.ok(route,`${a.label} -> ${b.label}`);
    for(const point of route){assert.ok(g.clearSegment(prev,point));prev=point}
    const target=g.nearest(b.x,b.z);
    assert.ok(Math.hypot(prev.x-target.x,prev.z-target.z)<1e-6);checked++;
  }
  assert.equal(checked,100);
});

test('Milo walks to all ten destinations without clipping or stalling',()=>{
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

test('camera handlers rotate, zoom, cancel a gesture, pan and resume following',()=>{
  const env=boot(),g=env.game,canvas=env.renderer.domElement;
  const azimuth=g.azimuth;
  env.emit(canvas,'pointerdown',{pointerId:1,clientX:100,clientY:100});
  env.emit(canvas,'pointermove',{pointerId:1,clientX:200,clientY:130});
  assert.notEqual(g.azimuth,azimuth);
  env.emit(canvas,'pointercancel',{pointerId:1});
  const stopped=g.azimuth;
  env.emit(canvas,'pointermove',{pointerId:1,clientX:400,clientY:130});
  assert.equal(g.azimuth,stopped);
  const radius=g.radius;env.emit(canvas,'wheel',{deltaY:-100});assert.ok(g.radius<radius);
  env.emit(canvas,'pointerdown',{pointerId:1,clientX:100,clientY:100});
  env.emit(canvas,'pointerdown',{pointerId:2,clientX:200,clientY:100});
  env.emit(canvas,'pointermove',{pointerId:1,clientX:95,clientY:105});
  env.emit(canvas,'pointermove',{pointerId:2,clientX:210,clientY:105});
  assert.equal(g.following,false);assert.ok(Number.isFinite(g.radius));
  env.emit(canvas,'pointerup',{pointerId:1});env.emit(canvas,'pointerup',{pointerId:2});
  env.element('#follow').onclick();assert.equal(g.following,true);
  env.step();assert.ok(g.camera.position.toArray().every(Number.isFinite));
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


test('portrait camera supports immediate pinch and one-finger exploration without following drift',()=>{
 const env=boot({width:390}),g=env.game,c=env.renderer.domElement;
 env.emit(c,'pointerdown',{pointerId:1,clientX:100,clientY:100});
 env.emit(c,'pointermove',{pointerId:1,clientX:200,clientY:100});
 assert.equal(g.following,false);assert.ok(Math.abs(g.azimuth-.58)>1);
 env.emit(c,'pointerdown',{pointerId:2,clientX:300,clientY:100});
 const r=g.radius;env.emit(c,'pointermove',{pointerId:2,clientX:320,clientY:100});
 assert.ok(g.radius<r,'first pinch movement must zoom');
 env.emit(c,'pointerup',{pointerId:2});
 const angle=g.azimuth;env.emit(c,'pointermove',{pointerId:1,clientX:201,clientY:100});
 assert.ok(Math.abs(g.azimuth-angle)<.02,'lifting second finger must not jump');
 env.emit(c,'pointerup',{pointerId:1});env.element('#cameraMode').onclick();
 const before=g.focus.clone(),rotation=g.azimuth;
 env.emit(c,'pointerdown',{pointerId:3,clientX:100,clientY:100});
 env.emit(c,'pointermove',{pointerId:3,clientX:180,clientY:140});
 assert.ok(g.focus.distanceTo(before)>.1);assert.equal(g.azimuth,rotation);
 const manual=g.focus.clone();env.step(60);assert.ok(g.focus.distanceTo(manual)<1e-9);
 env.docEvents.get('blur')();env.emit(c,'pointermove',{pointerId:3,clientX:300,clientY:300});
 assert.ok(g.focus.distanceTo(manual)<1e-9);
 env.element('#follow').onclick();assert.equal(g.following,true);assert.equal(g.panMode,false);
 env.step(60);assert.ok(g.focus.distanceTo(manual)>.01);
});
