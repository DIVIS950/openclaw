import Foundation
import Observation
import UIKit

/// Shop logos: the website's icon (via Google's icon service), kept on the phone so
/// cards keep their logo offline. Unknown sites answer with a tiny globe, which is
/// treated as "no logo" (the card then shows its category icon).
@MainActor
@Observable
final class LogoStore {
    static let shared = LogoStore()

    private(set) var images: [String: UIImage] = [:]
    @ObservationIgnored private var tried: Set<String> = []

    private var folder: URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("logos")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func load(_ domain: String) async {
        guard !domain.isEmpty, images[domain] == nil, !tried.contains(domain) else { return }
        tried.insert(domain)
        let file = folder.appendingPathComponent(domain + ".png")
        if let data = try? Data(contentsOf: file), let image = UIImage(data: data) {
            images[domain] = image
            return
        }
        guard let url = URL(string: "https://www.google.com/s2/favicons?domain=\(domain)&sz=128") else { return }
        guard let result = try? await URLSession.shared.data(from: url) else { return }
        let (data, response) = result
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let image = UIImage(data: data),
              image.size.width * image.scale >= 32
        else { return }
        images[domain] = image
        try? data.write(to: file, options: .atomic)
    }

    /// A picked picture as a small square logo (128 px), centred and cropped.
    static func squareLogo(from image: UIImage) -> Data? {
        let side = min(image.size.width, image.size.height)
        guard side > 0 else { return nil }
        let target = CGSize(width: 128, height: 128)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let scaled = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            let scale = 128 / side
            let w = image.size.width * scale
            let h = image.size.height * scale
            image.draw(in: CGRect(x: (128 - w) / 2, y: (128 - h) / 2, width: w, height: h))
        }
        if let png = scaled.pngData(), png.count <= 60_000 {
            return png
        }
        return scaled.jpegData(compressionQuality: 0.85)
    }
}
