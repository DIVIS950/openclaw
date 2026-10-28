import Observation
import UIKit

/// Optional photos for room cards, stored in Application Support.
@MainActor
@Observable
final class RoomPhotos {
    private var cache: [String: UIImage] = [:]
    @ObservationIgnored private var missing: Set<String> = []

    private var folder: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("RoomPhotos", isDirectory: true)
    }

    func image(for roomId: String) -> UIImage? {
        if let image = cache[roomId] { return image }
        if missing.contains(roomId) { return nil }
        guard let image = UIImage(contentsOfFile: file(roomId).path) else {
            missing.insert(roomId)
            return nil
        }
        // Reading during a view update must not mutate observed state synchronously.
        Task { self.cache[roomId] = image }
        return image
    }

    func setImage(_ data: Data, for roomId: String) {
        guard let image = UIImage(data: data) else { return }
        let resized = image.resized(maxSide: 1600)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? resized.jpegData(compressionQuality: 0.85)?.write(to: file(roomId), options: .atomic)
        missing.remove(roomId)
        cache[roomId] = resized
    }

    func removeImage(for roomId: String) {
        try? FileManager.default.removeItem(at: file(roomId))
        missing.insert(roomId)
        cache[roomId] = nil
    }

    private func file(_ roomId: String) -> URL {
        let safe = roomId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? roomId
        return folder.appendingPathComponent("\(safe).jpg")
    }
}

private extension UIImage {
    func resized(maxSide: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxSide else { return self }
        let scale = maxSide / longest
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        return UIGraphicsImageRenderer(size: target).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}
