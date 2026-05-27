class Tripwire < Formula
  desc "Runtime detection daemon for developer workstations (credential reads, agent-aware)"
  homepage "https://github.com/jmaleonard/agent-tripwire"
  url "https://github.com/jmaleonard/agent-tripwire.git",
      branch: "main"
  version "0.0.1"
  license :cannot_represent  # TBD; tentative Apache-2.0 / MIT
  head "https://github.com/jmaleonard/agent-tripwire.git", branch: "main"

  depends_on "node@22"
  depends_on "pnpm"
  depends_on "rust" => :build
  # terminal-notifier gives macOS notifications a clean source-app identity
  # (instead of "Script Editor" from the osascript fallback).
  depends_on "terminal-notifier"

  def install
    ENV["PNPM_HOME"] = buildpath/".pnpm"
    ENV.prepend_path "PATH", ENV["PNPM_HOME"]

    system "pnpm", "install", "--frozen-lockfile"
    system "pnpm", "build"

    # Build the native filesystem watcher (Rust). The daemon discovers it via
    # createPlatformWatcher() and falls back to MockFsWatcher if not present.
    cd "helpers/tripwire-watcher" do
      system "cargo", "build", "--release"
    end

    # Build the Swift menubar app. `--disable-sandbox` in the build.sh stops
    # SwiftPM from applying its own sandbox-exec, which collides with Homebrew's
    # outer build sandbox. Best-effort: if Swift isn't available (no CLT
    # installed), warn and continue with the CLI-only install.
    if which("swift") && File.directory?("apps/menubar-macos")
      cd "apps/menubar-macos" do
        system "./scripts/build.sh"
      end
      app = "apps/menubar-macos/dist/Tripwire Menubar.app"
      if File.exist?("#{app}/Contents/MacOS/TripwireMenubar")
        prefix.install app
      else
        opoo "menubar app build produced no .app bundle; skipping"
      end
    else
      opoo "Swift not found; menubar app skipped. Install Xcode Command Line Tools and re-brew to get it."
    end

    libexec.install Dir["*"]

    # Symlink the watcher helper into libexec/bin so createPlatformWatcher()
    # finds it on its standard lookup path.
    helper = libexec/"helpers/tripwire-watcher/target/release/tripwire-watcher"
    (libexec/"bin").mkpath
    ln_sf helper, libexec/"bin/tripwire-watcher" if File.exist?(helper)

    (bin/"tripwire").write <<~SH
      #!/bin/bash
      exec "#{Formula["node@22"].opt_bin}/node" "#{libexec}/packages/cli/dist/main.js" "$@"
    SH
    chmod 0755, bin/"tripwire"
  end

  def post_install
    home_tripwire = "#{Dir.home}/.tripwire"
    Dir.mkdir(home_tripwire) unless File.directory?(home_tripwire)
  end

  def caveats
    msg = <<~EOS
      First run:
        tripwire setup

      Start the daemon (autostart on login):
        brew services start tripwire

      Dashboard:
        http://localhost:7878

    EOS
    if File.exist?("#{prefix}/Tripwire Menubar.app")
      msg += <<~EOS
        macOS menu-bar app installed at:
          #{prefix}/Tripwire Menubar.app
        To launch it now:
          open "#{prefix}/Tripwire Menubar.app"
        Drag it to ~/Applications/ to make it a login item.

      EOS
    else
      msg += <<~EOS
        Menubar app was not built (Swift toolchain not detected).
        To build it later:
          cd #{opt_libexec}/apps/menubar-macos
          ./scripts/build.sh

      EOS
    end
    msg
  end

  # `brew services start tripwire` uses this. KeepAlive so the daemon restarts
  # if it crashes; RunAtLoad so it starts at login.
  service do
    run [opt_bin/"tripwire", "daemon", "run"]
    keep_alive true
    run_at_load true
    log_path var/"log/tripwire/tripwired.log"
    error_log_path var/"log/tripwire/tripwired.err.log"
  end

  test do
    # Help text mentions the CLI name.
    assert_match "tripwire", shell_output("#{bin}/tripwire --help")
    # --version returns 0 with a recognizable version string.
    assert_match "tripwire", shell_output("#{bin}/tripwire --version")
  end
end
