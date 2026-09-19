import assert from 'node:assert/strict';
import {buildField,trace,fitCurve,evaluate,dist,splitCubic} from '../../../public/geometry.mjs';
const w=160,h=160,rgba=new Uint8ClampedArray(w*h*4).fill(255);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const radius=Math.hypot(x-80,y-80),v=Math.abs(radius-52)<2?10:240;const i=(y*w+x)*4;rgba[i]=rgba[i+1]=rgba[i+2]=v;rgba[i+3]=255}
const field=buildField(rgba,w,h),r=trace(field,{x:28,y:80},{x:132,y:80},'ink',70);assert(r.points.some(p=>Math.abs(p.y-80)>45),'must follow semicircle rather than straight chord');assert(r.quality>.5);
const curves=fitCurve(r.points,1.5);assert(curves.length<r.points.length/4);assert.deepEqual(curves[0][0],r.points[0]);assert.deepEqual(curves.at(-1)[3],r.points.at(-1));for(let i=1;i<curves.length;i++)assert.deepEqual(curves[i][0],curves[i-1][3]);
for(const c of curves){const [a,b]=splitCubic(c,.4);for(let k=0;k<=20;k++){const t=k/20;const original=evaluate(c,t),split=t<=.4?evaluate(a,t/.4):evaluate(b,(t-.4)/.6);assert(dist(original,split)<1e-8)}}
const white=buildField(new Uint8ClampedArray(w*h*4).fill(255),w,h);const flat=trace(white,{x:20,y:20},{x:100,y:100});assert.equal(flat.quality,0,'blank image must report no edge support');
console.log(JSON.stringify({syntheticCircle:{points:r.points.length,segments:curves.length,quality:r.quality},blankImage:flat.quality,splitInvariant:'passed',continuity:'passed'},null,2));
