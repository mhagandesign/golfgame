"""Blender script: renders a seamless, tileable water texture (top-down).

The game fills water tiles with this as a repeating top-down texture, so it
must tile. The ocean modifier's spectrum is periodic, so an orthographic
top-down camera framing exactly one spatial period tiles seamlessly. A low
NW sun and a sky world give rippled sunlit water with sky-colored sparkle.
"""
import bpy
import math

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 256
scene.cycles.use_denoising = True
scene.render.film_transparent = False
scene.view_settings.view_transform = 'Standard'
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'

SIZE = 8.0

# Ocean surface — GENERATE mode makes its own periodic grid.
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
plane = bpy.context.object
oc = plane.modifiers.new('ocean', 'OCEAN')
# Tile the ocean 3x3 so we can frame the centre period with no edge artifacts.
oc.geometry_mode = 'GENERATE'
oc.repeat_x = 3
oc.repeat_y = 3
oc.spatial_size = int(SIZE)
oc.resolution = 32
oc.wave_scale = 0.24
oc.wave_scale_min = 0.02
oc.choppiness = 0.75
oc.wind_velocity = 11
oc.wave_alignment = 0.0
oc.random_seed = 5

# Water material: deep blue-green, glossy; crests catch the sky sheen.
mat = bpy.data.materials.new('water')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (0.02, 0.12, 0.20, 1)
bsdf.inputs['Roughness'].default_value = 0.03
bsdf.inputs['Metallic'].default_value = 0.0
if 'IOR' in bsdf.inputs:
    bsdf.inputs['IOR'].default_value = 1.33
plane.data.materials.append(mat)

# Controlled gradient sky (horizon warm-blue → zenith deeper blue) at modest
# strength, so reflections read as sky without blowing out the water.
world = bpy.data.worlds.new('sky')
world.use_nodes = True
nt = world.node_tree
bg = nt.nodes['Background']
grad = nt.nodes.new('ShaderNodeTexGradient')
grad.gradient_type = 'SPHERICAL'
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position = 0.0
ramp.color_ramp.elements[0].color = (0.75, 0.85, 0.95, 1)
ramp.color_ramp.elements[1].position = 1.0
ramp.color_ramp.elements[1].color = (0.28, 0.45, 0.72, 1)
texco = nt.nodes.new('ShaderNodeTexCoord')
nt.links.new(texco.outputs['Window'], grad.inputs['Vector'])
nt.links.new(grad.outputs['Color'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 0.5
scene.world = world

# Sun from the NW, high, for even ripple sparkle.
sun_data = bpy.data.lights.new('sun', 'SUN')
sun_data.energy = 4.5
sun_data.angle = math.radians(1.5)
sun = bpy.data.objects.new('sun', sun_data)
bpy.context.collection.objects.link(sun)
sun.rotation_euler = (math.radians(55), 0, math.radians(-30))

# Straight-down orthographic camera framing exactly one period.
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = SIZE
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (0, 0, 12)
cam.rotation_euler = (0, 0, 0)
scene.camera = cam

scene.render.filepath = '/tmp/claude-0/-home-user-golfgame/add2a3de-607d-5b78-92cd-2d45335f9527/scratchpad/water-render.png'
bpy.ops.render.render(write_still=True)
print('RENDER DONE')
