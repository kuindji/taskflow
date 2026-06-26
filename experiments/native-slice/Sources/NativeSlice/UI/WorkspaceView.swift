import SwiftUI

struct WorkspaceView: View {
    let selectedTaskId: String?
    var body: some View {
        Text(selectedTaskId.map { "Selected task: \($0)" } ?? "No task selected")
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
