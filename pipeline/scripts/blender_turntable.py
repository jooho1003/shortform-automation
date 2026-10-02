# GLB 한 개를 세로 턴테이블로 렌더한다 (투명 배경 PNG 시퀀스).
# Blender 4.5.12 LTS에서 검증. 절차 전체는 docs/전략/39-3D-에셋-영상-파이프라인.md
#
#   & "C:\Program Files\Blender Foundation\Blender 4.5\blender.exe" -b -P pipeline/scripts/blender_turntable.py -- <in.glb> <out_dir> [frames=90] [w=1080] [h=1920] [draft|final]
#
# draft = Workbench(프레임당 ~0.2초, 구도 확인용), final = Cycles CPU 32샘플 + 디노이즈(1080x1920 프레임당 ~23초)
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
frames = int(argv[2]) if len(argv) > 2 else 90
w, h = (int(argv[3]), int(argv[4])) if len(argv) > 4 else (1080, 1920)
quality = argv[5] if len(argv) > 5 else "final"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene

# 모델 전체 바운딩 박스 → 중심과 대각선 길이
pts = [o.matrix_world @ Vector(c) for o in scene.objects if o.type == "MESH" for c in o.bound_box]
lo = Vector(tuple(min(p[i] for p in pts) for i in range(3)))
hi = Vector(tuple(max(p[i] for p in pts) for i in range(3)))
center, size = (lo + hi) / 2, (hi - lo).length

# 카메라를 중심의 빈 객체에 매달고 빈 객체를 돌린다 (모델 자체 애니메이션은 건드리지 않음)
pivot = bpy.data.objects.new("pivot", None)
scene.collection.objects.link(pivot)
pivot.location = center
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
cam.parent = pivot
# 바운딩 구가 좁은 쪽 화각에 들어오는 거리 → 돌아가는 동안 잘리지 않는다
fov = 2 * math.atan(math.tan(cam.data.angle / 2) * min(w, h) / max(w, h))
dist = size / 2 / math.tan(fov / 2) * 1.1
cam.location = (0, -dist, dist * 0.15)
cam.constraints.new("TRACK_TO").target = pivot
scene.camera = cam

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scene.collection.objects.link(sun)
scene.world = bpy.data.worlds.new("world")
scene.world.color = (0.6, 0.6, 0.6)  # 환경광 역할

r = scene.render
if quality == "draft":
    r.engine = "BLENDER_WORKBENCH"
    scene.display.shading.color_type = "TEXTURE"
else:
    r.engine = "CYCLES"  # 이 PC의 Intel Arc 내장 GPU는 oneAPI로 안 잡혀 CPU로 돈다
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
r.resolution_x, r.resolution_y = w, h
r.film_transparent = True
r.image_settings.file_format = "PNG"
r.image_settings.color_mode = "RGBA"

for i in range(frames):
    scene.frame_set(scene.frame_start + i)  # GLB에 걷기 등 애니메이션이 있으면 같이 진행
    pivot.rotation_euler.z = 2 * math.pi * i / frames
    r.filepath = f"{out}/frame_{i:04d}.png"
    bpy.ops.render.render(write_still=True)
