# Platform readiness

The playable build in this repository is a Windows desktop game. Xbox and PlayStation controllers on PC are supported through the browser's standard gamepad mapping. Controller support does not create a console executable.

## Shared source preparation

The game now exposes a platform interface for player-bound asynchronous saves, controller polling, achievement synchronization, and suspend/user-change notifications. It preserves failed saves for retry, blocks gameplay after a user change, and provides console prompt/HUD defaults. The integration contract and remaining runtime work are documented in [PLATFORM_INTEGRATION.md](PLATFORM_INTEGRATION.md).

These source changes were tested without generating new builds. Existing packages do not contain these latest changes. Xbox and PlayStation are prepared for further integration, not verified playable console releases.

## Windows PC

Build: `npm run dist:portable`. Verify the complete package with `npm run verify:release`.

Launch `release/win-unpacked/IRONFRONT Zero Hour.exe`, or double-click `Play IRONFRONT.bat`. Keep the entire `win-unpacked` folder together: the executable depends on its resources, libraries, and locales. Players of this package do not need Node.js. The portable package is unsigned; it is a local playable build, not a signed store release.

Verified in this work:

- Production web build and Windows portable packaging.
- Packaged game opens and renders the world, main menu, and settings on this Windows machine; a Dockyard Team Deathmatch launches with the weapon, health, objective, minimap, and assignment HUD.
- Automated movement, combat, progression, controller mapping, reconnection, menu-repeat, and asset path tests.

Not yet verified:

- Physical Xbox controller and DualSense/DualShock tests, including USB/Bluetooth and vibration.
- Complete-match playtests for every mode on both maps.
- Performance, sound, suspend/resume, and saves across a representative range of PCs.
- A signed installer, Steam release configuration, or platform certification.

Standalone packaged builds do not initialize Steam with the sample Spacewar app ID 480. Configure the game's real app ID before preparing a Steam release.

## Xbox console

Status: blocked by missing console developer access, SDK, and development hardware. No Xbox console executable has been produced.

The official Xbox console toolchain requires the Microsoft Game Development Kit with Xbox Extensions (GDKX). The Electron desktop application cannot be submitted as a console build. A console port must implement or replace the current Chromium/WebGL runtime with an approved console runtime, and integrate console input, user identity, save storage, achievements, lifecycle, packaging, and platform requirements.

References: [Microsoft's public GDK repository](https://github.com/microsoft/GDK), [Xbox development resources](https://developer.microsoft.com/en-us/games/resources/).

## PlayStation console

Status: blocked by missing approved partner access, SDK, and development hardware. No PlayStation console executable has been produced.

Join PlayStation Partners and obtain the applicable licensed SDK, documentation, and development hardware. Select an approved console runtime, port the rendering and platform services, build with the licensed toolchain, and validate on hardware. Electron's Windows package is not a PlayStation application.

Reference: [PlayStation Partners](https://partners.playstation.net/).

## Acceptance checks before calling a platform ready

On each actual target device:

1. Install, cold launch, finish a match, replay, change maps, quit, and relaunch.
2. Test every mode on both maps; verify results, assignments, XP, unlocks, and saved loadouts.
3. Use that platform's controller for every menu and action. Test hot-plug, battery loss, reconnect, and button prompts; disconnect must pause without losing progress or resuming automatically.
4. Test suspend/resume, focus loss, user changes where supported, storage failures, and save recovery.
5. Check HUD safe area on TVs, small text, frame pacing, sound, accessibility settings, and long-session stability.
6. Produce the target's actual application package and pass its applicable release checks. Record hardware, build version, measured results, and unresolved issues.

Do not mark Xbox or PlayStation ready based on simulated controller tests, a browser page, or a PC executable.
