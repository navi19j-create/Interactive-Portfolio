"""Run in a background copy of the camera-matched scene. Never save the blend."""
import sys
from pathlib import Path

import bpy


def swatch(hex_color):
    rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in rgb] + [1]


def surface(name):
    colors = [
        ("Button_Red", "dd2920"), ("Button_Yellow", "f4cc0f"),
        ("Button_Blue", "277ada"), ("Button_Green", "35ac50"),
        ("Button_Orange", "ef872c"), ("Button_Purple", "a456cc"),
        ("Button_Cyan", "19bbc2"), ("Menu Red", "df3630"),
        ("Housing", "eeeadd"), ("Label Grey", "383632"),
        ("Clean Dark", "242322"), ("Braid", "656462"),
        ("Pocket", "302f30"), ("Screen", "101112"), ("Bezel", "302f32"),
        ("Socket", "34383a"), ("Dark_Metal", "3a3c3e"), ("Indicator", "343436")
    ]
    for token, color in colors:
        if token in name:
            return color, 0.12 if token in {"Socket", "Dark_Metal"} else 0, 0.48
    return "bdc0c0", 0.84, 0.32


out, qa_path = sys.argv[sys.argv.index("--") + 1:]
assert Path(bpy.data.filepath).name == "master_v11_step10_Working.blend"
assert bpy.context.scene.camera.name == "CAM_v11_Hero_Ref"
graph = bpy.context.evaluated_depsgraph_get()
objects = [o for o in bpy.context.scene.objects if o.type in {"FONT", "CURVE", "MESH"}
           and not o.hide_render and not any(c.hide_render for c in o.users_collection)
           and not o.name.startswith(("GFX_Screen_", "GEO_Cyclorama", "GEO_Screen_Glass", "GEO_Display_Insert", "GEO_Knob_Indicator_v10"))]
materials = {}
bpy.ops.object.select_all(action="DESELECT")
copies = []
for obj in objects:
    evaluated = obj.evaluated_get(graph)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=graph)
    if not mesh.polygons:
        continue
    for i, source in enumerate(list(mesh.materials)):
        if source is None:
            continue
        key = source.name
        if key not in materials:
            color, metal, rough = surface(key)
            material = bpy.data.materials.new("Web " + key)
            material.diffuse_color = swatch(color)
            material.metallic = metal
            material.roughness = rough
            material.use_nodes = True
            shader = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
            shader.inputs["Base Color"].default_value = swatch(color)
            shader.inputs["Metallic"].default_value = metal
            shader.inputs["Roughness"].default_value = rough
            materials[key] = material
        mesh.materials[i] = materials[key]
    copy = bpy.data.objects.new("Web_" + obj.name, mesh)
    bpy.context.scene.collection.objects.link(copy)
    copy.matrix_world = obj.matrix_world.copy()
    copy.select_set(True)
    copies.append(copy)

bpy.context.view_layer.update()
sys.path.insert(0, qa_path)
import qa_check
report = qa_check.run(objects=[o.name for o in copies], profile="render", max_tris=45000, uv=False)
print("WEB_QA", report["errors"][:14], report["warnings"][:10], flush=True)
result = bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_format="GLB",
                                   export_animations=False, export_texcoords=False, export_yup=True)
assert result == {"FINISHED"}
print("WEB_EXPORT", len(copies), Path(out).stat().st_size)
