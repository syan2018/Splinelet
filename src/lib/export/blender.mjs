/** Self-contained Blender script. V4 mm/y-up world geometry becomes Blender meters/z-up. */
export function blenderScript(value, domain) {
  const payload = JSON.stringify(JSON.stringify(value));
  const common = `import bpy, json\ndata = json.loads(${payload})\ncollection = bpy.data.collections.new("Splinelet")\nbpy.context.scene.collection.children.link(collection)\n`;
  if (domain === 'curves')
    return (
      common +
      `for curve in data["curves"]:
    shape = bpy.data.curves.new(curve.get("key", "Line"), 'CURVE')
    shape.dimensions = '3D'
    edges = curve["edges"]
    if not edges:
        continue
    spline = shape.splines.new('BEZIER')
    closed = curve.get("closed", False)
    spline.use_cyclic_u = closed
    spline.bezier_points.add(len(edges) - 1 if closed else len(edges))
    for point in spline.bezier_points:
        point.handle_left_type = point.handle_right_type = 'FREE'
    for index, edge in enumerate(edges):
        cubic = edge["cubic"]
        a = spline.bezier_points[index]
        b = spline.bezier_points[(index + 1) % len(spline.bezier_points)]
        a.co = (cubic[0][0] / 1000, cubic[0][1] / 1000, 0)
        a.handle_right = (cubic[1][0] / 1000, cubic[1][1] / 1000, 0)
        b.co = (cubic[3][0] / 1000, cubic[3][1] / 1000, 0)
        b.handle_left = (cubic[2][0] / 1000, cubic[2][1] / 1000, 0)
    if not closed:
        spline.bezier_points[0].handle_left = spline.bezier_points[0].co
        spline.bezier_points[-1].handle_right = spline.bezier_points[-1].co
    obj = bpy.data.objects.new(curve.get("key", "Line"), shape)
    collection.objects.link(obj)
`
    );
  return (
    common +
    `for body in data["bodies"]:
    parent = bpy.data.objects.new(body["partId"], None)
    collection.objects.link(parent)
    for index, part in enumerate(body["materialParts"]):
        source = part["mesh"]
        positions = source["positions"]
        triangles = source["triangles"]
        vertices = [tuple(v / 1000 for v in positions[i:i+3]) for i in range(0, len(positions), 3)]
        faces = [tuple(triangles[i:i+3]) for i in range(0, len(triangles), 3)]
        mesh = bpy.data.meshes.new(body["partId"] + str(index))
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(mesh.name, mesh)
        collection.objects.link(obj)
        obj.parent = parent
        color = part.get("color") or "#808080"
        material = bpy.data.materials.new(color)
        material.diffuse_color = tuple(int(color[i:i+2], 16) / 255 for i in (1, 3, 5)) + (1,)
        mesh.materials.append(material)
`
  );
}
