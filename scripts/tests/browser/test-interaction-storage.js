async(page)=>{
 const call=async(action,args={})=>{const v=await page.evaluate(({action,args})=>window.traceStudio.call(action,args),{action,args});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));return v};const check=(v,m)=>{if(!v)throw Error(m)};
 await page.getByRole('button',{name:'选择 (V)',exact:true}).click();
 let doc=await call('get_project');const path=doc.paths[0];await call('select_paths',{pathIds:[path.id]});await call('set_view',{x:30,y:30,scale:1});
 await page.waitForTimeout(450);const backup=()=>page.evaluate(async()=>{const {workspaceDB}=await import('/persistence.mjs');return (await workspaceDB('get')).project});
 const saved=await backup();const st=await page.locator('.stage').boundingBox();let pos={x:st.x+30+180,y:st.y+30+180};await page.mouse.move(pos.x,pos.y);await page.mouse.down();await page.mouse.move(pos.x+40,pos.y+25,{steps:7});await page.waitForTimeout(1000);check(JSON.stringify((await backup()).paths)===JSON.stringify(saved.paths),'gesture never saved');await page.keyboard.press('Escape');await page.mouse.up();
 await page.mouse.move(pos.x,pos.y);await page.mouse.down();await page.mouse.move(pos.x+40,pos.y+25,{steps:7});await page.mouse.up();await page.waitForTimeout(500);doc=await call('get_project');check(JSON.stringify((await backup()).paths)===JSON.stringify(doc.paths),'commit saved');
 await page.reload();await page.locator('[data-path-id="'+path.id+'"]').waitFor();check(JSON.stringify((await call('get_project')).paths)===JSON.stringify(doc.paths),'reload restores exact geometry');check(JSON.stringify((await call('get_project')).groups)===JSON.stringify(doc.groups),'reload restores groups');
 await page.locator('[data-path-id="'+path.id+'"]').click();await page.keyboard.press('F2');await page.getByRole('textbox',{name:'重命名路径'}).fill('键盘改名');await page.getByRole('textbox',{name:'重命名路径'}).press('Enter');await page.keyboard.press('Control+z');check((await call('get_project')).paths.find(p=>p.id===path.id).name===path.name,'F2 undo');
 const svg=await call('export',{format:'svg'}),blend=await call('export',{format:'blender'});check(svg.content.includes('<g id="group-'),'SVG groups');check(blend.content.includes('group_collections'),'Blender groups');
 return {passed:true,checks:['no interim autosave','commit autosave','reload geometry and groups','F2','SVG','Blender']};
}
