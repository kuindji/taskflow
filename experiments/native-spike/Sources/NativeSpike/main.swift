//
//  main.swift
//  NativeSpike — de-risking spike for a native macOS Taskflow shell.
//
//  Boots a plain programmatic AppKit app (no storyboard, no .xcodeproj) and
//  hands control to AppDelegate, which embeds a libghostty terminal surface as
//  ONE view inside a normal window — deliberately not a terminal-first app.
//

import AppKit

// Top-level code is nonisolated under Swift 6; AppKit setup is main-actor work,
// and this runs on the main thread, so assert that isolation explicitly.
MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)

    let delegate = AppDelegate()
    app.delegate = delegate

    app.run()
}
