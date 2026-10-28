// Watches the top-level windows so Capri can sit on them (macOS), and what you plug in.
// Prints one JSON line whenever something changes: the front window and the visible windows in
// z-order (front first), in Quartz points (top-left origin, the same space as the overlay's
// bounds), where the Dock's pill is (`dock`, the ledge she rests on), the USB sticks (`usb`, by
// volume name), the last USB device that arrived or went (`plug`, the way windows.ps1 gives it),
// and the game in front (`game`). No contents, and no titles unless macOS has granted Screen
// Recording: the title of the front window is only checked against a short list of AI names for
// her jealousy, and all that goes out is which matched.
//
//   capri-windows --self <pid> [--dump]
//   capri-windows --devices | --disk <id> | --game <path>   (a look under the hood)

import Cocoa
import CoreGraphics
import Darwin
import IOKit

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
// A game is the folder of its launcher's library. Steam keeps one, Epic another; GOG installs an
// ordinary .app, and so does Riot, so those two are told apart below.
let STEAM = try! NSRegularExpression(pattern: "steamapps/common/([^/]+)/", options: [.caseInsensitive])
let EPIC = try! NSRegularExpression(pattern: "/epic games/([^/]+)/", options: [.caseInsensitive])
// Riot's titles, by the name of their .app (they install in /Applications, not in a library)
let RIOT: [(String, String)] = [
  ("league of legends", "League of Legends"),
  ("teamfight tactics", "Teamfight Tactics"),
  ("legends of runeterra", "Legends of Runeterra"),
  ("valorant", "VALORANT"),
  ("2xko", "2XKO"),
]

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

// GOG puts its own file in the bundle of the games it installs (an ordinary .app otherwise).
func gogGame(_ bundle: String) -> Bool {
  let resources = bundle + "/Contents/Resources"
  guard let files = try? FileManager.default.contentsOfDirectory(atPath: resources) else { return false }
  return files.contains { $0.hasPrefix("goggame-") && $0.hasSuffix(".info") }
}

// A game: its program sits in a launcher's library, or it's one of the few titles that install as
// their own .app. Steam and Epic by their library folder, GOG by its file in the bundle, Riot by
// name (its launcher keeps every game in its own .app, and has no library folder).
func gameName(of pid: pid_t) -> String? {
  guard let file = path(of: pid) else { return nil }
  return gameName(path: file)
}

func gameName(path file: String) -> String? {
  for pattern in [STEAM, EPIC] {
    let range = NSRange(file.startIndex..., in: file)
    guard let match = pattern.firstMatch(in: file, options: [], range: range),
          let nameRange = Range(match.range(at: 1), in: file) else { continue }
    let name = String(file[nameRange])
    let nameNS = NSRange(name.startIndex..., in: name)
    if NOT_GAME.firstMatch(in: name, options: [], range: nameNS) == nil { return name }
  }
  let lower = file.lowercased()
  if let (_, title) = RIOT.first(where: { lower.contains("/\($0.0).app/") }) { return title }
  if let app = file.range(of: ".app/", options: .caseInsensitive) {
    let bundle = String(file[file.startIndex..<app.lowerBound]) + ".app"
    let name = (bundle as NSString).lastPathComponent.replacingOccurrences(of: ".app", with: "")
    let nameNS = NSRange(name.startIndex..., in: name)
    if gogGame(bundle) && NOT_GAME.firstMatch(in: name, options: [], range: nameNS) == nil { return name }
  }
  return nil
}

// What a disk calls itself: its volume's name, else the stick's own, else its identifier. The
// whole disk rarely carries the volume's name (the volume is a slice of it, "disk4s1", or of its
// APFS container, "disk5s1").
func diskInfo(_ id: String) -> [String: Any] {
  let task = Process()
  task.executableURL = URL(fileURLWithPath: "/usr/sbin/diskutil")
  task.arguments = ["info", "-plist", id]
  let pipe = Pipe()
  task.standardOutput = pipe
  task.standardError = FileHandle.nullDevice
  guard (try? task.run()) != nil else { return [:] }
  let data = pipe.fileHandleForReading.readDataToEndOfFile()
  task.waitUntilExit()
  guard let any = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil),
        let info = any as? [String: Any] else { return [:] }
  return info
}

func volumeName(_ id: String) -> String? {
  if let name = diskInfo(id)["VolumeName"] as? String, !name.isEmpty, name != "Not applicable" { return name }
  return nil
}

func diskName(_ id: String) -> String {
  let whole = diskInfo(id)
  if let name = whole["VolumeName"] as? String, !name.isEmpty, name != "Not applicable" { return name }
  if let name = volumeName(id + "s1") { return name }
  if let container = whole["APFSContainerReference"] as? String, let name = volumeName(container + "s1") { return name }
  if let name = whole["MediaName"] as? String, !name.isEmpty, name != "Not applicable" { return name }
  return id
}

// The USB sticks (and SD cards) plugged in, by name. Looked at every 15 s, and again a few times
// right after something is plugged in (the disk mounts a moment after the device appears).
var usbCache = "[]"
var usbAt = Date.distantPast
var usbDirtyUntil = Date.distantPast
let plugLock = NSLock()

func markUSBDirty() {
  plugLock.lock()
  usbDirtyUntil = Date().addingTimeInterval(6)
  plugLock.unlock()
}

func usbSticks() -> String {
  plugLock.lock()
  let soon = Date() < usbDirtyUntil
  plugLock.unlock()
  if Date().timeIntervalSince(usbAt) < (soon ? 1 : 15) { return usbCache }
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
  let out = "[" + seen.sorted().map { json(diskName($0)) }.joined(separator: ",") + "]"
  usbCache = out
  return usbCache
}

// --- what you plug in ---
// A USB device appearing or going: IOKit says so as it happens, no polling. The first look is just
// what's already there (the helper starting up doesn't announce your whole desk), and hubs are
// left out: they come with the devices you plugged in and would only talk over them.
var plugCount = 0
var plugJSON = "null"
var usbPresent: [UInt64: (name: String, cls: String)] = [:]
var usbPrimed = false

func plugName(_ service: io_object_t) -> String {
  for key in ["USB Product Name", "kUSBProductString", "USB Vendor Name"] {
    if let value = IORegistryEntryCreateCFProperty(service, key as CFString, kCFAllocatorDefault, 0)?
      .takeRetainedValue() as? String, !value.isEmpty {
      return value
    }
  }
  return "USB device"
}

// The classes windows.ps1 gives, from the name (which says more than the device class on a Mac:
// a headset's DAC calls itself "miscellaneous") and from the class as a fallback.
func deviceClass(name: String, cls: Int, sub: Int) -> String? {
  let n = name.lowercased()
  if n.range(of: "built-in|internal|bluetooth|touch bar|touch id|ambient light|root hub", options: .regularExpression) != nil { return nil }
  if cls == 9 { return nil } // a hub
  if n.range(of: "audio|headset|headphone|speaker|dac|microphone|sound", options: .regularExpression) != nil { return "AudioEndpoint" }
  if n.range(of: "camera|webcam|facetime", options: .regularExpression) != nil { return "Camera" }
  if n.range(of: "keyboard", options: .regularExpression) != nil { return "Keyboard" }
  if n.range(of: "mouse|trackpad", options: .regularExpression) != nil { return "Mouse" }
  if n.range(of: "controller|gamepad|xbox|dualsense|dualshock|joy-?con", options: .regularExpression) != nil { return "HIDClass" }
  if n.range(of: "iphone|ipad|android|phone|galaxy|pixel|oneplus|xiaomi|huawei", options: .regularExpression) != nil { return "" }
  switch cls {
  case 1: return "AudioEndpoint"
  case 3: return sub == 1 ? "Keyboard" : sub == 2 ? "Mouse" : "HIDClass"
  case 6, 14: return "Camera"
  case 8: return "DiskDrive"
  default: return ""
  }
}

func plugClass(_ service: io_object_t, name: String) -> String? {
  func number(_ key: String) -> Int {
    (IORegistryEntryCreateCFProperty(service, key as CFString, kCFAllocatorDefault, 0)?
      .takeRetainedValue() as? NSNumber)?.intValue ?? 0
  }
  return deviceClass(name: name, cls: number("bDeviceClass"), sub: number("bDeviceSubClass"))
}

func announce(name: String, cls: String, plugged: Bool) {
  plugLock.lock()
  plugCount += 1
  plugJSON = "{\"n\":\(plugCount),\"in\":\(plugged),\"name\":\(json(name)),\"class\":\(json(cls))}"
  plugLock.unlock()
  if cls == "DiskDrive" { markUSBDirty() } // the disk mounts a moment later: look again soon
}

func watchUSB() {
  guard let port = IONotificationPortCreate(kIOMainPortDefault),
        let source = IONotificationPortGetRunLoopSource(port)?.takeUnretainedValue() else { return }
  CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .defaultMode)

  let arrived: IOServiceMatchingCallback = { _, iterator in
    while true {
      let service = IOIteratorNext(iterator)
      if service == 0 { break }
      var id: UInt64 = 0
      IORegistryEntryGetRegistryEntryID(service, &id)
      let name = plugName(service)
      if let cls = plugClass(service, name: name) {
        usbPresent[id] = (name, cls)
        if usbPrimed { announce(name: name, cls: cls, plugged: true) }
      }
      IOObjectRelease(service)
    }
    usbPrimed = true // what was already there isn't news
  }
  let left: IOServiceMatchingCallback = { _, iterator in
    while true {
      let service = IOIteratorNext(iterator)
      if service == 0 { break }
      var id: UInt64 = 0
      IORegistryEntryGetRegistryEntryID(service, &id)
      if let device = usbPresent.removeValue(forKey: id), usbPrimed {
        announce(name: device.name, cls: device.cls, plugged: false)
      }
      IOObjectRelease(service)
    }
  }

  var first: io_iterator_t = 0
  if let match = IOServiceMatching("IOUSBHostDevice") {
    IOServiceAddMatchingNotification(port, kIOFirstMatchNotification, match, arrived, nil, &first)
    arrived(nil, first) // the ones already plugged in
  }
  var gone: io_iterator_t = 0
  if let match = IOServiceMatching("IOUSBHostDevice") {
    IOServiceAddMatchingNotification(port, kIOTerminatedNotification, match, left, nil, &gone)
    left(nil, gone)
  }
  CFRunLoopRun()
}

// The Dock, on macOS: a floating pill that doesn't span the screen, and whose bar rect macOS
// doesn't publish (its only window is the whole display). The work area gives its edge and
// height exactly: the Dock reserves them. Its width comes from its own settings, a tile being
// `tilesize` wide plus the Dock's gap and padding. Finder and the Trash are always there; the
// minimized windows aren't in its list, and leaving them out keeps her seat left of the real
// end of the Dock, so she's never floating past it.
func dockPref(_ key: String) -> Any? {
  CFPreferencesCopyAppValue(key as CFString, "com.apple.dock" as CFString)
}

func dockRect() -> String? {
  guard let screen = NSScreen.screens.first else { return nil }
  if (dockPref("autohide") as? NSNumber)?.boolValue == true { return nil } // it isn't there: no ledge
  if (dockPref("orientation") as? String) != "bottom" { return nil } // a side Dock isn't a ledge
  let band = Int(screen.visibleFrame.minY - screen.frame.minY) // the Dock's strip, in points
  if band < 8 { return nil }
  let tilesize = (dockPref("tilesize") as? NSNumber)?.doubleValue ?? 48
  var tiles = 2 // Finder and the Trash: never in the list
  for key in ["persistent-apps", "persistent-others"] {
    tiles += (dockPref(key) as? [Any])?.count ?? 0
  }
  if (dockPref("show-recents") as? NSNumber)?.boolValue == true {
    tiles += (dockPref("recent-apps") as? [Any])?.count ?? 0
  }
  let slot = Int((tilesize * 1.26).rounded()) // a tile and the gap after it
  let pad = Int((tilesize * 0.15).rounded())
  let width = tiles * slot + 2 * pad
  let quartz = quartzFrame(screen)
  return "{\"x\":\(Int(quartz.midX) - width / 2),\"y\":\(Int(quartz.maxY) - band),\"w\":\(width),\"h\":\(band)}"
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
  plugLock.lock()
  let plug = plugJSON
  plugLock.unlock()

  return "{\"fg\":\(frontID),\"taskbar\":false,\"ai\":[\(keys)],\"game\":\(game.map { json($0) } ?? "null"),\"usb\":\(usbSticks()),\"plug\":\(plug),\"dock\":\(dockRect() ?? "null"),\"wins\":[\(wins)]}"
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
  case "--game": // what she'd make of a program's path (a look under the hood)
    print(gameName(path: args.next() ?? "") ?? "-")
    exit(0)
  case "--disk": // what she'd call a disk (a look under the hood)
    print(diskName(args.next() ?? ""))
    exit(0)
  default: break
  }
}
if selfPid == 0 { selfPid = getpid() }

// --devices: what's plugged in right now, as she sees it (a look under the hood)
if CommandLine.arguments.contains("--devices") {
  var iterator: io_iterator_t = 0
  if let match = IOServiceMatching("IOUSBHostDevice") {
    IOServiceGetMatchingServices(kIOMainPortDefault, match, &iterator)
    while true {
      let service = IOIteratorNext(iterator)
      if service == 0 { break }
      let name = plugName(service)
      print("\(name)  [\(plugClass(service, name: name) ?? "hub, left out")]")
      IOObjectRelease(service)
    }
    IOObjectRelease(iterator)
  }
  exit(0)
}

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

// the things you plug in, watched on their own thread (IOKit's notifications need a run loop)
Thread { watchUSB() }.start()

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
