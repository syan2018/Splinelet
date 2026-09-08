import fs from 'node:fs/promises';
import {call} from './client.mjs';
const dir=new URL('../../../outputs/',import.meta.url);await fs.mkdir(dir,{recursive:true});
for(const format of ['svg','blender','json']){const r=await call('export',{format});if(format==='json'){const p=JSON.parse(r.content);p.image='data:image/png;base64,'+(await fs.readFile(new URL('../public/reference.png',import.meta.url))).toString('base64');r.content=JSON.stringify(p);await fs.writeFile(new URL('../public/character-example.bezier.json',import.meta.url),r.content)}await fs.writeFile(new URL(r.filename,dir),r.content);console.log('Exported',r.filename,r.content.length)}
