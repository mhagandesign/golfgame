"""Blender script: renders the isometric golf clubhouse sprite (transparent PNG).

Styled after a classic American country clubhouse: white clapboard wings,
a grey wood-shake centre section, red shingled roofs with cross gables, a
cupola, a columned veranda and a tall flagpole. Dimetric 2:1 camera to match
the game's projection; sun from the NW so the baked shadow falls SE.
"""
import bpy
import bmesh
import math

# ── Clean scene ──────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 196
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'
scene.render.resolution_x = 900
scene.render.resolution_y = 900
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
    """Row-patterned material (shingles / clapboard / shakes) via brick texture."""
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
    # Rows run horizontally: pattern plane = (x+y, z).
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


SHINGLE = brick_mat('shingle', (0.30, 0.085, 0.05), (0.24, 0.065, 0.045), (0.13, 0.035, 0.025), rows=15, cols=26, rough=0.85)
CLAPBOARD = brick_mat('clapboard', (0.94, 0.93, 0.89), (0.90, 0.89, 0.85), (0.72, 0.71, 0.67), rows=17, cols=0.001, rough=0.7, mortar_size=0.006, bump=0.25)
SHAKES = brick_mat('shakes', (0.44, 0.43, 0.41), (0.38, 0.375, 0.36), (0.26, 0.255, 0.245), rows=13, cols=18, rough=0.85, bump=0.3)
GREYROOF = brick_mat('greyroof', (0.3, 0.3, 0.31), (0.26, 0.26, 0.27), (0.17, 0.17, 0.18), rows=12, cols=20, rough=0.85)
TRIM = flat_mat('trim', (0.95, 0.94, 0.9), 0.55)
GLASS = flat_mat('glass', (0.32, 0.44, 0.55), 0.08, 0.35)
MUNTIN = flat_mat('muntin', (0.9, 0.9, 0.88), 0.5)
STONE = flat_mat('stone', (0.52, 0.5, 0.47), 0.9)
CAP_RED = brick_mat('capred', (0.34, 0.09, 0.06), (0.28, 0.075, 0.05), (0.16, 0.04, 0.03), rows=9, cols=14, rough=0.8)
POLE = flat_mat('pole', (0.82, 0.82, 0.84), 0.35, 0.7)
FLAG = flat_mat('flag', (0.72, 0.1, 0.09), 0.6)


def box(name, sx, sy, sz, x, y, z, material, bevel=0.012):
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


def gable_roof(name, cx, cy, sx, sy, base_z, ridge_z, along_x, mat_roof, overhang=0.12, thickness=0.05):
    """Open-ended gable roof prism (two slopes, no end caps)."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    if along_x:
        ex = sx / 2 + overhang
        hy = sy / 2 + overhang
        v = [bm.verts.new(p) for p in [
            (cx - ex, cy - hy, base_z), (cx + ex, cy - hy, base_z),
            (cx + ex, cy, ridge_z), (cx - ex, cy, ridge_z),
            (cx - ex, cy + hy, base_z), (cx + ex, cy + hy, base_z),
        ]]
        bm.faces.new([v[0], v[1], v[2], v[3]])
        bm.faces.new([v[5], v[4], v[3], v[2]])
    else:
        ey = sy / 2 + overhang
        hx = sx / 2 + overhang
        v = [bm.verts.new(p) for p in [
            (cx - hx, cy - ey, base_z), (cx - hx, cy + ey, base_z),
            (cx, cy + ey, ridge_z), (cx, cy - ey, ridge_z),
            (cx + hx, cy - ey, base_z), (cx + hx, cy + ey, base_z),
        ]]
        bm.faces.new([v[0], v[1], v[2], v[3]])
        bm.faces.new([v[5], v[4], v[3], v[2]])
    bm.to_mesh(mesh)
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    mesh.materials.append(mat_roof)
    solid = ob.modifiers.new('solid', 'SOLIDIFY')
    solid.thickness = thickness
    return ob


def gable_wall(name, cx, cy, half_w, base_z, ridge_z, along_x, offset, material):
    """Triangular gable infill wall at one end of a gable roof."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    if along_x:
        x = cx + offset
        v = [bm.verts.new(p) for p in [(x, cy - half_w, base_z), (x, cy + half_w, base_z), (x, cy, ridge_z)]]
    else:
        y = cy + offset
        v = [bm.verts.new(p) for p in [(cx - half_w, y, base_z), (cx + half_w, y, base_z), (cx, y, ridge_z)]]
    bm.faces.new(v)
    bm.to_mesh(mesh)
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    mesh.materials.append(material)
    solid = ob.modifiers.new('solid', 'SOLIDIFY')
    solid.thickness = 0.04
    return ob


def window(name, x, y, z, w, h, facing='front'):
    """White-framed glass window with a muntin cross, on a -Y or +X face."""
    if facing == 'front':
        box(f'{name}f', w, 0.05, h, x, y, z, TRIM, bevel=0)
        box(f'{name}g', w - 0.08, 0.05, h - 0.08, x, y - 0.012, z, GLASS, bevel=0)
        box(f'{name}m1', 0.02, 0.06, h - 0.08, x, y - 0.014, z, MUNTIN, bevel=0)
        box(f'{name}m2', w - 0.08, 0.06, 0.02, x, y - 0.014, z, MUNTIN, bevel=0)
    else:
        box(f'{name}f', 0.05, w, h, x, y, z, TRIM, bevel=0)
        box(f'{name}g', 0.05, w - 0.08, h - 0.08, x + 0.012, y, z, GLASS, bevel=0)
        box(f'{name}m1', 0.06, 0.02, h - 0.08, x + 0.014, y, z, MUNTIN, bevel=0)
        box(f'{name}m2', 0.06, w - 0.08, 0.02, x + 0.014, y, z, MUNTIN, bevel=0)


# ══ Building ═════════════════════════════════════════════════════════════

# Main long block — white clapboard.
box('main', 3.3, 1.8, 1.05, 0, 0, 0.525, CLAPBOARD)
box('footing', 3.36, 1.86, 0.12, 0, 0, 0.06, STONE)
# Main gable roof (ridge along X) — red shingles + white gable ends.
gable_roof('mainroof', 0, 0, 3.3, 1.8, 1.02, 1.78, True, SHINGLE)
gable_wall('gableL', 0, 0, 0.9, 1.02, 1.78, True, -1.65, CLAPBOARD)
gable_wall('gableR', 0, 0, 0.9, 1.02, 1.78, True, 1.65, CLAPBOARD)

# Centre section — grey wood shakes with its own large cross-gable,
# proud of the façade, carrying the cupola (as in the reference photo).
box('centre', 1.35, 2.05, 1.06, 0, -0.04, 0.53, SHAKES)
gable_roof('centreroof', 0, -0.04, 1.35, 2.05, 1.04, 1.85, False, SHINGLE)
gable_wall('centregable', 0, -0.04, 0.675, 1.04, 1.85, False, -1.025, SHAKES)
# Attic windows on the shake gable, above the veranda roof.
window('atticC1', -0.24, -1.09, 1.28, 0.2, 0.26)
window('atticC2', 0.24, -1.09, 1.28, 0.2, 0.26)

# Cross-gabled wings (white), protruding at the front.
for wx in (-1.15, 1.15):
    box(f'wing{wx}', 0.8, 2.0, 1.08, wx, -0.04, 0.54, CLAPBOARD)
    gable_roof(f'wingroof{wx}', wx, -0.04, 0.8, 2.0, 1.06, 1.62, False, SHINGLE)
    gable_wall(f'winggable{wx}', wx, -0.04, 0.4, 1.06, 1.62, False, -1.0, CLAPBOARD)
    # Gable-peak attic window
    window(f'attic{wx}', wx, -1.06, 1.22, 0.2, 0.24)
    # Ground-floor windows on the wing front
    window(f'wingwinA{wx}', wx - 0.19, -1.06, 0.62, 0.26, 0.4)
    window(f'wingwinB{wx}', wx + 0.19, -1.06, 0.62, 0.26, 0.4)

# Veranda across the centre — grey low roof on white columns, with railing.
box('verandafloor', 1.5, 0.62, 0.09, 0, -1.32, 0.09, TRIM)
for px in (-0.66, -0.22, 0.22, 0.66):
    box(f'col{px}', 0.07, 0.07, 0.78, px, -1.56, 0.55, TRIM)
box('rail', 1.48, 0.04, 0.05, 0, -1.6, 0.32, TRIM, bevel=0)
for i in range(11):
    rx = -0.62 + i * 0.124
    box(f'bal{i}', 0.025, 0.025, 0.24, rx, -1.6, 0.19, TRIM, bevel=0)
gable_roof('verandaroof', 0, -1.31, 1.7, 0.75, 0.93, 1.12, True, GREYROOF, overhang=0.08, thickness=0.04)

# Veranda back wall: glazed lounge front behind the columns.
box('loungeglass', 1.3, 0.04, 0.62, 0, -1.035, 0.5, GLASS, bevel=0)
for i in range(5):
    box(f'lgm{i}', 0.025, 0.05, 0.62, -0.52 + i * 0.26, -1.04, 0.5, TRIM, bevel=0)
# Door at centre
box('doorframe', 0.34, 0.05, 0.7, 0, -1.045, 0.42, TRIM, bevel=0)

# East side windows.
for wy in (-0.35, 0.35):
    window(f'sidewin{wy}', 1.66, wy, 0.6, 0.3, 0.42, facing='side')

# Cupola with red cap and finial, on the centre ridge.
box('cupolabase', 0.4, 0.4, 0.34, 0, 0, 2.0, CLAPBOARD)
box('cupolamid', 0.32, 0.32, 0.3, 0, 0, 2.3, TRIM)
for a in range(4):
    ang = a * math.pi / 2
    ox, oy = 0.17 * math.cos(ang), 0.17 * math.sin(ang)
    box(f'cupwin{a}', 0.12 if a % 2 == 0 else 0.03, 0.03 if a % 2 == 0 else 0.12, 0.16, ox, oy, 2.3, GLASS, bevel=0)
# Pyramid cap
mesh = bpy.data.meshes.new('cap')
bm = bmesh.new()
cz = 2.46
vs = [bm.verts.new(p) for p in [(-0.24, -0.24, cz), (0.24, -0.24, cz), (0.24, 0.24, cz), (-0.24, 0.24, cz), (0, 0, cz + 0.34)]]
for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
    bm.faces.new([vs[a], vs[b], vs[4]])
bm.to_mesh(mesh)
cap = bpy.data.objects.new('cap', mesh)
bpy.context.collection.objects.link(cap)
mesh.materials.append(CAP_RED)
box('finial', 0.02, 0.02, 0.18, 0, 0, cz + 0.42, POLE, bevel=0)

# Chimneys.
box('chimney1', 0.24, 0.24, 0.6, -0.85, 0.35, 1.75, STONE)
box('chimney2', 0.24, 0.24, 0.5, 0.95, 0.3, 1.72, STONE)

# Tall flagpole with red flag, out front-left like the reference.
box('flagpole', 0.035, 0.035, 3.0, -1.85, -1.35, 1.5, POLE, bevel=0)
box('flagcloth', 0.44, 0.02, 0.26, -1.61, -1.35, 2.78, FLAG, bevel=0)

# ── Ground shadow catcher ────────────────────────────────────────────────
bpy.ops.mesh.primitive_plane_add(size=16, location=(0, 0, 0))
bpy.context.object.is_shadow_catcher = True

# ── Camera: dimetric 2:1 ────────────────────────────────────────────────
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 7.0
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (10, -10, 8.1)
target = bpy.data.objects.new('target', None)
target.location = (0, 0, 0.95)
bpy.context.collection.objects.link(target)
tc = cam.constraints.new('TRACK_TO')
tc.target = target
tc.track_axis = 'TRACK_NEGATIVE_Z'
tc.up_axis = 'UP_Y'
scene.camera = cam

# ── Light: sun from the game's NW (screen upper-left) ───────────────────
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

scene.render.filepath = '/tmp/claude-0/-home-user-golfgame/add2a3de-607d-5b78-92cd-2d45335f9527/scratchpad/clubhouse-render.png'
bpy.ops.render.render(write_still=True)
print('RENDER DONE')
