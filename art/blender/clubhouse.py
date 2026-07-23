"""Blender script: renders an isometric golf clubhouse sprite (transparent PNG).
Dimetric 2:1 camera to match the game's projection; sun from the NW so the
baked shadow falls SE like every other prop in the game.
"""
import bpy
import math

# ── Clean scene ──────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 160
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'
scene.render.resolution_x = 720
scene.render.resolution_y = 720
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'


def mat(name, color, rough=0.7, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    return m


CREAM = mat('walls', (0.78, 0.6, 0.36), 0.8)
TRIM = mat('trim', (0.93, 0.9, 0.82), 0.6)
ROOF = mat('roof', (0.24, 0.075, 0.045), 0.85)
ROOF_EDGE = mat('roofedge', (0.34, 0.12, 0.07), 0.8)
GLASS = mat('glass', (0.55, 0.72, 0.82), 0.15)
DOOR = mat('door', (0.12, 0.28, 0.14), 0.5)
STONE = mat('stone', (0.5, 0.48, 0.44), 0.9)
FLAGPOLE = mat('pole', (0.85, 0.85, 0.85), 0.4, 0.6)
FLAG = mat('flag', (0.75, 0.12, 0.1), 0.6)


def box(name, sx, sy, sz, x, y, z, material, bevel=0.015):
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


# ── Building ─────────────────────────────────────────────────────────────
# Main block
box('main', 3.0, 2.0, 1.15, 0, 0, 0.575, CREAM)
# Stone footing
box('footing', 3.06, 2.06, 0.14, 0, 0, 0.07, STONE)

# Hip roof (ridge along X)
import bmesh
mesh = bpy.data.meshes.new('roofmesh')
bm = bmesh.new()
o = 0.16  # eave overhang
bz = 1.15
rz = 1.95
verts = [
    bm.verts.new(v) for v in [
        (-1.5 - o, -1.0 - o, bz), (1.5 + o, -1.0 - o, bz),
        (1.5 + o, 1.0 + o, bz), (-1.5 - o, 1.0 + o, bz),
        (-0.75, 0, rz), (0.75, 0, rz),
    ]
]
bm.faces.new([verts[0], verts[1], verts[5], verts[4]])   # front slope
bm.faces.new([verts[2], verts[3], verts[4], verts[5]])   # back slope
bm.faces.new([verts[1], verts[2], verts[5]])             # right hip
bm.faces.new([verts[3], verts[0], verts[4]])             # left hip
bm.faces.new([verts[3], verts[2], verts[1], verts[0]])   # underside
bm.to_mesh(mesh)
roof_ob = bpy.data.objects.new('roof', mesh)
bpy.context.collection.objects.link(roof_ob)
mesh.materials.append(ROOF)
solid = roof_ob.modifiers.new('solid', 'SOLIDIFY')
solid.thickness = 0.06
roof_ob.data.materials.append(ROOF_EDGE)

# Chimney
box('chimney', 0.28, 0.28, 0.75, 0.95, 0.45, 1.75, STONE)
box('chimtop', 0.36, 0.36, 0.08, 0.95, 0.45, 2.14, TRIM)

# Porch along the front (-Y)
box('porchfloor', 2.4, 0.85, 0.1, 0, -1.42, 0.1, TRIM)
for px in (-1.05, -0.36, 0.36, 1.05):
    box(f'post{px}', 0.09, 0.09, 0.85, px, -1.75, 0.6, TRIM)
# Porch roof: thin sloped slab
bpy.ops.mesh.primitive_cube_add(location=(0, -1.45, 1.12))
p = bpy.context.object
p.name = 'porchroof'
p.scale = (1.28, 0.5, 0.03)
p.rotation_euler = (math.radians(11), 0, 0)
bpy.ops.object.transform_apply(scale=True, rotation=True)
p.data.materials.append(ROOF_EDGE)

# Door (front center) + windows
box('doorframe', 0.5, 0.06, 0.85, 0, -1.02, 0.5, TRIM, bevel=0)
box('door', 0.4, 0.06, 0.76, 0, -1.035, 0.46, DOOR, bevel=0)
for wx in (-0.95, 0.95):
    box(f'wf{wx}', 0.5, 0.06, 0.5, wx, -1.02, 0.62, TRIM, bevel=0)
    box(f'wg{wx}', 0.4, 0.06, 0.4, wx, -1.035, 0.62, GLASS, bevel=0)
# Right gable-side windows
for wy in (-0.45, 0.45):
    box(f'sf{wy}', 0.06, 0.5, 0.5, 1.52, wy, 0.62, TRIM, bevel=0)
    box(f'sg{wy}', 0.06, 0.4, 0.4, 1.535, wy, 0.62, GLASS, bevel=0)

# Flag on the ridge
box('pole', 0.035, 0.035, 0.7, -0.6, 0, 2.25, FLAGPOLE, bevel=0)
box('flagcloth', 0.34, 0.02, 0.2, -0.42, 0, 2.48, FLAG, bevel=0)

# ── Ground shadow catcher ────────────────────────────────────────────────
bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, 0))
ground = bpy.context.object
ground.is_shadow_catcher = True

# ── Camera: dimetric 2:1 ────────────────────────────────────────────────
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 6.0
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (10, -10, 8.1)
target = bpy.data.objects.new('target', None)
target.location = (0, 0, 0.72)
bpy.context.collection.objects.link(target)
tc = cam.constraints.new('TRACK_TO')
tc.target = target
tc.track_axis = 'TRACK_NEGATIVE_Z'
tc.up_axis = 'UP_Y'
scene.camera = cam

# ── Light: sun from the game's NW (screen upper-left) ───────────────────
sun_data = bpy.data.lights.new('sun', 'SUN')
sun_data.energy = 3.6
sun_data.angle = math.radians(4)  # soft-ish shadows
sun = bpy.data.objects.new('sun', sun_data)
bpy.context.collection.objects.link(sun)
# Screen-left-and-up relative to this camera ≈ world (-Y) side, high.
sun.rotation_euler = (math.radians(48), 0, math.radians(-15))

# Sky fill so shaded faces aren't black.
world = bpy.data.worlds.new('w')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.7, 0.8, 0.95, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
scene.world = world

scene.render.filepath = '/tmp/claude-0/-home-user-golfgame/add2a3de-607d-5b78-92cd-2d45335f9527/scratchpad/clubhouse-render.png'
bpy.ops.render.render(write_still=True)
print('RENDER DONE')
