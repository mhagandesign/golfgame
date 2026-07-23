"""Blender script: renders the amenity kiosks (drinks/snacks/toilet) as
isometric sprites matching the clubhouse's projection and lighting."""
import bpy
import math
import sys

colorway = sys.argv[-1]  # drinks | snacks | toilet
SCHEMES = {
    'drinks': {'body': (0.16, 0.34, 0.58), 'awnA': (0.2, 0.45, 0.75), 'awnB': (0.92, 0.94, 0.96)},
    'snacks': {'body': (0.55, 0.26, 0.12), 'awnA': (0.75, 0.22, 0.15), 'awnB': (0.95, 0.9, 0.8)},
    'toilet': {'body': (0.22, 0.36, 0.26), 'awnA': (0.3, 0.5, 0.36), 'awnB': (0.9, 0.94, 0.9)},
}
scheme = SCHEMES[colorway]

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'
scene.render.resolution_x = 420
scene.render.resolution_y = 420
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'


def mat(name, color, rough=0.7, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


BODY = mat('body', scheme['body'], 0.75)
BODY_D = mat('bodyd', tuple(c * 0.7 for c in scheme['body']), 0.8)
AWN_A = mat('awnA', scheme['awnA'], 0.6)
AWN_B = mat('awnB', scheme['awnB'], 0.6)
TRIM = mat('trim', (0.93, 0.9, 0.82), 0.6)
DARK = mat('dark', (0.08, 0.07, 0.06), 0.9)
COUNTER = mat('counter', (0.7, 0.55, 0.35), 0.6)


def box(name, sx, sy, sz, x, y, z, material):
    bpy.ops.mesh.primitive_cube_add(location=(x, y, z))
    ob = bpy.context.object
    ob.name = name
    ob.scale = (sx / 2, sy / 2, sz / 2)
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(material)
    return ob


# Hut body
box('body', 0.9, 0.9, 1.0, 0, 0, 0.5, BODY)
box('footing', 0.96, 0.96, 0.08, 0, 0, 0.04, TRIM)
# Serving hatch on the front (-Y) with counter
box('hatch', 0.55, 0.06, 0.42, 0, -0.44, 0.62, DARK)
box('counter', 0.62, 0.12, 0.05, 0, -0.48, 0.42, COUNTER)
# Pyramid cap
import bmesh
mesh = bpy.data.meshes.new('cap')
bm = bmesh.new()
o = 0.1
vs = [bm.verts.new(v) for v in [(-0.45 - o, -0.45 - o, 1.0), (0.45 + o, -0.45 - o, 1.0), (0.45 + o, 0.45 + o, 1.0), (-0.45 - o, 0.45 + o, 1.0), (0, 0, 1.42)]]
for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
    bm.faces.new([vs[a], vs[b], vs[4]])
bm.faces.new([vs[3], vs[2], vs[1], vs[0]])
bm.to_mesh(mesh)
cap = bpy.data.objects.new('cap', mesh)
bpy.context.collection.objects.link(cap)
mesh.materials.append(BODY_D)

# Striped awning over the hatch: 6 alternating slats, sloping out
for i in range(6):
    x0 = -0.42 + i * 0.14
    bpy.ops.mesh.primitive_cube_add(location=(x0 + 0.07, -0.62, 1.02))
    slat = bpy.context.object
    slat.scale = (0.07, 0.22, 0.015)
    slat.rotation_euler = (math.radians(-22), 0, 0)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    slat.data.materials.append(AWN_A if i % 2 == 0 else AWN_B)

# Ground shadow catcher
bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
bpy.context.object.is_shadow_catcher = True

# Camera (same dimetric setup as the clubhouse)
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.6
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (10, -10, 8.1)
target = bpy.data.objects.new('t', None)
target.location = (0, 0, 0.55)
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
