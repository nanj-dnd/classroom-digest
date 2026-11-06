// OCR a scanned PDF using Apple's Vision framework. No network, no dependencies.
// usage: swift tools/ocr.swift <input.pdf> <output.txt>
import Foundation
import PDFKit
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
    FileHandle.standardError.write("usage: ocr.swift <input.pdf> <output.txt>\n".data(using: .utf8)!)
    exit(1)
}

var out = ""
let scale: CGFloat = 2.0   // upscale before OCR; scans are often low-DPI

for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    let rect = page.bounds(for: .mediaBox)
    let size = CGSize(width: rect.width * scale, height: rect.height * scale)

    let img = NSImage(size: size)
    img.lockFocus()
    guard let ctx = NSGraphicsContext.current?.cgContext else { img.unlockFocus(); continue }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(origin: .zero, size: size))
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: ctx)
    img.unlockFocus()

    guard let tiff = img.tiffRepresentation,
          let bmp = NSBitmapImageRep(data: tiff),
          let cg = bmp.cgImage else { continue }

    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])

    let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    out += "\n\n--- page \(i + 1) ---\n" + lines.joined(separator: "\n")
    FileHandle.standardError.write("page \(i + 1)/\(doc.pageCount)\r".data(using: .utf8)!)
}

try? out.write(toFile: args[2], atomically: true, encoding: .utf8)
FileHandle.standardError.write("\ndone: \(out.count) characters\n".data(using: .utf8)!)
