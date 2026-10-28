// Watches the top-level windows so Capri can sit on them (macOS).
// Prints one JSON line whenever something changes, in the same shape as windows.ps1:
// the front window and the visible windows in z-order (front first), in Quartz points
// (top-left origin, the same space as the overlay's bounds). No contents, and no titles
// unless macOS has granted Screen Recording: the title of the front window is only checked
// against a short list of AI names for her jealousy, and all that goes out is which matched.
//
//   capri-windows --self <pid> [--dump]

import Cocoa
import CoreGraphics
import Darwin

// Other AIs: a key, and what gives them away in the front app's name or window title.
let AIS: [(String, String)] = [
  ("chatgpt", "chatgpt"),
  ("claude", "claude"),
  ("codex", "codex"),
  ("gemini", "gemini"),
  ("copilot", "copilot"),
  ("perplexity", "perplexity"),
  ("deepseek", "deepseek"),
  ("grok", "grok"),
  ("lechat", "le chat|mistral"),
  ("characterai", "character\\.ai"),
  ("metaai", "meta ai"),
]

let NOT_GAME = try! NSRegularExpression(pattern: "launcher|client|redistributable|steamworks", options: [.caseInsensitive])
let GAME = try! NSRegularExpression(pattern: "steamapps/common/([^/]+)/", options: [.caseInsensitive])

func json(_ text: String) -> String {
  var out = "\""
  for ch in text.unicodeScalars {
    switch ch {
    case "\"": out += "\\\""
    case "\\": out += "\\\\"
    case "\n": out += "\\n"
    case "\t": out += "\\t"
    default: out.unicodeScalars.append(ch)
    }
  }
  return out + "\""
}

func path(of pid: pid_t) -> String? {
  var buffer = [UInt8](repeating: 0, count: 4096)
  let size = buffer.withUnsafeMutableBytes { raw in
    proc_pidpath(pid, raw.baseAddress, UInt32(raw.count))
  }
  guard size > 0 else { return nil }
  return String(cString: buffer)
}

// A game: its program sits in a launcher's library. The game is the folder's name there.
func gameName(of pid: pid_t) -> String? {
  guard let file = path(of: pid) else { return nil }
  let range = NSRange(file.startIndex..., in: file)
  guard let match = GAME.firstMatch(in: file, options: [], range: range),
        let nameRange = Range(match.range(at: 1), in: file) else { return nil }
  let name = String(file[nameRange])
  let nameNS = NSRange(name.startIndex..., in: name)
  if NOT_GAME.firstMatch(in: name, options: [], range: nameNS) != nil { return nil }
  return name
}

// The USB sticks (and SD cards) plugged in, by name, looked at every couple of seconds.
var usbCache = "[]"
var usbAt = Date.distantPast
func usbSticks() -> String {
  if Date().timeIntervalSince(usbAt) < 15 { return usbCache }
  usbAt = Date()
  let task = Process()
  task.executableURL = URL(fileURLWithPath: "/usr/sbin/diskutil")
  task.arguments = ["list", "external", "physical"]
  let pipe = Pipe()
  task.standardOutput = pipe
  task.standardError = FileHandle.nullDevice
  do { try task.run() } catch { return usbCache }
  let data = pipe.fileHandleForReading.readDataToEndOfFile()
  task.waitUntilExit()
  let text = String(data: data, encoding: .utf8) ?? ""
  // whole disks only ("/dev/disk4"), never their slices ("/dev/disk4s1")
  let pattern = try! NSRegularExpression(pattern: "/dev/(disk\\d+)\\b")
  let range = NSRange(text.startIndex..., in: text)
  var seen = Set<String>()
  for match in pattern.matches(in: text, options: [], range: range) {
    guard let found = Range(match.range(at: 1), in: text) else { continue }
    seen.insert(String(text[found]))
  }
  let out = "[" + seen.sorted().map { json($0) }.joined(separator: ",") + "]"
  usbCache = out
  return usbCache
}

func snapshot(selfPid: pid_t) -> String {
  // onscreen, front to back. The first ordinary window is the one in front: NSWorkspace's idea of
  // the frontmost app is not reliable from a background process, and it sees the Dock as nothing.
  let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
  var wins = ""
  var count = 0
  var frontID = 0
  var aiKeys: Set<String> = []
  var game: String? = nil

  for info in raw {
    let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0
    let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
    // 0 is an ordinary window; 3 is an app's floating one (always-on-top players, the demo terminal).
    // Her own overlay is layer 1000, so it never shows up here.
    if layer < 0 || layer > 3 { continue }
    let alpha = (info[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1
    if alpha < 0.05 { continue }
    guard let box = info[kCGWindowBounds as String] as? NSDictionary,
          let rect = CGRect(dictionaryRepresentation: box as CFDictionary) else { continue }
    if rect.width < 200 || rect.height < 120 { continue }
    if rect.width > 20000 || rect.height > 20000 { continue }
    let owner = (info[kCGWindowOwnerName as String] as? String ?? "").lowercased()
    if owner == "window server" || owner == "dock" || owner == "control center" { continue }
    let id = (info[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0
    let title = (info[kCGWindowName as String] as? String ?? "").lowercased()

    // the front window: her jealousy (by the app's name, always; the window title needs Screen
    // Recording), which game it is, and where she'd sit
    if frontID == 0 {
      frontID = id
      let haystack = owner + " " + title
      for (key, pattern) in AIS where haystack.range(of: pattern, options: .regularExpression) != nil {
        aiKeys.insert(key)
      }
      game = gameName(of: pid)
    }

    // a window bigger than the screen it sits on: fullscreen, or zoomed
    let monitor = NSScreen.screens.first { screen in
      let quartz = quartzFrame(screen)
      return quartz.intersects(rect) && rect.width >= quartz.width - 4 && rect.height >= quartz.height - 4
    }
    let zoomed = monitor != nil

    if count > 0 { wins += "," }
    count += 1
    wins += "{\"id\":\(id),\"x\":\(Int(rect.origin.x)),\"y\":\(Int(rect.origin.y)),\"w\":\(Int(rect.width)),\"h\":\(Int(rect.height)),\"max\":\(zoomed ? "true" : "false")}"
    if count >= 40 { break }
  }

  // the Dock is never "in front" the way the taskbar can be: no windows at all means the floor
  let keys = aiKeys.sorted().map { json($0) }.joined(separator: ",")

  return "{\"fg\":\(frontID),\"taskbar\":false,\"ai\":[\(keys)],\"game\":\(game.map { json($0) } ?? "null"),\"usb\":\(usbSticks()),\"plug\":null,\"wins\":[\(wins)]}"
}

// AppKit screens are bottom-left; Quartz (and the overlay) are top-left of the main display.
func quartzFrame(_ screen: NSScreen) -> CGRect {
  guard let main = NSScreen.screens.first else { return screen.frame }
  return CGRect(x: screen.frame.minX, y: main.frame.height - screen.frame.maxY, width: screen.frame.width, height: screen.frame.height)
}

_ = NSApplication.shared

// --- args ---
var selfPid: pid_t = 0
var parentPid: pid_t = 0
var dumpOnly = false
var args = CommandLine.arguments.dropFirst().makeIterator()
while let arg = args.next() {
  switch arg {
  case "--self": selfPid = pid_t(Int(args.next() ?? "0") ?? 0)
  case "--pid": parentPid = pid_t(Int(args.next() ?? "0") ?? 0)
  case "--dump": dumpOnly = true
  default: break
  }
}
if selfPid == 0 { selfPid = getpid() }

if dumpOnly {
  if CommandLine.arguments.contains("--verbose") {
    let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    for info in raw {
      let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? 0
      let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
      let owner = info[kCGWindowOwnerName as String] as? String ?? ""
      let title = info[kCGWindowName as String] as? String ?? ""
      let box = info[kCGWindowBounds as String] as? NSDictionary
      let rect = box.flatMap { CGRect(dictionaryRepresentation: $0 as CFDictionary) } ?? .zero
      print("pid=\(pid) layer=\(layer) owner=\(owner) title=\(title) rect=\(Int(rect.origin.x)),\(Int(rect.origin.y)) \(Int(rect.width))x\(Int(rect.height))")
    }
    exit(0)
  }
  print(snapshot(selfPid: selfPid))
  exit(0)
}

// one line per change, the way windows.ps1 does it
var last = ""
var tick = 0
while true {
  let snap = snapshot(selfPid: selfPid)
  if snap != last {
    print(snap)
    fflush(stdout)
    last = snap
  }
  tick += 1
  // stop with Capri, even if she crashed without telling us
  if parentPid != 0 && tick % 20 == 0 && kill(parentPid, 0) != 0 { exit(0) }
  usleep(150_000)
}
