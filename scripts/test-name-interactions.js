async (page) => {
 const check=(v,m)=>{if(!v)throw Error(m)};
 const call=async(action,args={})=>{const v=await page.evaluate(({action,args})=>window.traceStudio.call(action,args),{action,args});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));return v};
 await page.getByRole('tab',{name:'路径',exact:true}).click();
 const base=await call('get_project');await call('load_project',{project:{...base,paths:[],groups:[]}});
 const a=await call('create_path',{name:'测试路径',mode:'manual',points:[{x:100,y:100},{x:200,y:200}]});
 const g=await call('manage_group',{action:'create',name:'测试分组'});
 const group=page.locator('[data-group-id="'+g.id+'"]');
 await group.locator('.group-title').click();check(await group.getAttribute('open')!==null,'name keeps open');
 await group.locator('.group-toggle').click();check(await group.getAttribute('open')===null,'arrow closes');
 await group.locator('.group-title').click();check(await group.getAttribute('open')===null,'name keeps closed');
 await group.locator('.group-title').dblclick();await page.getByRole('textbox',{name:'重命名分组'}).fill('新分组');await page.getByRole('textbox',{name:'重命名分组'}).press('Enter');check(await group.getAttribute('open')===null,'rename keeps closed');
 await group.locator('.group-toggle').click();
 const row=page.locator('[data-path-id="'+a.id+'"]');
 await row.locator('.path-select').click();check(await page.getByLabel('所属分组',{exact:true}).count()===0,'assignment removed');check(await page.getByLabel('路径名称',{exact:true}).count()===0,'persistent rename removed');
 await row.locator('.path-title').dblclick();await page.getByRole('textbox',{name:'重命名路径'}).fill('新路径');await page.getByRole('textbox',{name:'重命名路径'}).press('Enter');
 check((await call('get_project')).paths[0].name==='新路径','rename commit');
 await page.keyboard.press('Control+z');check((await call('get_project')).paths[0].name==='测试路径','single undo');
 await row.locator('.path-title').dblclick();await page.getByRole('textbox',{name:'重命名路径'}).fill('取消');await page.getByRole('textbox',{name:'重命名路径'}).press('Escape');check((await call('get_project')).paths[0].name==='测试路径','escape cancels');
 await row.locator('.path-select').dragTo(group.locator('summary'));await group.locator('[data-path-id="'+a.id+'"]').waitFor();check((await call('get_project')).paths[0].groupId===g.id,'drag works');
 console.log('PASS: group toggle isolation, both rename, removed fields, undo, cancel, drag');
}
