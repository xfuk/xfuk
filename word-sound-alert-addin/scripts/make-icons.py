#!/usr/bin/env python3
"""アドイン用アイコン(PNG)を外部ライブラリなしで生成する。
青い円の上に白いスピーカー(音)のマークを描く。"""
import struct
import zlib
import os

SIZES = [16, 32, 64, 80]
BG = (11, 92, 173)
FG = (255, 255, 255)


def png_bytes(w, h, rows):
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def draw(size):
    s = size
    c = (s - 1) / 2
    r = s / 2 - 0.5
    rows = []
    for y in range(s):
        row = []
        for x in range(s):
            dx, dy = x - c, y - c
            d = (dx * dx + dy * dy) ** 0.5
            # 円の縁をなめらかに
            a = max(0.0, min(1.0, r - d + 0.5))
            color = BG
            # スピーカー本体(左側の台形)と音波(右側の弧)
            u, v = x / s, y / s
            body = (0.22 <= u <= 0.36 and 0.38 <= v <= 0.62) or (0.36 < u <= 0.52 and abs(v - 0.5) <= 0.12 + (u - 0.36) * 1.1)
            wave = False
            for rr in (0.20, 0.30):
                dd = ((u - 0.50) ** 2 + (v - 0.5) ** 2) ** 0.5
                if abs(dd - rr) < 0.035 and u > 0.55 and abs(v - 0.5) < rr * 0.85:
                    wave = True
            if body or wave:
                color = FG
            row.extend([color[0], color[1], color[2], int(255 * a)])
        rows.append(row)
    return png_bytes(s, s, rows)


def main():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
    os.makedirs(out, exist_ok=True)
    for s in SIZES:
        path = os.path.join(out, f'icon-{s}.png')
        with open(path, 'wb') as f:
            f.write(draw(s))
        print('wrote', path)


if __name__ == '__main__':
    main()
