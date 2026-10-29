// Cuts the glitch sheet (assets/capri/glitch.png) into its pieces for her facecam overlay. The sheet
// is already on transparency; pieces are found by connected components, smallest specks dropped.
//
//     swiftc -O -target arm64-apple-macos13.0 -o /tmp/cut-glitch tools/cut-glitch.swift
//     /tmp/cut-glitch assets/capri/glitch.png assets/capri/glitch

import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count >= 3 else {
  print("usage: cut-glitch <sheet.png> <out-dir>")
  exit(2)
}
let inURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outDir = URL(fileURLWithPath: CommandLine.arguments[2])
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

guard let src = CGImageSourceCreateWithURL(inURL as CFURL, nil),
      let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
  print("cannot read \(inURL.path)")
  exit(1)
}
let W = img.width
let H = img.height

let bpr = W * 4
var buf = [UInt8](repeating: 0, count: bpr * H)
guard let ctx = CGContext(data: &buf, width: W, height: H, bitsPerComponent: 8, bytesPerRow: bpr,
                          space: CGColorSpaceCreateDeviceRGB(),
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
ctx.translateBy(x: 0, y: CGFloat(H))
ctx.scaleBy(x: 1, y: -1)
ctx.draw(img, in: CGRect(x: 0, y: 0, width: W, height: H))

@inline(__always) func alpha(_ x: Int, _ y: Int) -> Int {
  let i = y * bpr + x * 4 + 3
  return Int(buf[i])
}

// connected components on a half-size mask (plenty for finding the pieces)
let step = 2
let mw = W / step
let mh = H / step
var mask = [Bool](repeating: false, count: mw * mh)
for my in 0..<mh {
  for mx in 0..<mw where alpha(mx * step, my * step) > 40 {
    mask[my * mw + mx] = true
  }
}

var seen = [Bool](repeating: false, count: mw * mh)
var pieces: [(Int, Int, Int, Int, Int)] = [] // x, y, w, h, area (mask cells)
let dx = [1, -1, 0, 0, 1, 1, -1, -1]
let dy = [0, 0, 1, -1, 1, -1, 1, -1]

for my in 0..<mh {
  for mx in 0..<mw {
    let start = my * mw + mx
    if !mask[start] || seen[start] { continue }
    var stack = [start]
    seen[start] = true
    var minX = mx, maxX = mx, minY = my, maxY = my, area = 0
    while let at = stack.popLast() {
      let x = at % mw
      let y = at / mw
      area += 1
      minX = min(minX, x); maxX = max(maxX, x)
      minY = min(minY, y); maxY = max(maxY, y)
      for k in 0..<8 {
        let nx = x + dx[k]
        let ny = y + dy[k]
        if nx < 0 || ny < 0 || nx >= mw || ny >= mh { continue }
        let n = ny * mw + nx
        if mask[n] && !seen[n] {
          seen[n] = true
          stack.append(n)
        }
      }
    }
    if area >= 6 { // skip single specks
      pieces.append((minX * step, minY * step, (maxX - minX + 1) * step, (maxY - minY + 1) * step, area))
    }
  }
}

// biggest first, and a cap so the tile's overlay stays light
pieces.sort { $0.4 > $1.4 }
let keep = Array(pieces.prefix(90))
print("\(pieces.count) pieces, keeping \(keep.count)")

var n = 0
for (px, py, pw, ph, _) in keep {
  let pad = 2
  let x0 = max(0, px - pad)
  let y0 = max(0, py - pad)
  let x1 = min(W, px + pw + pad)
  let y1 = min(H, py + ph + pad)
  let w = x1 - x0
  let h = y1 - y0
  guard w > 3, h > 3 else { continue }

  var out = [UInt8](repeating: 0, count: w * h * 4)
  for y in 0..<h {
    for x in 0..<w {
      let sx = x0 + x
      let sy = y0 + y
      let i = sy * bpr + sx * 4
      let o = (y * w + x) * 4
      // already premultiplied on the sheet: copy as it is
      out[o] = buf[i]
      out[o + 1] = buf[i + 1]
      out[o + 2] = buf[i + 2]
      out[o + 3] = buf[i + 3]
    }
  }

  guard let provider = CGDataProvider(data: Data(out) as CFData),
        let piece = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                            provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { continue }
  n += 1
  let name = String(format: "g%02d.png", n)
  let url = outDir.appendingPathComponent(name)
  guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { continue }
  CGImageDestinationAddImage(dest, piece, nil)
  CGImageDestinationFinalize(dest)
  print("\(name)  \(w)x\(h)")
}
print("\(n) pieces")
