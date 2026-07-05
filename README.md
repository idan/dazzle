# dazzle

An internet-connected **64×64 HUB75 LED pixel display**.

## Layout (monorepo)

- **[`firmware/`](firmware/)** — the device: Raspberry Pi Pico 2 W (RP2350), Rust (embassy-rp,
  `no_std`). Drives the Waveshare P3 64×64 HUB75 panel and handles first-run Wi-Fi onboarding over
  BLE. Docs live in [`firmware/docs/`](firmware/docs/). *(Ported from the original ESP32-C6, preserved
  at git tag `esp32-final` — see [firmware/docs/pico-port.md](firmware/docs/pico-port.md).)*
- **[`web/`](web/)** — cloud backend + web UI: Svelte 5 / SvelteKit on Cloudflare, tooled with Bun.
  Currently a procedural scene editor / simulator spike; also hosts `web/improv-test/`, a Web
  Bluetooth provisioning test client. See [web/README.md](web/README.md).
- **[`renderer/`](renderer/)** — the shared scene renderer (Rust shader-bytecode VM), compiled to
  wasm32 for the web preview and wired into the firmware. See [renderer/README.md](renderer/README.md).

## Quick start

**Firmware** (run from `firmware/`):

```sh
cd firmware
cargo run        # build, flash over USB, open the serial monitor
```

On first boot the panel shows **SETUP**; provision Wi-Fi from **Chrome on Android / Windows / Linux /
macOS** at <https://www.improv-wifi.com/ble/> → pick `dazzle`. (macOS works too now — see
[firmware/docs/gotchas.md](firmware/docs/gotchas.md); a stale `improv-wifi.com` cache can still fail,
so `web/improv-test/` is the known-good client.) Hold **BOOTSEL ~3 s** to factory-reset.

**Web** (run from `web/`):

```sh
cd web
bun run dev
```

## Docs

- [CLAUDE.md](CLAUDE.md) — project orientation (state, constraints, where things are).
- [firmware/docs/](firmware/docs/) — wiring, firmware architecture, performance, Wi-Fi onboarding,
  and a **gotchas / debugging** doc worth reading before diving in.
