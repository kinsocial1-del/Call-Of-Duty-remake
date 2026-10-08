# Game-side platform integration

The shared game now routes saves, achievements, controller polling, desktop window actions, and host lifecycle events through `src/core/platform.js`. PC uses the existing browser/Electron services. This prepares shared game code for console integration; it does not supply a licensed console host or make Three.js, DOM, WebGL, or WebAudio run on a console.

## Host contract

Inject `window.ironfrontPlatform` before importing the game entry point:

| Member | Required behavior |
| --- | --- |
| `target` | `xbox`, `playstation`, or `pc`. This is an integration configuration, not a compatibility guarantee. |
| `storage.read(key)` | Promise of the signed-in player's JSON string, or `null` only when no save exists. Reject on read failure. |
| `storage.write(key, value)` | Promise resolving only after an atomic durable save; reject on failure. Preserve the previous valid save if the new write fails. |
| `getGamepads()` | Synchronous array of controllers owned by this session's player, normalized to W3C standard button order and four stick axes. Never return another user's controllers. |
| `onEvent(callback)` | Register lifecycle notifications with objects containing `type`: `suspend`, `resume`, or `user-change`. |
| `unlockAchievement(id)` | Promise activating the corresponding platform achievement for this session's player. Calls must be idempotent. Map the game's IDs to configured platform IDs. |

Storage and achievement calls must remain bound to the identity chosen at launch, even after a system user change. Do not silently retarget them to a new user. The game locks on `user-change` and requires a restart to load the new player's profile. When the previous user's storage is no longer available, reject its writes.

Xbox/PlayStation startup refuses missing storage, controller polling, or lifecycle hooks. Save reads happen before gameplay and progression initialization. Failed or malformed host saves stop startup rather than creating and writing a replacement profile. Missing achievements can remain local, but must be integrated before release.

Controller objects include `id`, `index`, `connected`, `mapping: 'standard'`, `axes`, and `buttons` with `pressed` and `value`. Normalize licensed controller APIs in the host. Optional `vibrationActuator.playEffect('dual-rumble', options)` and `reset()` implement haptics; unsupported haptics must fail safely. Standard mappings and glyphs are already covered by automated tests.

## Save and lifecycle behavior

- Writes are serialized and pending changes are coalesced to the newest profile. Failed snapshots remain in memory; settings includes RETRY SAVE. They cannot survive a process termination without a successful durable host write.
- The browser path still saves synchronously to its original profile key, preserving existing PC profiles.
- Earned achievements are mirrored again on launch so an offline platform error can recover later.
- Suspend pauses an active match, closes the buy station, clears input, stops haptics, suspends audio, and requests a save. Resume never automatically resumes gameplay; the player chooses Resume.
- The host must await `platform.flush()` through its integration before completing a permitted suspend/shutdown save window. Sending an event alone cannot guarantee a durable asynchronous write before the OS terminates the process. Apply the licensed platform's lifecycle deadlines.
- New console profiles use platform-specific button prompts and a 3% of minimum viewport dimension HUD inset. Existing saved choices are preserved. Console menus omit desktop Quit and Fullscreen controls, and controller-only play does not request mouse pointer lock.

## Remaining console work

Choose and implement an approved console runtime. Port or replace the browser-based rendering, UI, asset loading, and audio layer as required by that runtime, then connect this contract to licensed platform APIs. Implement platform-specific identity selection, save conflict/recovery UI, achievement setup, haptics, system dialogs, and any other requirements from the current licensed documentation. A platform bridge alone does not solve the runtime port.

After integration, verify every mode, map, menu, save failure, user change, suspend/resume, controller disconnect, TV display, and long play session on actual target hardware. Hardware performance and platform compliance remain unverified until that work is complete. See `PLATFORM_READINESS.md` for the acceptance checks.

This source preparation does not create, update, or certify a release package.
