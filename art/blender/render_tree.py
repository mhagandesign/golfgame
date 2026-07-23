"""Render a Poly Haven fir tree (opened .blend) as a game sprite.

Usage: blender -b fir_tree_01_1k.blend -P render_tree.py -- <object> <outpath> [scale]
Dimetric camera matching the game; soft NW key + sky fill for the reference's
studio look. Prints the tree base's pixel coords for sprite anchoring.
"""
import bpy
import math
import sys
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index('--') + 1:]
target = argv[0]
outpath = argv[1]

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 220
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'
RES = 1100
scene.render.resolution_x = RES
scene.render.resolution_y = RES
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'

# Show only the target tree (its LOD0 mesh is the full assembled tree).
for o in bpy.data.objects:
    o.hide_render = True
tgt = bpy.data.objects[target]
tgt.hide_render = False
# Bring it to the origin regardless of where the variant sat.
dx, dy = tgt.location.x, tgt.location.y
tgt.location.x = 0
tgt.location.y = 0
height = tgt.dimensions.z

# No baked ground shadow — trees are clean cutouts and the engine draws a
# soft contact shadow, so many trees don't stack giant overlapping shadows.

# Dimetric camera (same axis as the clubhouse), framing the whole tree.
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = height * 1.18
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
cam.location = (100, -100, 100)  # ortho: only direction matters
target_empty = bpy.data.objects.new('t', None)
target_empty.location = (0, 0, height * 0.46)
scene.collection.objects.link(target_empty)
tc = cam.constraints.new('TRACK_TO')
tc.target = target_empty
tc.track_axis = 'TRACK_NEGATIVE_Z'
tc.up_axis = 'UP_Y'
scene.camera = cam

# Soft key from the NW + sky fill.
sun_data = bpy.data.lights.new('sun', 'SUN')
sun_data.energy = 3.6
sun_data.angle = math.radians(6)
sun = bpy.data.objects.new('sun', sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(52), 0, math.radians(-18))

world = bpy.data.worlds.new('w')
world.use_nodes = True
nt = world.node_tree
bg = nt.nodes['Background']
grad = nt.nodes.new('ShaderNodeTexGradient')
grad.gradient_type = 'SPHERICAL'
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.62, 0.72, 0.82, 1)
ramp.color_ramp.elements[1].color = (0.82, 0.87, 0.92, 1)
texco = nt.nodes.new('ShaderNodeTexCoord')
nt.links.new(texco.outputs['Window'], grad.inputs['Vector'])
nt.links.new(grad.outputs['Color'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 0.55
scene.world = world

bpy.context.view_layer.update()
base = world_to_camera_view(scene, cam, tgt.matrix_world.translation)
print(f'BASE_PX {base.x * RES:.1f} {(1 - base.y) * RES:.1f} RES {RES}')

scene.render.filepath = outpath
bpy.ops.render.render(write_still=True)
print('RENDER DONE')
