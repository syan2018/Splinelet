import fs from 'node:fs/promises';
import {call} from './client.mjs';
let project=await call('get_project');project.paths=project.paths.filter(p=>p.curves.length);await call('load_project',{project});
const guides=JSON.parse(await fs.readFile(new URL('./character-guides.json',import.meta.url),'utf8'));
for(const g of guides){const result=await call('create_path',{...g,points:g.points.map(([x,y])=>({x,y})),tolerance:2,corridor:35});console.log(g.name,result.segments,result.quality.toFixed(2))}
const result=await call('get_project');await fs.writeFile(new URL('../public/character-example.bezier.json',import.meta.url),JSON.stringify(result));console.log('Saved',result.paths.length,'paths');
