Webfox now ships a Nix flake for Linux and Apple Silicon macOS. Install the web CLI declaratively with Home Manager or nix-darwin, or run it directly with Nix.

## 🚀 Features

### Homebrew installation for the web command

You can now install the `web` command with Homebrew on macOS and Linux:

```sh
brew install mavam/tap/webfox
```

Homebrew manages Node.js and the command's dependencies. The npm installation option remains available. To use Webfox in Pi, install the extension separately with `pi install npm:webfox`; this doesn't add `web` to your shell's `PATH`. The CLI and Pi extension share the same Webfox configuration.

*By @mavam in #47.*

### Install Webfox with Nix

Webfox now provides a Nix flake for Linux and macOS, including the `web` CLI and its Node.js runtime. Run it with `nix run github:mavam/webfox`, add it to Home Manager or nix-darwin, or use the overlay to install `pkgs.webfox`.

*By @mavam.*
