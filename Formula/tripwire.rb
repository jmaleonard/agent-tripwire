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

    system "pnpm", "install", "--frozen-lockfile"
    system "pnpm", "build"

    libexec.install Dir["*"]

    (bin/"tripwire").write <<~SH
      #!/bin/bash
      exec "#{Formula["node@22"].opt_bin}/node" "#{libexec}/packages/cli/dist/cli.js" "$@"
    SH
    chmod 0755, bin/"tripwire"

    # Swift menubar app: build it if Swift is available, place it under
    # the formula's prefix. Users drag it into ~/Applications/ themselves.
    if which("swift")
      cd libexec/"apps/menubar-macos" do
        system "./scripts/build.sh"
      end
      prefix.install libexec/"apps/menubar-macos/dist/Tripwire Menubar.app"
    else
      opoo "Swift not found; skipping the menubar app build. Install Xcode Command Line Tools and re-brew to get it."
    end
  end

  def post_install
    # Ensure ~/.tripwire/ exists for the daemon's events.db.
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
        macOS menu-bar app:
          open "#{prefix}/Tripwire Menubar.app"
        Drag it to ~/Applications/ if you want it as a login item.

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
