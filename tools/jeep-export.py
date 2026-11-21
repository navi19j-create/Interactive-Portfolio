"""Prepare the shared deployed race asset from the Little Box Jeep art archive.

Run Blender in background with the Ferrari livery open, then pass the source and
output directories after --, followed by the QA image directory. Run with
--factory-startup and --python-exit-code 1. Source files are opened read-only.
Requires ffmpeg on PATH for the WebP paint textures.
"""
import json
import math
from pathlib import Path
import subprocess
import sys

import bmesh
import bpy
from mathutils import Vector

source, destination, review = map(Path, sys.argv[sys.argv.index("--") + 1:])
sys.path.insert(0, str(source / "scripts"))
skills = Path.home() / ".agents/skills"
sys.path.insert(0, str(skills / "blender-asset-qa/scripts"))
sys.path.insert(0, str(skills / "blender-export-pipelines/scripts"))
from lbj import livery, materials
import qa_check
import export_asset

scene = bpy.context.scene
view = bpy.context.view_layer
rig = bpy.data.objects["LBJ_Rig"]
# Keep the source boolean walls and grille, but reduce live bevel segments
# before evaluation. Triangle collapse on the sheet metal distorted the panels.
for original in scene.objects:
    if original.type == "MESH" and any(slot and slot.name == "LBJ_livery_ferrari" for slot in original.data.materials):
        for modifier in original.modifiers:
            if modifier.type == "BEVEL":
                modifier.segments = 1
view.update()
dependency_graph = bpy.context.evaluated_depsgraph_get()
collection = bpy.data.collections.new("Web Race Vehicle")
scene.collection.children.link(collection)
corners = ["FL", "FR", "RL", "RR"]
scale = 2.65
pivot = {tag: bpy.data.objects[f"wheel_{tag}"].matrix_world.translation.copy() for tag in corners}
axes = {tag: rig.matrix_world @ rig.pose.bones[f"knuckle_{tag}"].head for tag in corners}
paint_source = bpy.data.materials["LBJ_livery_ferrari"]
shade_cache = {}
colors = {
    "steel_bolt": (102, 105, 111), "steel_charcoal": (52, 54, 60),
    "steel_bare": (170, 172, 175), "steel_cast": (78, 82, 89),
    "steel_bezel": (130, 137, 145), "rubber_tire": (33, 34, 37),
    "rubber_black": (41, 42, 45), "paint_black": (29, 31, 36),
    "paint_plate_grey": (129, 134, 140), "leather_seat": (57, 58, 63),
    "plastic_dark": (61, 63, 71), "plastic_grip": (47, 47, 53),
    "plastic_white": (214, 215, 213), "tyre_marking": (207, 208, 201),
    "livery_number": (238, 238, 236), "lcd_ink": (59, 48, 24),
    "plastic_red": (187, 35, 32), "lcd_orange": (255, 182, 47),
    "glass_amber": (255, 127, 22), "glass_red": (234, 29, 39),
    "lamp_reflector": (190, 222, 250), "glass_lens": (190, 222, 250)
}


def material(name, color=(1, 1, 1, 1), roughness=.42, metal=0, emission=0):
    result = bpy.data.materials.new(name)
    nodes = result.node_tree.nodes
    shader = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metal
    if name == "Trim":
        tint = nodes.new("ShaderNodeVertexColor")
        tint.layer_name = "Tint"
        result.node_tree.links.new(tint.outputs["Color"], shader.inputs["Base Color"])
    if emission:
        shader.inputs["Emission Color"].default_value = color
    shader.inputs["Emission Strength"].default_value = emission
    return result


trim = material("Trim", roughness=.57, metal=.06)
lamps = {
    "Headlamp": material("Headlamp", materials.srgb(185, 221, 246), .25, emission=.45),
    "Tail": material("Tail", materials.srgb(242, 42, 42), .29, emission=.45),
    "Amber": material("Amber", materials.srgb(252, 135, 40), .29, emission=.38)
}
rim = material("Rims", roughness=.34, metal=.22)
groups = {}
source_tris = 0


def new_part(source_object, family, factor, selected_faces=None):
    global source_tris
    evaluated = source_object.evaluated_get(dependency_graph)
    mesh = bpy.data.meshes.new_from_object(evaluated)
    mesh.transform(evaluated.matrix_world)
    mesh.calc_loop_triangles()
    source_tris += len(mesh.loop_triangles)
    for layer in list(mesh.uv_layers):
        mesh.uv_layers.remove(layer)
    source_materials = list(mesh.materials)
    if selected_faces is not None:
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index not in selected_faces], context="FACES")
        bm.to_mesh(mesh)
        bm.free()
    part = bpy.data.objects.new(source_object.name + "_web", mesh)
    collection.objects.link(part)
    if factor < 1 or family == "Paint":
        simplify = part.modifiers.new("Web triangle budget", "DECIMATE")
        if family == "Paint":
            simplify.decimate_type = "DISSOLVE"
            simplify.angle_limit = math.radians(5)
        else:
            simplify.ratio = factor
        with bpy.context.temp_override(object=part, active_object=part):
            bpy.ops.object.modifier_apply(modifier=simplify.name)
    mesh = part.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00002)
    bmesh.ops.dissolve_degenerate(bm, dist=.00001, edges=list(bm.edges))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bad_faces = [f for f in bm.faces if f.calc_area() < .000000002]
    if bad_faces:
        bmesh.ops.delete(bm, geom=bad_faces, context="FACES_ONLY")
    for edge in list(bm.edges):
        if edge.is_wire:
            bm.edges.remove(edge)
    for vertex in list(bm.verts):
        if not vertex.link_edges:
            bm.verts.remove(vertex)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if family == "Paint" or source_object.name.startswith(("bumper_bar", "control_panel", "panel_plate")):
        for face in bm.faces:
            face.smooth = False
    else:
        for edge in bm.edges:
            if edge.is_manifold and edge.calc_face_angle() > math.radians(37):
                edge.smooth = False
    bm.to_mesh(mesh)
    bm.free()
    if source_object.name == "seat_pad":
        for vertex in mesh.vertices:
            vertex.co.z -= .006
    if family == "Trim":
        tint = mesh.color_attributes.new(name="Tint", type="BYTE_COLOR", domain="CORNER")
        for face in mesh.polygons:
            source_material = source_materials[face.material_index]
            name = source_material.name.removeprefix("LBJ_")
            if name not in shade_cache:
                shade_cache[name] = materials.srgb(*colors.get(name, (81, 84, 93)))
            for index in face.loop_indices:
                tint.data[index].color = shade_cache[name]
    mesh.materials.clear()
    mesh.materials.append(paint_source if family == "Paint" else rim if family == "Rim" else lamps.get(family, trim))
    for face in mesh.polygons:
        face.material_index = 0
    mesh.validate(clean_customdata=True)
    custom_normals = mesh.attributes.get("custom_normal")
    if custom_normals is not None:
        mesh.attributes.remove(custom_normals)
    return part


destination.mkdir(parents=True, exist_ok=True)
review.mkdir(parents=True, exist_ok=True)
originals = list(scene.objects)
for ob in originals:
    if ob.type != "MESH" or ob.hide_render or not ob.data.materials:
        continue
    name = ob.name
    if name.startswith(("STUDIO", "wheel_tire_FL", "wheel_tire_FR", "wheel_tire_RL", "wheel_tire_RR",
                        "headlamp_dome", "axle_hub", "wheel_marking", "indicator_ink", "frame_ears",
                        "joystick_buttons")):
        continue
    if "_bolts" in name and not name.startswith(("shell", "battery")):
        continue
    wheel = ob.parent.name[6:] if ob.parent and ob.parent.name.startswith("wheel_") else None
    part_name = f"Wheel_{wheel}" if wheel else "Body"
    if name.startswith("axle_knuckle") and ob.parent_bone[-2:] in ["FL", "FR"]:
        part_name = f"Knuckle_{ob.parent_bone[-2:]}"
    categories = {"LBJ_paint_rim": "Rim", "LBJ_glass_red": "Tail", "LBJ_glass_amber": "Amber",
                  "LBJ_lamp_reflector": "Headlamp", "LBJ_lcd_orange": "Amber"}
    slots = {}
    for index, slot in enumerate(ob.data.materials):
        family = "Paint" if slot == paint_source else categories.get(slot.name, "Trim")
        slots.setdefault(family, set()).add(index)
    for family, indices in slots.items():
        factor = .19 if family == "Paint" else .032 if wheel else .041
        if name.startswith(("headlamp_ball", "headlamp_bezel", "wheel_tire_f1", "bumper_")):
            factor = .069 if not name.startswith("bumper") else .19
        if name == "livery_number":
            factor = .55
        if name.startswith("battery_tail_lights"):
            factor = .28
        part = new_part(ob, family, factor, indices if len(slots) > 1 else None)
        groups.setdefault((part_name, family), []).append(part)

qa_parts = [p.name for parts in groups.values() for p in parts]
part_qa = qa_check.run(objects=qa_parts, profile="game", eps=.00003, tol=.006, uv=False)
(review / "by-source-qa.json").write_text(json.dumps(part_qa, indent=2))

for ob in originals:
    ob.select_set(False)
    ob.hide_set(True)


def select(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    view.objects.active = objects[0]


joined = {}
for (part_name, family), parts in groups.items():
    select(parts)
    if len(parts) > 1:
        bpy.ops.object.join()
    result = view.objects.active
    result.name = f"{part_name}_{family}" if (part_name, family) != ("Body", "Paint") else "Paint"
    result.data.validate(clean_customdata=True)
    custom_normals = result.data.attributes.get("custom_normal")
    if custom_normals is not None:
        result.data.attributes.remove(custom_normals)
    joined[(part_name, family)] = result

painted = joined[("Body", "Paint")]
select([painted])
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(52), island_margin=.001, correct_aspect=False)
bpy.ops.object.mode_set(mode="OBJECT")

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 1
scene.render.bake.margin = 3
scene.render.bake.margin_type = "ADJACENT_FACES"
for skin, filename in [("ferrari", "rosso"), ("astonmartin", "viridian"),
                       ("mclaren", "papaya"), ("mercedes", "silver")]:
    if skin == "ferrari":
        authored = paint_source.copy()
    else:
        path = source / "blend/liveries" / f"little_box_jeep_{skin}.blend"
        with bpy.data.libraries.load(str(path), link=False) as (available, imported):
            name = f"LBJ_livery_{skin}"
            if name not in available.materials:
                raise ValueError(f"Missing paint material {name} in {path}")
            imported.materials = [name]
        authored = imported.materials[0]
    authored.name = f"Bake_{filename}"
    painted.data.materials[0] = authored
    node_tree = authored.node_tree
    for node in list(node_tree.nodes):
        if node.type == "TEX_COORD" and node.object:
            node.object = bpy.data.objects[livery.REF_NAME]
        if node.type == "TEX_IMAGE":
            for link in list(node.outputs["Alpha"].links):
                link.to_socket.default_value = 0
            node_tree.nodes.remove(node)
    shader = next(n for n in node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    connected_color = shader.inputs["Base Color"].links[0].from_socket
    emission = node_tree.nodes.new("ShaderNodeEmission")
    node_tree.links.new(connected_color, emission.inputs["Color"])
    surface = next(n for n in node_tree.nodes if n.type == "OUTPUT_MATERIAL")
    node_tree.links.new(emission.outputs["Emission"], surface.inputs["Surface"])
    picture = bpy.data.images.new(filename, 1024, 1024, alpha=False)
    picture.colorspace_settings.name = "sRGB"
    target = node_tree.nodes.new("ShaderNodeTexImage")
    target.image = picture
    node_tree.nodes.active = target
    bpy.ops.object.bake(type="EMIT")
    picture.filepath_raw = str(review / f"{filename}.png")
    picture.file_format = "PNG"
    picture.save()
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", picture.filepath_raw, "-c:v", "libwebp", "-quality", "94",
        str(destination / f"{filename}.webp")
    ], check=True)
    print("BAKED", filename, flush=True)

painted.data.materials[0] = material("Race_Paint", roughness=.32, metal=.06)

# Create real steering and roll pivots, with the original source pivot separation.
ground = min(v.co.z for tag in corners for v in joined[(f"Wheel_{tag}", "Trim")].data.vertices)


def local_point(point):
    return Vector((point.x, point.y, point.z - ground)) * scale


def empty(name, parent=None, point=None):
    ob = bpy.data.objects.new(name, None)
    collection.objects.link(ob)
    ob.parent = parent
    if point is not None:
        ob.location = point
    return ob


body = empty("Chassis", point=Vector((0, 0, .85)))
steers = {tag: empty(f"Steer_{tag}", point=local_point(axes[tag])) for tag in corners[:2]}
rolls = {tag: empty(f"Roll_{tag}", parent=steers.get(tag), point=local_point(pivot[tag]) - (steers[tag].location if tag in steers else Vector())) for tag in corners}

for (part_name, _), ob in joined.items():
    parent = body if part_name == "Body" else steers[part_name[-2:]] if part_name.startswith("Knuckle") else rolls[part_name[-2:]]
    anchor = parent.location.copy()
    if parent.parent:
        anchor += parent.parent.location
    for v in ob.data.vertices:
        v.co = local_point(v.co) - anchor
    ob.parent = parent
    ob.data.update()

view.update()
all_parts = list(joined.values())
qa = qa_check.run(objects=[p.name for p in all_parts], profile="game", eps=.00008, tol=.015, uv=False)
qa["paint_uv"] = qa_check.run(objects=[painted.name], profile="game", eps=.00008, tol=.015)["objects"][painted.name]
(review / "qa.json").write_text(json.dumps(qa, indent=2))
result = export_asset.run(preset="web", collection=collection.name, out=str(destination / "little-box.glb"), no_anim=True)
print("SOURCE TRIANGLES", source_tris)
print("@@EXPORT@@", json.dumps(result), flush=True)


# Render the same simplified geometry and bake used by the browser.
for original in originals:
    original.hide_render = True
scene.compositing_node_group = None
scene.render.resolution_x = 640
scene.render.resolution_y = 400
scene.render.resolution_percentage = 100
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.render.image_settings.file_format = "PNG"
scene.world = bpy.data.worlds.new("Review World")
scene.world.node_tree.nodes.get("Background").inputs["Color"].default_value = (.63, .71, .86, 1)
scene.world.node_tree.nodes.get("Background").inputs["Strength"].default_value = .75
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.005))
floor = bpy.context.object
floor.data.materials.append(material("Review Floor", (.075, .09, .11, 1), .8))
bpy.ops.object.light_add(type="SUN", rotation=(.55, -.56, -.28))
bpy.context.object.data.energy = 2.4
bpy.context.object.data.angle = .09
bpy.ops.object.camera_add()
camera = bpy.context.object
scene.camera = camera
camera.data.lens = 42

paint = painted.data.materials[0]
paint_graph = paint.node_tree
paint_tex = paint_graph.nodes.new("ShaderNodeTexImage")
paint_graph.links.new(paint_tex.outputs["Color"], next(n for n in paint_graph.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"])
for variant, name in [("ferrari", "rosso"), ("astonmartin", "viridian"), ("mclaren", "papaya"), ("mercedes", "silver")]:
    paint_tex.image = bpy.data.images[name]
    next(n for n in rim.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = materials.srgb(*livery.LIVERIES[variant]["rim"])
    for label, position in [("front", (5, -6.1, 3.15)), ("chase", (1.6, 7.4, 4))]:
        camera.location = position
        camera.rotation_euler = (Vector((0, 0, 1.18)) - camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(review / f"{name}-{label}.png")
        bpy.ops.render.render(write_still=True)


paint_graph.links.remove(next(n for n in paint_graph.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].links[0])
scene.render.filepath = str(review / "paint-clay.png")
bpy.ops.render.render(write_still=True)
