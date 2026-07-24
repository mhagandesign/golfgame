"""Blender script: renders a golf refreshment kiosk as an isometric sprite.

Styled to match the clubhouse — white clapboard walls, red shingle pyramid
roof, a serving counter and a striped awning whose colour distinguishes the
three kinds (drinks / snacks / toilet). Dimetric 2:1 camera; NW sun.

Usage: blender -b -P kiosk.py -- <drinks|snacks|toilet>
"""
import bpy
import bmesh
import math
import sys

colorway = sys.argv[-1]
AWNING = {
    'drinks': ((0.16, 0.34, 0.58), (0.9, 0.93, 0.96)),
    'snacks': ((0.62, 0.16, 0.13), (0.95, 0.9, 0.8)),
    'toilet': ((0.2, 0.4, 0.28), (0.9, 0.94, 0.9)),
}[colorway]

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 180
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'
scene.render.resolution_x = 560
scene.render.resolution_y = 560
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'


def flat_mat(name, color, rough=0.7, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def brick_mat(name, c1, c2, mortar, rows, cols, rough=0.8, mortar_size=0.012, bump=0.35):
    """Row-patterned material (shingles / clapboard) via the brick texture."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    tex = nt.nodes.new('ShaderNodeTexBrick')
    tex.offset = 0.5
    tex.inputs['Color1'].default_value = (*c1, 1)
    tex.inputs['Color2'].default_value = (*c2, 1)
    tex.inputs['Mortar'].default_value = (*mortar, 1)
    tex.inputs['Scale'].default_value = 1
    tex.inputs['Mortar Size'].default_value = mortar_size
    tex.inputs['Brick Width'].default_value = 1 / max(cols, 0.001)
    tex.inputs['Row Height'].default_value = 1 / rows
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'ADD'
    nt.links.new(coord.outputs['Object'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['X'], add.inputs[0])
    nt.links.new(sep.outputs['Y'], add.inputs[1])
    nt.links.new(add.outputs['Value'], comb.inputs['X'])
    nt.links.new(sep.outputs['Z'], comb.inputs['Y'])
    nt.links.new(comb.outputs['Vector'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bmp = nt.nodes.new('ShaderNodeBump')
    bmp.inputs['Strength'].default_value = bump
    nt.links.new(tex.outputs['Fac'], bmp.inputs['Height'])
    nt.links.new(bmp.outputs['Normal'], bsdf.inputs['Normal'])
    return m


SHINGLE = brick_mat('shingle', (0.32, 0.09, 0.055), (0.26, 0.07, 0.05), (0.15, 0.04, 0.03), rows=8, cols=12, rough=0.85)
CLAPBOARD = brick_mat('clapboard', (0.95, 0.94, 0.9), (0.9, 0.89, 0.85), (0.72, 0.71, 0.67), rows=9, cols=0.001, rough=0.7, mortar_size=0.008, bump=0.25)
TRIM = flat_mat('trim', (0.96, 0.95, 0.91), 0.55)
COUNTER = flat_mat('counter', (0.55, 0.38, 0.22), 0.55)
DARK = flat_mat('dark', (0.09, 0.08, 0.07), 0.9)
STONE = flat_mat('stone', (0.55, 0.53, 0.49), 0.9)
AWN_A = flat_mat('awnA', AWNING[0], 0.6)
AWN_B = flat_mat('awnB', AWNING[1], 0.6)


def box(name, sx, sy, sz, x, y, z, material, bevel=0.01):
    bpy.ops.mesh.primitive_cube_add(location=(x, y, z))
    ob = bpy.context.object
    ob.name = name
    ob.scale = (sx / 2, sy / 2, sz / 2)
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = ob.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
    ob.data.materials.append(material)
    return ob


# ── Kiosk body ────────────────────────────────────────────────────────────
FRONT = -0.55
box('footing', 1.34, 1.34, 0.12, 0, 0, 0.06, STONE)
box('walls', 1.1, 1.1, 1.0, 0, 0, 0.6, CLAPBOARD)
for cxp in (-0.55, 0.55):
    for cyp in (-0.55, 0.55):
        box(f'post{cxp}{cyp}', 0.09, 0.09, 1.02, cxp, cyp, 0.6, TRIM)

# Serving window on the front (-Y): dark recess + wood counter ledge.
box('window', 0.72, 0.06, 0.5, 0, FRONT + 0.02, 0.72, DARK, bevel=0)
box('counter', 0.92, 0.28, 0.07, 0, FRONT - 0.12, 0.5, COUNTER)
box('counterlip', 0.92, 0.05, 0.03, 0, FRONT - 0.25, 0.52, TRIM, bevel=0)

# Pyramid shingle roof with eave overhang.
hw = 0.72
wallTop = 1.1
apex = 1.62
mesh = bpy.data.meshes.new('roof')
bm = bmesh.new()
v = [
    bm.verts.new((-hw, -hw, wallTop)),
    bm.verts.new((hw, -hw, wallTop)),
    bm.verts.new((hw, hw, wallTop)),
    bm.verts.new((-hw, hw, wallTop)),
    bm.verts.new((0, 0, apex)),
]
for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
    bm.faces.new([v[a], v[b], v[4]])
bm.faces.new([v[0], v[3], v[2], v[1]])
bm.to_mesh(mesh)
roof = bpy.data.objects.new('roofobj', mesh)
bpy.context.collection.objects.link(roof)
mesh.materials.append(SHINGLE)
sol = roof.modifiers.new('sol', 'SOLIDIFY')
sol.thickness = 0.05
box('finial', 0.06, 0.06, 0.14, 0, 0, apex + 0.06, TRIM, bevel=0)

# Striped awning: a single sloped canopy over the serving window, striped
# via a brick texture (one tall row → clean vertical stripes).
AWN = brick_mat('awn', AWNING[0], AWNING[1], AWNING[0], rows=0.001, cols=7, rough=0.55, mortar_size=0.001, bump=0)
am = bpy.data.meshes.new('awn')
b2 = bmesh.new()
il = b2.verts.new((-0.66, FRONT + 0.02, 1.07))
ir = b2.verts.new((0.66, FRONT + 0.02, 1.07))
orr = b2.verts.new((0.66, FRONT - 0.52, 0.86))
ol = b2.verts.new((-0.66, FRONT - 0.52, 0.86))
b2.faces.new([il, ir, orr, ol])
b2.to_mesh(am)
awn = bpy.data.objects.new('awnobj', am)
bpy.context.collection.objects.link(awn)
am.materials.append(AWN)
awn.modifiers.new('sol', 'SOLIDIFY').thickness = 0.03
# Valance: a short striped skirt hanging from the awning's outer edge.
val = box('valance', 1.34, 0.03, 0.1, 0, FRONT - 0.52, 0.81, AWN_A, bevel=0)
val.data.materials[0] = AWN

# ── Ground shadow catcher ───────────────────────────────────────────────
bpy.ops.mesh.primitive_plane_add(size=10, location=(0, 0, 0))
bpy.context.object.is_shadow_catcher = True

# ── Camera: dimetric 2:1 ────────────────────────────────────────────────
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.9
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (10, -10, 8.1)
target = bpy.data.objects.new('t', None)
target.location = (0, 0, 0.7)
bpy.context.collection.objects.link(target)
tc = cam.constraints.new('TRACK_TO')
tc.target = target
tc.track_axis = 'TRACK_NEGATIVE_Z'
tc.up_axis = 'UP_Y'
scene.camera = cam

sun_data = bpy.data.lights.new('sun', 'SUN')
sun_data.energy = 3.6
sun_data.angle = math.radians(4)
sun = bpy.data.objects.new('sun', sun_data)
bpy.context.collection.objects.link(sun)
sun.rotation_euler = (math.radians(48), 0, math.radians(-15))

world = bpy.data.worlds.new('w')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.7, 0.8, 0.95, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
scene.world = world

scene.render.filepath = f'/tmp/claude-0/-home-user-golfgame/add2a3de-607d-5b78-92cd-2d45335f9527/scratchpad/kiosk-{colorway}.png'
bpy.ops.render.render(write_still=True)
print('RENDER DONE', colorway)
