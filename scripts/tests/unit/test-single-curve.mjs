import assert from 'node:assert/strict';
import {fitSingleCurve,evaluate} from '../../../public/geometry.mjs';
const known=[{x:10,y:10},{x:15,y:90},{x:110,y:120},{x:120,y:20}];
const points=Array.from({length:151},(_,i)=>evaluate(known,i/150));
for(const tolerance of [.01,.5,2,10]){const r=fitSingleCurve(points,tolerance);assert.equal(r.curves.length,1);assert.equal(r.curves[0].length,4);assert.deepEqual(r.curves[0][0],points[0]);assert.deepEqual(r.curves[0][3],points.at(-1));assert(r.fitError<3,JSON.stringify(r));}
const zigzag=[{x:0,y:0},{x:30,y:90},{x:60,y:0},{x:90,y:90},{x:120,y:0}];const dense=[];for(let i=1;i<zigzag.length;i++)for(let j=0;j<30;j++)dense.push({x:zigzag[i-1].x+(zigzag[i].x-zigzag[i-1].x)*j/30,y:zigzag[i-1].y+(zigzag[i].y-zigzag[i-1].y)*j/30});dense.push(zigzag.at(-1));const hard=fitSingleCurve(dense,.5);assert.equal(hard.curves.length,1);assert(hard.needsAnchor);assert(hard.fitError>.5);
const two=fitSingleCurve([{x:1,y:2},{x:12,y:32}]);assert.equal(two.curves.length,1);assert.equal(two.fitError,0);
console.log(JSON.stringify({singleCubicInvariant:'passed for all tolerances',exactEndpoints:'passed',hardCurve:{segments:hard.curves.length,fitError:hard.fitError,needsAnchor:hard.needsAnchor}},null,2));
