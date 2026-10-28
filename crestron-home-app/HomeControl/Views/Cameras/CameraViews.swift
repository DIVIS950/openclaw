import SwiftUI
import UIKit

struct CamerasView: View {
    @Environment(AppSettings.self) private var settings
    @State private var fullScreen: CameraConfig?

    var body: some View {
        ScrollView {
            if settings.cameras.isEmpty {
                EmptyState(icon: "video", title: "No cameras",
                           message: "Add a camera's snapshot URL in Settings › Cameras. Most IP cameras and NVRs offer one.")
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 16)], spacing: 16) {
                    ForEach(settings.cameras) { camera in
                        Button { fullScreen = camera } label: {
                            CameraTile(camera: camera)
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                .padding()
            }
        }
        .screenBackground()
        .navigationTitle("Cameras")
        .fullScreenCover(item: $fullScreen) { camera in
            ZStack(alignment: .topTrailing) {
                Color.black.ignoresSafeArea()
                CameraSnapshotView(camera: camera, interval: .milliseconds(500))
                    .ignoresSafeArea()
                Button { fullScreen = nil } label: {
                    Image(systemName: "xmark")
                        .font(.title2.weight(.semibold))
                        .frame(width: 48, height: 48)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .foregroundStyle(.white)
                .padding()
            }
        }
    }
}

struct CameraTile: View {
    let camera: CameraConfig

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            CameraSnapshotView(camera: camera)
            LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .center, endPoint: .bottom)
            HStack(spacing: 6) {
                Circle().fill(Theme.alert).frame(width: 8, height: 8)
                Text(camera.name).font(.headline).foregroundStyle(.white)
            }
            .padding(14)
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
    }
}

/// Shows a camera by refreshing its JPEG snapshot URL. Works with nearly every IP
/// camera/NVR (Hikvision, Dahua, Axis, Luma, Reolink…) without a video library.
struct CameraSnapshotView: View {
    let camera: CameraConfig
    var interval: Duration = .seconds(1)
    @State private var image: UIImage?
    @State private var failed: String?

    var body: some View {
        ZStack {
            Color.black
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
            } else if let failed {
                VStack(spacing: 8) {
                    Image(systemName: "video.slash").font(.title)
                    Text(failed).font(.footnote).multilineTextAlignment(.center)
                }
                .foregroundStyle(.secondary)
                .padding()
            } else {
                ProgressView()
            }
        }
        .task(id: camera) {
            let loader = CameraLoader(camera: camera)
            defer { loader.invalidate() }
            while !Task.isCancelled {
                do {
                    image = try await loader.fetch()
                    failed = nil
                } catch is CancellationError {
                    return
                } catch {
                    if image == nil { failed = error.localizedDescription }
                }
                try? await Task.sleep(for: interval)
            }
        }
    }
}

/// Fetches snapshots, answering Basic or Digest auth with the camera's credentials.
final class CameraLoader: NSObject, URLSessionTaskDelegate {
    private let url: URL?
    private let username: String
    private let password: String
    private var session: URLSession!

    init(camera: CameraConfig) {
        url = URL(string: camera.snapshotURL.trimmingCharacters(in: .whitespacesAndNewlines))
        username = camera.username
        password = camera.password
        super.init()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    func fetch() async throws -> UIImage {
        guard let url else { throw BackendError.notConfigured("Invalid snapshot URL") }
        let (data, response) = try await session.data(from: url)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw BackendError.http(http.statusCode, http.statusCode == 401 ? "Wrong camera username or password" : "Camera error")
        }
        guard let image = UIImage(data: data) else { throw BackendError.badResponse("The URL didn't return an image") }
        return image
    }

    func invalidate() { session.invalidateAndCancel() }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        let method = challenge.protectionSpace.authenticationMethod
        guard method == NSURLAuthenticationMethodHTTPBasic || method == NSURLAuthenticationMethodHTTPDigest,
              !username.isEmpty, challenge.previousFailureCount == 0
        else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        completionHandler(.useCredential, URLCredential(user: username, password: password, persistence: .forSession))
    }
}
