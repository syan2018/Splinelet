async(page)=>{
 const check=(v,m)=>{if(!v)throw Error(m)};
 const call=async(action,args={})=>{const v=await page.evaluate(({action,args})=>window.traceStudio.call(action,args),{action,args});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));return v};
 const state=()=>call('state');const row=id=>page.locator('[data-path-id="'+id+'"]');
 await page.getByRole('button',{name:'选择 (V)',exact:true}).click();
 const base=await call('get_project');await call('load_project',{project:{...base,paths:[],groups:[]}});
 const paths=[];for(let i=0;i<4;i++)paths.push(await call('create_path',{name:'测试 '+i,mode:'manual',points:[{x:140,y:160+i*140},{x:280,y:160+i*140},{x:380,y:200+i*140},{x:480,y:160+i*140}]}));
 await row(paths[0].id).click();await row(paths[2].id).click({modifiers:['Shift']});check((await state()).selectedPaths.length===3,'Shift range selects three');
 await row(paths[1].id).click({modifiers:['Control']});check((await state()).selectedPaths.length===2,'Ctrl toggles');
 await page.keyboard.press('Control+g');let doc=await call('get_project');check(doc.groups.length===1,'group created');const g=doc.groups[0];check(doc.paths.filter(p=>p.groupId===g.id).length===2,'batch grouped');
 await page.keyboard.press('Control+z');check((await call('get_project')).groups.length===0,'group one undo');
 await page.keyboard.press('Control+Shift+z');check((await call('get_project')).groups.length===1,'group redo');
 const dest=await call('manage_group',{action:'create',name:'目标组'});
 await row(paths[0].id).locator('.path-title').dragTo(page.locator('[data-group-id="'+dest.id+'"] summary'));
 await page.locator('[data-group-id="'+dest.id+'"] [data-path-id="'+paths[2].id+'"]').waitFor();
 doc=await call('get_project');check(doc.paths.filter(p=>p.groupId===dest.id).length===2,'multi drag moves both');
 await page.keyboard.press('Control+z');check((await call('get_project')).paths.filter(p=>p.groupId===g.id).length===2,'drag one undo');
 await page.getByRole('tab',{name:'工程',exact:true}).click();check(await row(paths[0].id).isVisible(),'tree persists on scene');
 await page.getByRole('button',{name:'选择 (V)',exact:true}).click();
 await call('set_view',{x:40,y:40,scale:1});
 const stage=await page.locator('.stage').boundingBox();const pos=(x,y)=>({x:stage.x+40+x,y:stage.y+40+y});
 let before=await call('get_project'),p=pos(210,160);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+45,p.y+25,{steps:8});await page.mouse.up();
 doc=await call('get_project');for(const i of [0,2])check(Math.abs(doc.paths.find(p=>p.id===paths[i].id).start.x-before.paths.find(p=>p.id===paths[i].id).start.x-45)<.2,'batch canvas translate');check(doc.paths.find(p=>p.id===paths[1].id).start.x===140,'other unchanged');
 await page.keyboard.press('Control+z');check(JSON.stringify((await call('get_project')).paths)===JSON.stringify(before.paths),'canvas one undo');
 p=pos(210,160);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+20,p.y+30,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();check(JSON.stringify((await call('get_project')).paths)===JSON.stringify(before.paths),'Esc cancels drag');
 // Box selection in object mode excludes lower two paths.
 p=pos(120,130);let end=pos(490,345);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:8});await page.mouse.up();check((await state()).selectedPaths.length===2,'object marquee');
 await page.getByRole('button',{name:'节点 (A)',exact:true}).click();
 let active=(await state()).active;await call('select_node',{pathId:active,nodeIndex:1});
 let node=page.locator('[data-node-index="2"]');await node.click({modifiers:['Shift']});check((await state()).selectedNodes.length===2,'node additive');
 before=await call('get_project');const n=await page.locator('[data-node-index="1"]').boundingBox();p={x:n.x+n.width/2,y:n.y+n.height/2};await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+25,p.y+15,{steps:8});await page.mouse.up();doc=await call('get_project');const current=doc.paths.find(p=>p.id===active),old=before.paths.find(p=>p.id===active);check(current.curves[0][3].x===old.curves[0][3].x+25,'first node moved');check(current.curves[1][3].x===old.curves[1][3].x+25,'second node moved');check(current.start.x===old.start.x,'other node unchanged');check(current.curves[1][0].x===current.curves[0][3].x,'seam connected');
 await page.keyboard.press('Control+z');check(JSON.stringify((await call('get_project')).paths)===JSON.stringify(before.paths),'node drag one undo');
 await call('select_node',{pathId:active,nodeIndex:1});await page.locator('[data-node-index="2"]').click({modifiers:['Shift']});await page.keyboard.press('Delete');check((await call('get_project')).paths.find(p=>p.id===active).curves.length===1,'batch node delete');await page.keyboard.press('Control+z');check((await call('get_project')).paths.find(p=>p.id===active).curves.length===3,'delete one undo');
 await page.keyboard.press('Control+a');check((await state()).selectedNodes.length===4,'all nodes');
 await page.keyboard.press('Escape');check((await state()).selectedNodes.length===0 && (await state()).active===active,'first Escape nodes only');await page.keyboard.press('Escape');check((await state()).selectedPaths.length===0,'second Escape clears path');
 await page.screenshot({path:'../../outputs/统一交互-验证.png'});
 return {passed:true,checks:['range','toggle','group undo redo','batch tree drag','persistent tree','canvas translate','drag cancel','marquee paths','nodes multi select move delete','node CtrlA','layered Esc']};
}
