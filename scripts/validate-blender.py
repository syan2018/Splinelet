import bpy, pathlib, json, math
root=pathlib.Path(__file__).resolve().parents[3]
source=root/'outputs'/'角色曲线_blender.py'
exec(compile(source.read_text(encoding='utf-8'),str(source),'exec'))
collection=bpy.data.collections.get('描迹 · Imported curves')
assert collection is not None
assert len(collection.objects)==44
expected=json.loads((root/'outputs'/'描迹工程.bezier.json').read_text(encoding='utf-8'))
report={'blender':bpy.app.version_string,'objects':len(collection.objects),'curves':0,'closed':0,'bezier_points':0,'max_control_error_m':0}
for item in expected['paths']:
    obj=collection.objects.get(item['name'])
    assert obj is not None and obj.type=='CURVE'
    spline=obj.data.splines[0]
    assert spline.use_cyclic_u == item['closed']
    assert len(spline.bezier_points)==len(item['curves'])+(0 if item['closed'] else 1)
    report['curves']+=1
    report['closed']+=int(item['closed'])
    report['bezier_points']+=len(spline.bezier_points)
    for i,c in enumerate(item['curves']):
        for source_point,actual in [(c[0],spline.bezier_points[i].co),(c[1],spline.bezier_points[i].handle_right),(c[2],spline.bezier_points[(i+1)%len(spline.bezier_points)].handle_left)]:
            expected_point=((source_point['x']-expected['width']/2)*scale,(expected['height']/2-source_point['y'])*scale,0)
            err=math.dist(expected_point,actual)
            report['max_control_error_m']=max(err,report['max_control_error_m'])
            assert err<1e-7
    obj.show_wire=True
    obj.display_type='WIRE'
    if item['closed']:
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh=evaluated.to_mesh()
        assert len(mesh.polygons)>0
        evaluated.to_mesh_clear()
# Remove default objects in this factory-startup verification scene only.
for obj in list(bpy.context.scene.objects):
    if obj.name not in collection.objects:
        bpy.data.objects.remove(obj,do_unlink=True)
for obj in collection.objects: obj.select_set(True)
bpy.context.view_layer.objects.active=collection.objects[0]
from mathutils import Quaternion
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active
            space.shading.type='WIREFRAME'
            space.region_3d.view_rotation=Quaternion((1,0,0,0))
            space.region_3d.view_distance=.16
            space.region_3d.view_location=(0,0,0)
            space.region_3d.view_perspective='ORTHO'
bpy.ops.wm.save_as_mainfile(filepath=str(root/'outputs'/'角色曲线.blend'))
(root/'outputs'/'Blender验证.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('VALIDATION',json.dumps(report))
