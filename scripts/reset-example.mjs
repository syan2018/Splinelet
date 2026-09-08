import {call} from './client.mjs';
const p=await call('get_project');p.paths=p.paths.slice(0,1);await call('load_project',{project:p});
