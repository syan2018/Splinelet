async(page)=>{
  const check=(v,m)=>{if(!v)throw Error(m)};
  const call=async(action,args={})=>{const r=await page.evaluate(({action,args})=>window.traceStudio.call(action,args),{action,args});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));return r;};
  await page.locator('input[type=file][accept=".json"]').setInputFiles('../../outputs/Sandrone-app-relief/Sandrone-relief.bezier.json');
  for(let i=0;i<120;i++){if((await call('get_project')).model?.features.length===64)break;}
  const original=await call('get_project');check(original.paths.length===71,'loaded all paths');
  await call('set_workspace',{mode:'relief'});
  let state;
  for(let i=0;i<600;i++){state=await call('state');if(state.model.report?.valid&&!state.model.calculating)break;if(state.model.error)throw Error(state.model.error);}
  check(state.model.report?.valid&&state.model.report.components===1,'actual worker produces one closed solid');
  await page.getByRole('button',{name:'立体',exact:true}).click();
  await page.getByRole('tab',{name:'制造 / 导出',exact:true}).click();
  await page.screenshot({path:'../../outputs/Sandrone-app-relief/应用-浮雕.png'});
  await page.getByRole('button',{name:'正视',exact:true}).click();
  await page.screenshot({path:'../../outputs/Sandrone-app-relief/应用-正视.png'});
  for(const [label,file] of [['打印 STL','Sandrone-browser.stl'],['Blender 实体 + 源曲线','Sandrone-blender.py']]){
    const event=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const download=await event;
    await download.saveAs('../../outputs/Sandrone-app-relief/'+file);
  }
  await call('set_workspace',{mode:'faces'});
  await call('preview_region',{kind:'split',baseId:'source-11',pathIds:original.paths.slice(16,23).map(p=>p.id),joinMM:.7});
  const preview=(await call('state')).model.preview;check(preview.candidates.length===11,'11 hair choices displayed');
  await page.screenshot({path:'../../outputs/Sandrone-app-relief/应用-头发分区.png'});
  await call('discard_region_preview');
  await call('select_regions',{regionIds:['border','face-cut','band-hole']});
  await page.getByRole('tab',{name:'制造 / 导出',exact:true}).click();
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'导出所选面 SVG',exact:true}).click();const download=await event;
  await download.saveAs('../../outputs/Sandrone-app-relief/Sandrone-boolean-examples.svg');
  check(JSON.stringify((await call('get_project')).paths)===JSON.stringify(original.paths),'browser operations never changed sources');
  await call('set_workspace',{mode:'relief'});await page.getByRole('button',{name:'立体',exact:true}).click();
  return {report:state.model.report,regions:original.model.regions.length,features:original.model.features.length,sourcePaths:71};
}
