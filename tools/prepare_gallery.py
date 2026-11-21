"""Run with Blender in background on the v11 gallery. Writes only the web GLB."""
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

output, qa_dir = sys.argv[sys.argv.index("--") + 1:]
scene = bpy.context.scene
assert Path(bpy.data.filepath).name == "ArtStudio_Client_v11.blend"
graph = bpy.context.evaluated_depsgraph_get()
materials = {}
architecture = []
paintings = []
solids = []
spots = []


def web_point(point):
    return [round(point.x, 4), round(point.z, 4), round(-point.y, 4)]


def web_material(source):
    if source.name not in materials:
        material = bpy.data.materials.new("Web_" + source.name)
        material.diffuse_color = source.diffuse_color
        material.roughness = .92
        material.use_nodes = True
        shader = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        shader.inputs["Base Color"].default_value = source.diffuse_color
        shader.inputs["Roughness"].default_value = .92
        materials[source.name] = material
    return materials[source.name]


for source in list(scene.objects):
    if source.hide_render or all(c.hide_render for c in source.users_collection):
        continue
    if source.type == "LIGHT" and source.data.type == "SPOT" and source.data.energy > 0:
        direction = source.matrix_world.to_quaternion() @ Vector((0, 0, -1))
        spots.append([web_point(source.matrix_world.translation), web_point(direction), source.data.spot_size / 2])
    if source.type not in {"MESH", "FONT"} or source.name.startswith(("ART_v10_Thin_Atmosphere", "REF_", "ART_Plan_")):
        continue
    mesh = bpy.data.meshes.new_from_object(source.evaluated_get(graph), depsgraph=graph)
    if not mesh.polygons:
        continue
    for i, mat in enumerate(list(mesh.materials)):
        if mat:
            mesh.materials[i] = web_material(mat)
    if mesh.uv_layers.active:
        mesh.uv_layers.active.name = "UV"
    mesh.transform(source.matrix_world)
    if source.name.endswith("_Flutes"):
        # Each channel is backed by an opaque core. Retain the outward ribbon.
        axis = Vector((0, 0, 1)) if "_Top" in source.name else Vector((-1 if "_Edge_-1" in source.name else 1, 0, 0))
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.normal_update()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.dot(axis) < .99], context="FACES")
        bm.to_mesh(mesh)
        bm.free()
    copy = bpy.data.objects.new("Tour_" + source.name, mesh)
    scene.collection.objects.link(copy)
    if source.get("artwork_id") and source.name.startswith("ART_v07_Image_"):
        copy["painting"] = source["artwork_id"]
        paintings.append(copy)
    else:
        architecture.append(copy)
    if source.name.startswith(("ART_A09_Partition_", "ART_A08_Wood_Pillar", "ART_A08_Wall_Timber_Post", "ART_A13_Pedestal")):
        points = [web_point(source.matrix_world @ Vector(v)) for v in source.bound_box]
        solids.append([min(p[0] for p in points), max(p[0] for p in points),
                       min(p[2] for p in points), max(p[2] for p in points)])

bpy.ops.object.select_all(action="DESELECT")
for obj in architecture:
    obj.select_set(True)
bpy.context.view_layer.objects.active = architecture[0]
assert bpy.ops.object.join() == {"FINISHED"}
room = bpy.context.object
room.name = "Gallery"
import json
room["walkLayout"] = json.dumps({"solids": solids, "spots": spots})
assert len(paintings) == 6 and len(solids) >= 9 and len(spots) >= 6
for obj in paintings:
    obj.select_set(True)
sys.path.insert(0, qa_dir)
import qa_check
# Artwork is intentionally single-sided. Check the six selectable surfaces separately.
for obj in paintings:
    report = qa_check.run(objects=[obj.name], profile="render", uv=True)
    assert not report["errors"], report["errors"]
    assert len(obj.data.polygons) == 1 and len(obj.data.uv_layers)
print("EXPORT", len(solids), "collision boxes;", len(spots), "spotlights;", len(materials), "materials", flush=True)
assert bpy.ops.export_scene.gltf(filepath=output, use_selection=True, export_extras=True,
                                 export_meshopt_compression_enable=True,
                                 export_animations=False, export_format="GLB") == {"FINISHED"}
