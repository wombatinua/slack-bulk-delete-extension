from pathlib import Path
import math
import struct
import zlib


ROOT = Path(__file__).resolve().parent
SCALES = (16, 32, 48, 128)
SSAA = 4

TRANSPARENT = (0.0, 0.0, 0.0, 0.0)
BG_TOP = (0x25 / 255, 0x28 / 255, 0x2E / 255, 1.0)
BG_BOTTOM = (0x1B / 255, 0x1D / 255, 0x22 / 255, 1.0)
BORDER = (0x4A / 255, 0x1D / 255, 0x47 / 255, 1.0)
SHINE = (1.0, 1.0, 1.0, 0.10)
BLUE = (0x12 / 255, 0x64 / 255, 0xA3 / 255, 1.0)
BLUE_SOFT = (0x58 / 255, 0xB7 / 255, 0xF6 / 255, 0.32)
PANEL = (0xF6 / 255, 0xF7 / 255, 0xF9 / 255, 1.0)
PANEL_SHADOW = (0xD8 / 255, 0xDE / 255, 0xE6 / 255, 1.0)
TEXT = (0x5B / 255, 0x64 / 255, 0x6F / 255, 1.0)
DANGER = (0xE0 / 255, 0x1E / 255, 0x5A / 255, 1.0)
WHITE = (1.0, 1.0, 1.0, 1.0)


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def blend(dst, src):
    sr, sg, sb, sa = src
    dr, dg, db, da = dst
    out_a = sa + da * (1.0 - sa)
    if out_a <= 1e-6:
      return TRANSPARENT
    out_r = (sr * sa + dr * da * (1.0 - sa)) / out_a
    out_g = (sg * sa + dg * da * (1.0 - sa)) / out_a
    out_b = (sb * sa + db * da * (1.0 - sa)) / out_a
    return (out_r, out_g, out_b, out_a)


def with_alpha(color, alpha):
    r, g, b, _ = color
    return (r, g, b, clamp(alpha))


def inside_round_rect(x, y, left, top, width, height, radius):
    if x < left or y < top or x > left + width or y > top + height:
        return False
    ix = min(max(x, left + radius), left + width - radius)
    iy = min(max(y, top + radius), top + height - radius)
    dx = x - ix
    dy = y - iy
    return dx * dx + dy * dy <= radius * radius


def point_in_polygon(x, y, points):
    inside = False
    j = len(points) - 1
    for i in range(len(points)):
        xi, yi = points[i]
        xj, yj = points[j]
        crosses = ((yi > y) != (yj > y))
        if crosses:
            slope = (xj - xi) * (y - yi) / ((yj - yi) or 1e-6) + xi
            if x < slope:
                inside = not inside
        j = i
    return inside


def add_shape(canvas, sampler):
    size = len(canvas)
    for py in range(size):
        for px in range(size):
            color = sampler(px, py, size)
            if color[3] > 0:
                canvas[py][px] = blend(canvas[py][px], color)


def add_round_rect(canvas, left, top, width, height, radius, color_fn):
    def sampler(px, py, size):
        x = (px + 0.5) / size
        y = (py + 0.5) / size
        if not inside_round_rect(x, y, left, top, width, height, radius):
            return TRANSPARENT
        return color_fn(x, y)

    add_shape(canvas, sampler)


def add_circle(canvas, cx, cy, radius, color_fn):
    rr = radius * radius

    def sampler(px, py, size):
        x = (px + 0.5) / size
        y = (py + 0.5) / size
        dx = x - cx
        dy = y - cy
        if dx * dx + dy * dy > rr:
            return TRANSPARENT
        return color_fn(x, y)

    add_shape(canvas, sampler)


def add_polygon(canvas, points, color_fn):
    def sampler(px, py, size):
        x = (px + 0.5) / size
        y = (py + 0.5) / size
        if not point_in_polygon(x, y, points):
            return TRANSPARENT
        return color_fn(x, y)

    add_shape(canvas, sampler)


def vertical_gradient(top_color, bottom_color):
    def sample(_, y):
        t = clamp(y)
        return (
            top_color[0] * (1 - t) + bottom_color[0] * t,
            top_color[1] * (1 - t) + bottom_color[1] * t,
            top_color[2] * (1 - t) + bottom_color[2] * t,
            top_color[3] * (1 - t) + bottom_color[3] * t,
        )

    return sample


def solid(color):
    return lambda _x, _y: color


def render_high_res(size):
    hi = size * SSAA
    canvas = [[TRANSPARENT for _ in range(hi)] for _ in range(hi)]

    add_round_rect(
        canvas,
        0.06,
        0.06,
        0.88,
        0.88,
        0.20,
        vertical_gradient(BORDER, BG_BOTTOM),
    )
    add_round_rect(
        canvas,
        0.09,
        0.09,
        0.82,
        0.82,
        0.17,
        vertical_gradient(BG_TOP, BG_BOTTOM),
    )
    add_round_rect(
        canvas,
        0.12,
        0.11,
        0.70,
        0.08,
        0.04,
        solid(SHINE),
    )

    add_circle(
        canvas,
        0.30,
        0.34,
        0.24,
        lambda x, y: with_alpha(BLUE_SOFT, 0.24 * (1.0 - clamp(math.hypot(x - 0.30, y - 0.34) / 0.24))),
    )

    panel_left = 0.20
    panel_top = 0.20
    panel_width = 0.48
    panel_height = 0.40
    panel_radius = 0.10

    add_round_rect(
        canvas,
        panel_left,
        panel_top + 0.02,
        panel_width,
        panel_height,
        panel_radius,
        solid(PANEL_SHADOW),
    )
    add_round_rect(
        canvas,
        panel_left,
        panel_top,
        panel_width,
        panel_height,
        panel_radius,
        solid(PANEL),
    )
    tail = [
        (panel_left + 0.10, panel_top + panel_height - 0.02),
        (panel_left + 0.20, panel_top + panel_height - 0.02),
        (panel_left + 0.11, panel_top + panel_height + 0.10),
    ]
    add_polygon(canvas, tail, solid(PANEL))

    add_round_rect(
        canvas,
        panel_left + 0.08,
        panel_top + 0.10,
        panel_width - 0.16,
        0.06,
        0.03,
        solid(BLUE),
    )
    add_round_rect(
        canvas,
        panel_left + 0.08,
        panel_top + 0.21,
        panel_width - 0.20,
        0.05,
        0.025,
        solid(TEXT),
    )
    add_round_rect(
        canvas,
        panel_left + 0.08,
        panel_top + 0.31,
        panel_width - 0.26,
        0.05,
        0.025,
        solid(TEXT),
    )

    add_circle(canvas, 0.74, 0.72, 0.17, solid(DANGER))
    add_round_rect(canvas, 0.65, 0.695, 0.18, 0.05, 0.025, solid(WHITE))

    return canvas


def downsample(canvas, size):
    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(SSAA):
                for sx in range(SSAA):
                    pixel = canvas[y * SSAA + sy][x * SSAA + sx]
                    for i in range(4):
                        acc[i] += pixel[i]
            samples = SSAA * SSAA
            rgba = tuple(int(round(clamp(channel / samples) * 255)) for channel in acc)
            row.append(rgba)
        pixels.append(row)
    return pixels


def write_png(path, pixels):
    size = len(pixels)
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b, a in row:
            raw.extend((r, g, b, a))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data)) +
            tag +
            data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    for size in SCALES:
        high_res = render_high_res(size)
        pixels = downsample(high_res, size)
        write_png(ROOT / f"icon-{size}.png", pixels)


if __name__ == "__main__":
    main()
