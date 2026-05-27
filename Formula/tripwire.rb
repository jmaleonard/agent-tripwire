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

  def install
    ENV["PNPM_HOME"] = buildpath/".pnpm"
    ENV.prepend_path "PATH", ENV["PNPM_HOME"]

    # Only build the Node packages here — SwiftPM doesn't run cleanly inside
    # Homebrew's build sandbox (`sandbox-exec: Operation not permitted` when
    # the SwiftPM manifest tries to apply its own sandbox). Users build the
    # menubar app separately — see caveats.
    system "pnpm", "install", "--frozen-lockfile"
    system "pnpm", "build"

    libexec.install Dir["*"]

    (bin/"tripwire").write <<~SH
      #!/bin/bash
      exec "#{Formula["node@22"].opt_bin}/node" "#{libexec}/packages/cli/dist/cli.js" "$@"
    SH
    chmod 0755, bin/"tripwire"
  end

  def post_install
    # Ensure ~/.tripwire/ exists for the daemon's events.db.
    home_tripwire = "#{Dir.home}/.tripwire"
    Dir.mkdir(home_tripwire) unless File.directory?(home_tripwire)
  end

  def caveats
    <<~EOS
      First run:
        tripwire setup

      Start the daemon (autostart on login):
        brew services start tripwire

      Dashboard:
        http://localhost:7878

      To build the macOS menu-bar app (requires Xcode Command Line Tools):
        cd #{opt_libexec}/apps/menubar-macos
        ./scripts/build.sh
        open "dist/Tripwire Menubar.app"
      Drag it to ~/Applications/ if you want it as a login item.

    EOS
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
