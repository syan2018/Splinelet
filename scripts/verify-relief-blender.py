"""Run after the app's generated Blender Python, in a fresh Blender process."""
import bpy, bmesh, json, math, sys
from pathlib import Path
out=Path(sys.argv[sys.argv.index('--')+1]).resolve()
source=json.loads((out/'Sandrone-relief.bezier.json').read_text(encoding='utf-8'))
objects={o.get('source_id'):o for o in bpy.data.objects if o.type=='CURVE' and o.get('source_id')}
assert len(objects)==71, len(objects)
scale=source['widthMM']/source['width']*.001
def point(p):return ((p['x']-source['width']/2)*scale,(source['height']/2-p['y'])*scale,0)
error=0
for p in source['paths']:
    spline=objects[p['id']].data.splines[0];cs=p['curves']
    assert spline.use_cyclic_u==p['closed']
    assert len(spline.bezier_points)==len(cs)+(0 if p['closed'] else 1)
    for i,c in enumerate(cs):
        a=spline.bezier_points[i];b=spline.bezier_points[(i+1)%len(spline.bezier_points)]
        for actual,expected in zip([a.co,a.handle_right,b.handle_left,b.co],map(point,c)):
            error=max(error,math.dist(actual,expected))
assert error<1e-8
obj=bpy.data.collections['描迹 · 浮雕实体'].objects[0]
bm=bmesh.new();bm.from_mesh(obj.data)
invalid=sum(not e.is_manifold for e in bm.edges)
degenerate=sum(f.calc_area()<1e-18 for f in bm.faces)
assert invalid==0 and degenerate==0,(invalid,degenerate)
report={'sourcePaths':len(objects),'maximumBezierErrorMM':error*1000,'triangles':len(bm.faces),'nonManifoldEdges':invalid,'degenerateFaces':degenerate,'volumeMM3':bm.calc_volume(signed=True)*1e9}
bm.free()
# Import the actual downloaded STL separately, and inspect its welded mesh.
bpy.ops.wm.stl_import(filepath=str(out/'Sandrone-browser.stl'),global_scale=.001)
stl=bpy.context.object
bm=bmesh.new();bm.from_mesh(stl.data)
bm.transform(stl.matrix_world)
assert all(e.is_manifold for e in bm.edges)
assert all(f.calc_area()>1e-18 for f in bm.faces)
report['stlTriangles']=len(bm.faces);report['stlVolumeMM3']=bm.calc_volume(signed=True)*1e9
assert abs(report['stlVolumeMM3']-report['volumeMM3'])<.01
bm.free();bpy.data.objects.remove(stl,do_unlink=True)
for name in ['Cube','Camera','Light']:
    o=bpy.data.objects.get(name)
    if o:bpy.data.objects.remove(o,do_unlink=True)
mat=bpy.data.materials.new('单色浮雕');mat.diffuse_color=(.45,.53,.6,1);obj.data.materials.append(mat)
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active;space.region_3d.view_distance=.18;space.region_3d.view_location=(.001,0,.002)
            from mathutils import Euler
            space.region_3d.view_rotation=Euler((math.radians(20),0,0),'XYZ').to_quaternion()
            space.shading.type='SOLID';space.shading.light='STUDIO';space.shading.show_cavity=True
bpy.ops.wm.save_as_mainfile(filepath=str(out/'Sandrone-relief.blend'))
(out/'blender-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('VERIFIED_APP_EXPORT',json.dumps(report))
