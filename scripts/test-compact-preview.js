async(page)=>{
 const call=(action,args={})=>page.evaluate(({action,args})=>window.traceStudio.call(action,args),{action,args});
 const example=await page.evaluate(()=>fetch('/character-example.bezier.json').then(r=>r.json()));await call('load_project',{project:example});await call('set_view',{fit:true});
 await page.setViewportSize({width:725,height:868});await page.locator('.compact-menu summary').click();await page.getByRole('button',{name:'操作帮助',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
 if(await page.locator('.outliner').isVisible()!==true)throw Error('compact tree missing');
 await page.setViewportSize({width:1352,height:1216});await call('set_view',{fit:true});
 const group=await call('manage_group',{action:'create',name:'角色轮廓'});await call('manage_group',{action:'assign',id:group.id,pathIds:example.paths.slice(0,5).map(p=>p.id)});await call('select_paths',{pathIds:example.paths.slice(0,3).map(p=>p.id)});await page.getByRole('tab',{name:'路径',exact:true}).click();await page.screenshot({path:'../../outputs/统一交互-工作台.png'});
 return {compactHelp:true,desktopTree:true,exampleOnly:true};
}
