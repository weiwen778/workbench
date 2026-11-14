# 宠物像素素材来源与许可

## 文件

| 文件 | 契约 |
| --- | --- |
| `dog-sheet.png` | 256×384，RGBA，4 列 × 6 行，每帧 64×64；行顺序 `idle, walk, eat, sleep, sad, sick` |
| `dog-portrait.png` | 128×128，RGBA，正视图 |
| `generate_pet_assets.py` | 生成上面两个文件的确定性脚本（Pillow） |

## 来源

- 形象基准：用户提供的三视图参考（奶油金幼犬、垂耳、深棕描边、红色项圈）。参考图只用于确定配色和轮廓，浅蓝背景不进入素材。
- 没有下载、描摹或修改任何第三方素材包；两个 PNG 全部由本目录的
  `generate_pet_assets.py` 程序化绘制，不含随机数，重复运行结果逐字节一致。
- 生成方式属于「代码绘制」一档（设计文档允许的最低优先级方案），因此每一帧的
  轮廓、项圈、耳朵和尾巴位置都由同一组参数推导，帧间不会漂移。

## 处理步骤

1. 每个逻辑帧在 64×64 的画布上用椭圆、圆角矩形和折线拼出侧视轮廓。
2. 轮廓用 `ImageFilter.MaxFilter(3)` 膨胀 1 像素，先铺 `#4A3324` 深棕描边，再铺主体色。
3. 主体色 `#F6D9A0` 奶油金；高光 `#FFF0C9`、中间阴影 `#D9A85F`、深阴影 `#B8843F`；
   项圈 `#D1483F` / `#9E2F2A`，吊牌金色。阴影和高光都裁剪在轮廓内，保留浅色高光。
4. 眼睛、鼻子、嘴、项圈、吊牌和状态小道具（睡觉的 Z、生病的冷汗）画在细节层。
5. 六行分别调用 `idle_frame` / `walk_frame` / `eat_frame` / `sleep_frame` /
   `sad_frame` / `sick_frame`，按 4 帧拼成 256×384 精灵表，背景保持透明（alpha 最小值为 0）。
6. 头像在 64×64 上画正视图，再用 `Image.NEAREST` 放大到 128×128，保持像素边缘；
   浏览器里统一使用 `image-rendering: pixelated`。

生成命令：

```bash
server/.venv/bin/python web-react/src/pets/assets/generate_pet_assets.py
# 输出：pet assets ok: .../web-react/src/pets/assets/dog-sheet.png
```

脚本结束时会自校验尺寸、模式与透明背景。也可以单独校验：

```bash
server/.venv/bin/python - <<'PY'
from PIL import Image
sheet = Image.open('web-react/src/pets/assets/dog-sheet.png')
assert sheet.size == (256, 384), sheet.size
assert sheet.mode == 'RGBA', sheet.mode
assert sheet.getchannel('A').getextrema()[0] == 0
portrait = Image.open('web-react/src/pets/assets/dog-portrait.png')
assert portrait.size == (128, 128), portrait.size
assert portrait.mode == 'RGBA', portrait.mode
print('pet assets ok')
PY
```

## 动画行内容

| 行 | 状态 | 四帧内容 |
| --- | --- | --- |
| 0 | idle | 呼吸起伏 1px、耳朵轻微摆动、尾巴左右摇、第 4 帧眨眼 |
| 1 | walk | 两对腿交替前后 2px、身体上下 1px、尾巴摆动 |
| 2 | eat | 头低到碗的高度、第 2/4 帧张嘴吐舌、耳朵下垂 |
| 3 | sleep | 蜷卧、闭眼、呼吸起伏 1px、头顶 Z 由小变大 |
| 4 | sad | 头低、耳朵下垂、尾巴垂到地面、半闭眼、第 4 帧闭眼 |
| 5 | sick | 毛色变浅、缩着身体、X 形闭眼、冷汗滴落、腿轻微不稳 |

没有退化复用：六行都各有 4 个直接绘制的帧，睡眠/难过/生病的差异是 1–2px 的
呼吸、尾巴或冷汗位移，在 2 fps 下表现为缓慢的循环，而不是静止图。
`PetSprite` 的帧号只决定列，不会跨行取样。

## 许可

自用素材（self-use）。本目录的图像由本项目自行绘制，随项目源码一起使用；
不包含第三方美术、字体或商标角色，不对外单独再分发。如需在项目外复用，
请同时保留本文件说明。
