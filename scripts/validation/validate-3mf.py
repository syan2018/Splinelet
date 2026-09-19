"""Independent OPC/XML check against the consortium's published core schema."""
import json
import pathlib
import re
import sys
import urllib.request
import zipfile
from lxml import etree

output = pathlib.Path(__file__).resolve().parents[2] / 'outputs' / '3mf'
output.mkdir(parents=True, exist_ok=True)
schema_path = output / 'core.xsd'
if not schema_path.exists():
    url = 'https://raw.githubusercontent.com/3MFConsortium/spec_core/master/3MF%20Core%20Specification.md'
    doc = urllib.request.urlopen(url, timeout=30).read().decode()
    schemas = re.findall(r'```xml\s*(.*?)```', doc, re.S)
    schema = next(s for s in schemas if '<xs:schema' in s and 'CT_Model' in s)
    schema = schema.replace('http://www.w3.org/2001/xml.xsd', 'xml.xsd')
    schema_path.write_text(schema, encoding='utf-8')
    (output / 'xml.xsd').write_bytes(urllib.request.urlopen('https://www.w3.org/2001/xml.xsd', timeout=30).read())
# libxml2 caps occurrence counts below the spec's 2^31-1. Use a schema
# implementation that accepts the published XSD without modifying its limits.
sys.path.insert(0, str(output / 'validation-deps'))
import xmlschema
schema = xmlschema.XMLSchema(str(schema_path))
ns = {'m': 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'}
for filename in sys.argv[1:]:
    with zipfile.ZipFile(filename) as archive:
        assert archive.testzip() is None
        model = etree.fromstring(archive.read('3D/3dmodel.model'))
        schema.validate(etree.tostring(model))
        relationship = etree.fromstring(archive.read('_rels/.rels'))[0]
        assert relationship.get('Target').lstrip('/') in archive.namelist()
        assert model.get('unit') == 'millimeter'
        resources = {r.get('id'): r for r in model.find('m:resources', ns)}
        assert len(resources) == len(model.find('m:resources', ns))
        meshes = model.findall('m:resources/m:object/m:mesh', ns)
        for mesh in meshes:
            count = len(mesh.find('m:vertices', ns))
            for t in mesh.find('m:triangles', ns):
                assert all(0 <= int(t.get(k)) < count for k in ['v1', 'v2', 'v3'])
            obj = mesh.getparent()
            material = resources[obj.get('pid')]
            assert int(obj.get('pindex')) < len(material)
        for component in model.findall('.//m:component', ns):
            assert component.get('objectid') in resources
        build = model.find('m:build', ns)
        assert len(build) == 1
        assert resources[build[0].get('objectid')].find('m:components', ns) is not None
        print(json.dumps({'file': str(filename), 'official_schema': 'valid', 'meshes': len(meshes), 'materials': len(model.findall('m:resources/m:basematerials/m:base', ns))}, ensure_ascii=False))
