#!/usr/bin/env python3
"""원본(assets/images/raw) → 게임용 에셋 + assets/manifest.json 생성.

🔴 매니페스트가 경로의 단일 진실원이다. 게임 로더·쇼룸·크레딧 생성기가 전부 이 파일을 읽는다.
🔴 --check 는 재생성 결과를 바이트 비교해 어긋나면 exit 1 (생성기가 빌드에 안 묶이면 반드시 어긋난다).
"""
import json
import sys
import hashlib
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'assets' / 'images' / 'raw'
OUT = ROOT / 'public' / 'assets' / 'images'
MANIFEST = ROOT / 'public' / 'assets' / 'manifest.json'

CHAR_SIZE = 384
PLATFORM_W = 512
BG_W, BG_H = 720, 1280

CHARS = ['fox', 'rabbit', 'penguin', 'cat', 'bear', 'owl', 'dragon']
PLATFORMS = ['stone', 'cloud', 'wood', 'crystal']
BGS = ['dawn', 'day', 'sunset', 'night']
# v2(2026-10-13): 세계 = 여정 구간(숲·구름·우주·용암). 원본 = game-assets-src/zones/<id>.png (Firefly/GPT 생성)
ZONES = ['forest', 'cloud', 'space', 'lava']
ZONE_SRC = ROOT / 'game-assets-src' / 'zones'
# v2: 캐릭터 = Firefly 3D + 뼈대 → 액션 아틀라스(rig-characters.py 산출, public/assets/rig/<id>.png/.json).
#     리그된 캐릭터는 옛 «포즈 그림 두 장»(char-<id>.webp · -jump)을 더 만들지 않는다(gate-char-rig 가 남은 옛 그림을 FAIL).
RIG_DIR = ROOT / 'public' / 'assets' / 'rig'
# 테마 → 발판 매핑 (테마 해금과 발판 외형을 함께 바꾼다)
THEME_PLATFORM = {'dawn': 'stone', 'day': 'cloud', 'sunset': 'wood', 'night': 'crystal'}


def trim_alpha(im: Image.Image) -> Image.Image:
    if im.mode != 'RGBA':
        return im
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def fit_square(im: Image.Image, size: int) -> Image.Image:
    im = trim_alpha(im)
    im.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return canvas


def fit_width(im: Image.Image, width: int) -> Image.Image:
    im = trim_alpha(im)
    h = max(1, round(im.height * width / im.width))
    return im.resize((width, h), Image.LANCZOS)


def alpha_coverage(im: Image.Image) -> float:
    """투명 이미지에서 «실제로 그려진 픽셀» 비율. cutout 이 본체를 먹었는지 판정한다."""
    if im.mode != 'RGBA':
        return 1.0
    a = im.getchannel('A')
    hist = a.histogram()
    solid = sum(hist[128:])
    return solid / (im.width * im.height)


def write(im: Image.Image, path: Path, quality=88) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == '.webp':
        im.save(path, 'WEBP', quality=quality, method=6)
    else:
        im.save(path)
    data = path.read_bytes()
    return {'file': path.name, 'bytes': len(data),
            'sha1': hashlib.sha1(data).hexdigest()[:12],
            'w': im.width, 'h': im.height}


def build(check=False):
    if not RAW.exists():
        print(f'❌ 원본 폴더 없음: {RAW}')
        return 2
    manifest = {'version': 1, 'images': {}, 'themePlatform': THEME_PLATFORM, 'audio': {}}
    problems = []

    # 서 있는 포즈와 «점프 포즈» 두 벌. 점프는 프레임 애니메이션이 아니라 «자세 한 장»이다 —
    # AI 는 프레임 간 연속성을 못 만들지만 자세 한 장은 잘 만든다(모션은 조달·자세는 생성).
    manifest['rig'] = {}
    for name in CHARS:
        png, js = RIG_DIR / f'{name}.png', RIG_DIR / f'{name}.json'
        if png.exists() and js.exists():
            meta = json.loads(js.read_text())
            fr = next(iter(meta['frames'].values()))['frame']
            data = png.read_bytes()
            manifest['rig'][name] = {'png': png.name, 'json': js.name, 'bytes': len(data) + js.stat().st_size,
                                     'sha1': hashlib.sha1(data).hexdigest()[:12],
                                     'size': [meta['meta']['size']['w'], meta['meta']['size']['h']], 'frame': [fr['w'], fr['h']]}
            for stale in (OUT / f'char-{name}.webp', OUT / f'char-{name}-jump.webp'):
                if stale.exists() and not check:
                    stale.unlink()
            continue
        for suffix, key in (('', ''), ('-jump', '-jump')):
            src = RAW / f'char-{name}{suffix}.png'
            if not src.exists():
                problems.append(f'누락: {src.name}')
                continue
            im = Image.open(src).convert('RGBA')
            cov = alpha_coverage(im)
            if cov < 0.04:
                problems.append(f'{src.name}: 불투명 픽셀 {cov:.1%} — cutout 이 본체를 먹었다')
            out = fit_square(im, CHAR_SIZE)
            manifest['images'][f'char-{name}{key}'] = write(out, OUT / f'char-{name}{key}.webp')

    for name in PLATFORMS:
        src = RAW / f'platform-{name}.png'
        if not src.exists():
            problems.append(f'누락: {src.name}')
            continue
        im = Image.open(src).convert('RGBA')
        cov = alpha_coverage(im)
        bb = im.getbbox()
        barea = (bb[2] - bb[0]) * (bb[3] - bb[1]) if bb else 1
        solid = sum(im.getchannel('A').histogram()[128:])
        fill = solid / barea
        if cov < 0.06:
            problems.append(f'{src.name}: 불투명 픽셀 {cov:.1%} — cutout 이 본체를 먹었다')
        # 🔴 전체 비율만 보면 «이끼만 남고 몸통이 사라진» 발판이 통과한다(실측).
        #    윤곽 상자를 얼마나 채우는지까지 봐야 판별이 된다.
        if fill < 0.35:
            problems.append(f'{src.name}: 윤곽상자 충실도 {fill:.1%} — 슬래브 몸통이 비었다(cutout 손실)')
        out = fit_width(im, PLATFORM_W)
        manifest['images'][f'platform-{name}'] = write(out, OUT / f'platform-{name}.webp')

    for name in BGS:
        src = RAW / f'bg-{name}.png'
        if not src.exists():
            problems.append(f'누락: {src.name}')
            continue
        im = Image.open(src).convert('RGB')
        scale = max(BG_W / im.width, BG_H / im.height)
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        left = (im.width - BG_W) // 2
        top = (im.height - BG_H) // 2
        im = im.crop((left, top, left + BG_W, top + BG_H))
        manifest['images'][f'bg-{name}'] = write(im, OUT / f'bg-{name}.webp', quality=82)

    for name in ZONES:
        src = ZONE_SRC / f'{name}.png'
        if not src.exists():
            continue   # 아직 안 만든 구간은 테마 하늘로 대신한다(WorldScene.bgKeyFor)
        im = Image.open(src).convert('RGB')
        scale = max(BG_W / im.width, BG_H / im.height)
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        left = (im.width - BG_W) // 2
        top = (im.height - BG_H) // 2
        im = im.crop((left, top, left + BG_W, top + BG_H))
        manifest['images'][f'zone-{name}'] = write(im, OUT / f'zone-{name}.webp', quality=80)

    if problems:
        print('❌ 에셋 문제:')
        for p in problems:
            print('  · ' + p)
        return 1

    # 판이 시작된 뒤에 받아 오는 오디오 키
    LAZY_AUDIO = {'bgm-tense', 'bgm-rush'}

    # 오디오도 같은 매니페스트에 싣는다 — 로더·스모크 모수·크레딧이 전부 이 파일 하나를 읽는다.
    audio_dir = ROOT / 'public' / 'assets' / 'audio'
    for ogg in sorted(audio_dir.glob('*.ogg')):
        key = ogg.stem
        m4a = ogg.with_suffix('.m4a')
        entry = {'ogg': ogg.name, 'bytes': ogg.stat().st_size}
        # 🔴 강도 BGM 은 첫 화면에 필요 없다 — preload 에 넣으면 두 곡 760KB 가
        #    「첫 문제까지 전송량」예산(D25)에 그대로 얹힌다. 판 중에 받는다(src/ui/sound.js).
        if key in LAZY_AUDIO:
            entry['lazy'] = True
        if m4a.exists():
            entry['m4a'] = m4a.name
            entry['bytes'] += m4a.stat().st_size
        else:
            problems.append(f'{ogg.name}: m4a 대체본 없음 — Safari 에서 무음이 된다')
        manifest['audio'][key] = entry

    if problems:
        print('❌ 에셋 문제:')
        for p_ in problems:
            print('  · ' + p_)
        return 1

    total = sum(v['bytes'] for v in manifest['images'].values())
    manifest['audioBytes'] = sum(v['bytes'] for v in manifest['audio'].values())
    manifest['eagerAudioBytes'] = sum(v['bytes'] for v in manifest['audio'].values() if not v.get('lazy'))
    manifest['totalBytes'] = total
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'

    if check:
        if not MANIFEST.exists() or MANIFEST.read_text() != text:
            print('❌ manifest.json 이 재생성 결과와 다르다 — `python3 tools/process-assets.py` 를 돌려라.')
            return 1
        print(f'✅ 에셋 매니페스트 일치 · {len(manifest["images"])}장 · {total/1024:.0f}KB')
        return 0

    MANIFEST.write_text(text)
    print(f'✅ 에셋 {len(manifest["images"])}장 · 합계 {total/1024:.0f}KB → {MANIFEST.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(build(check='--check' in sys.argv))
