import XCTest
@testable import Taskflow

@MainActor
final class SettingsViewModelTests: XCTestCase {
    // Minimal valid AppSettings JSON fixture (all required fields present).
    // AnyCodable non-optional fields (defaultEffort, permissionMode) accept null → AnyCodable(.null).
    private let settingsJSON = """
    {
      "general": {
        "fontFamily": "Menlo",
        "fontSize": 13.0,
        "defaultAgent": "claude",
        "defaultRuntime": "bun",
        "favoriteAgents": ["claude"],
        "confirmBeforeExit": false
      },
      "terminal": {
        "fontFamily": "Menlo",
        "fontSize": 13.0,
        "defaultShell": "/bin/zsh"
      },
      "editor": {
        "fontFamily": "Menlo",
        "fontSize": 13.0,
        "wordWrap": false,
        "internalEditor": "default",
        "externalEditor": ""
      },
      "layout": {
        "window": {
          "x": null,
          "y": null,
          "width": 1280.0,
          "height": 800.0,
          "isMaximized": false
        },
        "panels": {
          "sidebarWidth": 280.0,
          "fileExplorerWidth": 260.0,
          "taskInfoWidth": 320.0,
          "flowPanelWidth": 400.0,
          "compactSidebar": false,
          "collapsedProjectIds": [],
          "markdownEditorPosition": null,
          "markdownEditorSize": null
        }
      },
      "claude": {
        "defaultModel": "claude-opus-4-5",
        "defaultEffort": null,
        "dangerouslySkipPermissions": false,
        "permissionMode": null
      },
      "codex": {
        "defaultModel": "o4-mini",
        "sandbox": "workspace-write",
        "approvalPolicy": "always",
        "fullAuto": false
      },
      "opencode": {
        "defaultModel": "claude-opus-4-5",
        "defaultVariant": "",
        "autoApprove": false
      },
      "gemini": {
        "defaultModel": "gemini-2.0-flash",
        "approvalMode": "interactive",
        "sandbox": false
      },
      "cursor": {
        "defaultModel": "claude-sonnet",
        "yolo": false
      },
      "pi": {
        "defaultModel": "claude-2024-06",
        "thinking": "high",
        "tools": ""
      },
      "appearance": {
        "theme": "default-dark"
      },
      "remoteAgent": {
        "autoStart": false,
        "appName": "Taskflow",
        "headless": false
      }
    }
    """

    func testDecodeAppSettings() throws {
        let data = Data(settingsJSON.utf8)
        let settings = try JSONDecoder().decode(AppSettings.self, from: data)
        XCTAssertEqual(settings.general.fontFamily, "Menlo")
        XCTAssertEqual(settings.layout.panels.sidebarWidth, 280.0)
        XCTAssertFalse(settings.layout.panels.compactSidebar)
        XCTAssertEqual(settings.appearance.theme, "default-dark")
        XCTAssertEqual(settings.general.defaultAgent, .claude)
    }

    func testApplyFetchedSettingsStoresSettingsAndFiresHydrateCallback() throws {
        let data = Data(settingsJSON.utf8)
        let settings = try JSONDecoder().decode(AppSettings.self, from: data)

        // WSClient won't connect (port 0) — we only test the apply path.
        let client = WSClient(url: URL(string: "ws://localhost:0")!)
        let vm = SettingsViewModel(client: client)

        var receivedPanels: PanelSettings?
        vm.onLayoutHydrate = { panels in receivedPanels = panels }

        vm.applyFetchedSettings(settings)

        XCTAssertEqual(vm.settings?.general.fontFamily, "Menlo")
        XCTAssertNotNil(receivedPanels)
        XCTAssertEqual(receivedPanels?.sidebarWidth, 280.0)
        XCTAssertFalse(receivedPanels?.compactSidebar ?? true)
    }

    func testApplyFetchedSettingsWithNilHydrateStoresSettings() throws {
        let data = Data(settingsJSON.utf8)
        let settings = try JSONDecoder().decode(AppSettings.self, from: data)

        let client = WSClient(url: URL(string: "ws://localhost:0")!)
        let vm = SettingsViewModel(client: client)

        // onLayoutHydrate left nil — applyFetchedSettings must not crash and must store settings.
        vm.applyFetchedSettings(settings)

        XCTAssertNotNil(vm.settings)
        XCTAssertEqual(vm.settings?.appearance.theme, "default-dark")
    }
}
