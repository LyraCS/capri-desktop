// Cuts a sheet of her faces into one picture per face, for her facecam (box.html).
//
//     swiftc -O -target arm64-apple-macos13.0 -o /tmp/cut-faces tools/cut-faces.swift
//     /tmp/cut-faces assets/capri/sprites.png assets/capri/faces [prefix]
//
// The sheet is a grid of cells on black; the gutters and the outer border are found by looking for
// rows and columns that are black all the way through, so a sheet with different spacing still works.
// Files come out row by row: f01.png (top left), f02.png, and so on (prefix "v" gives v01.png);
// no dependencies but the macOS SDK.

import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count >= 3 else {
  print("usage: cut-faces <sheet.png> <out-dir> [prefix]")
  exit(2)
}
let prefix = CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : "f"

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

// top-left-origin pixels (the context draws bottom-up, so flip it)
let bpr = W * 4
var buf = [UInt8](repeating: 0, count: bpr * H)
guard let ctx = CGContext(data: &buf, width: W, height: H, bitsPerComponent: 8, bytesPerRow: bpr,
                          space: CGColorSpaceCreateDeviceRGB(),
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { exit(1) }
ctx.translateBy(x: 0, y: CGFloat(H))
ctx.scaleBy(x: 1, y: -1)
ctx.draw(img, in: CGRect(x: 0, y: 0, width: W, height: H))

@inline(__always) func dark(_ x: Int, _ y: Int) -> Bool {
  let i = y * bpr + x * 4
  return Int(buf[i]) + Int(buf[i + 1]) + Int(buf[i + 2]) < 30
}
func darkColumn(_ x: Int) -> Bool {
  var y = 2
  while y < H - 2 {
    if !dark(x, y) { return false }
    y += 6
  }
  return true
}
func darkRow(_ y: Int) -> Bool {
  var x = 2
  while x < W - 2 {
    if !dark(x, y) { return false }
    x += 6
  }
  return true
}

// the stretches that aren't black: one per cell, left to right (or top to bottom)
func content(_ isGutter: (Int) -> Bool, _ n: Int) -> [(Int, Int)] {
  var out: [(Int, Int)] = []
  var start = -1
  for i in 0..<n {
    if isGutter(i) {
      if start >= 0 { out.append((start, i)); start = -1 }
    } else if start < 0 {
      start = i
    }
  }
  if start >= 0 { out.append((start, n)) }
  return out
}

var cols = content(darkColumn, W)
var rows = content(darkRow, H)

// a sheet with no clear gutters: fall back to an even 5 x 5
if cols.count < 2 || rows.count < 2 {
  print("no gutters found: cutting an even 5 x 5")
  cols = (0..<5).map { (W * $0 / 5, W * ($0 + 1) / 5) }
  rows = (0..<5).map { (H * $0 / 5, H * ($0 + 1) / 5) }
}

let inset = 2 // drop the black edge of each cell
var n = 0
for (r, row) in rows.enumerated() {
  for (c, col) in cols.enumerated() {
    let x = col.0 + inset
    let y = row.0 + inset
    let w = col.1 - col.0 - inset * 2
    let h = row.1 - row.0 - inset * 2
    guard w > 40, h > 40 else { continue }
    guard let crop = img.cropping(to: CGRect(x: x, y: y, width: w, height: h)) else { continue }
    n += 1
    let name = String(format: "%@%02d.png", prefix, n)
    let url = outDir.appendingPathComponent(name)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { continue }
    CGImageDestinationAddImage(dest, crop, nil)
    if !CGImageDestinationFinalize(dest) { print("cannot write \(name)") }
    print("\(name)  \(w)x\(h)  at \(x),\(y)")
  }
}
print("\(n) faces from \(W)x\(H)")
