# IRONFRONT: Zero Hour

An original modern military first-person shooter, inspired by the genre, built with Three.js and packaged with Electron for PC and Steam. It uses no Activision or Call of Duty names, characters or assets: the factions, weapons, maps and code are all original.

## Play

| How | Command |
|---|---|
| Desktop app (Windows) | double-click **`Play IRONFRONT.bat`** |
| Windows portable build | `npm run dist:portable`, then run `release/win-unpacked/IRONFRONT Zero Hour.exe` |
| Desktop app (any OS) | `npm run game` |
| Browser (dev, hot reload) | `npm run dev`, then open http://localhost:5199 |

Use F11 or Alt+Enter to toggle fullscreen in the desktop app.

The Windows portable package runs without Node.js; keep the complete `win-unpacked` folder together. `npm run verify:release` checks that its game files and assets match the current build. See [PLATFORM_READINESS.md](PLATFORM_READINESS.md) for verified coverage and console port requirements.

### Comfort and usability

- Settings include **Camera Motion** and **Screen Shake** sliders. Set either to zero for a steadier view. Camera Motion controls walking bob, landing dip, roll, and sprint FOV changes; aiming, recoil, and scoped breathing retain their gameplay behavior.
- Disable **Film Grain** and **Chromatic Aberration** independently of bloom and anti-aliasing. **Reduced Menu Motion** stops the backdrop orbit and menu transitions.
- Use Tab to focus menu controls, Enter or Space to activate buttons, and arrow keys to adjust focused sliders. Settings and the field manual stack vertically on smaller screens.
- Matches pause when you switch apps or hide the game tab, including controller play. Hidden tabs skip rendering until you return.
- Respawns favor cover, avoid enemy sightlines and nearby actors, and check for obstructed spawn positions.
- Loading shows progress through asset groups, world building, and shader preparation. Startup failures offer a retry button.

## Features

- **Permanent field assignments:** six selectable career tracks (Assault, Precision, Squad Support, Domination, Hardpoint, and Kill Confirmed), each with five stages. Stages award 1,200–2,800 XP; completing a track unlocks an equippable title. Every track keeps its progress when you switch, with no expiry. Match progress and rewards are committed only at match completion.
- **Match-to-match flow:** Quick Deploy starts a fresh operation; Next Operation rotates through all six competitive modes and alternates maps. Replay the same match or change your loadout from the results screen.
- **Progress feedback:** a compact in-match assignment tracker, assignment progress in pause and results screens, personal-best celebrations tracked separately per mode, five recent match results, and a preview of your next weapon mastery camo.

- **Modes:** Team Deathmatch (6v6), Domination (A/B/C flags), Hardpoint (rotating zone), Kill Confirmed (dog tags), Free-for-All, Gun Game (10-weapon ladder; knife kills set the victim back), and wave-based Survival.
- **Maps:** two woodland battlefields with three connected trails, boulder and fallen-log cover, staging areas and trail signs.
  - **Pine Ridge:** a 220 m pine forest with five combat clearings.
  - **Timber Camp:** a 240 m forest camp with timber cabins, sandbagged positions and a two-storey lookout with roof access.
- **Movement:** sprint, tactical sprint, slide, mantle, crouch and jump. Stairs and the lookout roof are reachable.
- **Weapons:** 10 weapons in total: an assault rifle, an SMG, a pump shotgun, a bolt-action sniper with a scope overlay, a burst rifle, an LMG, a DMR, a pistol, a machine pistol and a rocket launcher.
- **Gunplay:**
  - Recoil and bloom, damage falloff, and headshot and limb multipliers.
  - ADS with real sight alignment.
  - A textured PBR carbine with separate magazine and charging handle, weapon inspection (**I**), and sprint-cancellable reloads.
  - Procedural reload, bolt and pump animations, and shell ejection.
- **Killcam:** after you die, replay the last seconds from your killer's eyes, with their weapon, shots, hitmarkers and explosions. The match-winning kill plays as a Final Killcam. Press SPACE to skip; you can turn it off in Settings.
- **Weapon pickups:** fallen enemies drop their gun. Walk over a matching gun to take its ammo, or hold F (X / □ on a pad) to swap.
- **Kill rewards:**
  - Frag grenades, a combat knife and explosive barrels.
  - Killstreaks: UAV, Precision Airstrike and Sentry Gun. Player rewards repeat every seven kills; unused charges stack and survive death. Press 3 / 4 / 5 to spend one charge. Enemy bots call their own UAVs and airstrikes.
- **AI:**
  - Bots see with a vision cone and line-of-sight checks, and they hear gunfire.
  - They have a reaction time and tracking error, and they strafe, crouch and use A* pathfinding.
  - They throw grenades and play the objective.
  - There are four difficulty tiers.
- **Progression:** XP, 50 levels, weapon and perk unlocks, 12 perks, medals (multi-kills, Longshot, Payback, Buzzkill and more), career stats and 10 achievements.
- **Live service (reasons to come back every day):** all rotations come from the local date, so every player sees the same set on the same day. The code is in `src/core/live.js`.
  - **Daily and weekly challenges:** 3 dailies and 5 weeklies, with one free swap per day. Completing all dailies pays a bonus; completing all weeklies earns a Weekly Veteran calling card. Progress shows in the pause menu, and a pop-up appears mid-match when one completes.
  - **Supply drop:** a 7-day login streak with XP, Double XP tokens, a calling card, and an exclusive camo on day 7. Missing a day restarts the streak.
  - **Daily Operation:** a featured mode, map and mutator each day with +50% XP.
  - **Mutators:** Hardcore, Sniper Duel, Close Quarters, Heavy Metal, Blitz and Headhunter. You can also pick them for custom matches in Deploy.
  - **XP boosts:** Double XP every weekend, Double XP tokens (30 minutes of match time) and a first-win-of-the-day bonus.
  - **Season pass:** a free 50-tier track for each calendar month (October 2026 is Season 1). Season camos, calling cards and titles are generated from the season, so every month brings new rewards.
  - **Weapon mastery:** weapons level up from kills (up to level 20) and unlock camos: Woodland, Desert, Digital, Urban, Tiger, Carbon and Gold. Gold on 5 weapons unlocks Diamond, and Gold on every weapon unlocks Dark Matter. Camos are procedural shaders (`src/game/camo.js`), so they work on every gun model.
  - **Prestige:** at level 50 you can reset to level 1 and keep every unlock, up to Prestige X. Each prestige gives a new rank badge, calling card and title.
  - **Identity:** calling cards and titles from levels, achievements, supply drops, seasons and prestige, equipped in Barracks.
  - **After-action report:** after each match, an XP breakdown, level, season and weapon progress, challenge progress and new unlocks.
- **HUD:** modern weapon cards and slot indicators, tactical sprint availability, reload/chambering progress, elimination confirmations, player health, visible operator health bars, a rotating minimap with UAV radar, a compass with objective markers, a kill feed, hitmarkers, damage direction, a grenade warning and a scoreboard.
- **Controllers:**
  - Xbox and PlayStation pads are detected automatically, with the right button glyphs.
  - Includes aim assist (slowdown, rotational assist and ADS snap), rumble, and menus you can drive entirely with a pad.
- **Real assets:** every model, texture and sound effect is a real CC0 asset; see [CREDITS.md](CREDITS.md).
  - Real-world-style 3D guns with moving magazines, bolts, pumps and slides, plus an RPG-7 launcher.
  - Skinned soldiers with mocap-style locomotion, crouch and death animations, IK hands on the weapon, camo uniforms, plate carriers and helmets.
  - First-person arms in camo sleeves and gloves.
  - Scanned Poly Haven props: fir trees, saplings, ferns, fallen trunks, boulders, hazard drums, military crates, ammo cans and jerrycans. Trees are drawn as crossed cutout cards rendered from the full-detail scan.
  - Recorded gunshots from 10 real firearms, each with near and distant takes, plus real reload, pump, bolt, footstep, impact, explosion and jet recordings.
  - The asset build pipeline is in [tools/](tools/README.md).
- **Rendering:** PBR materials, HDRI sky lighting, cascaded-style follow shadows, bloom, SMAA, chromatic aberration, film grain, particles, tracers, decals and explosion lights.
- **Audio:** positional, using the recorded samples above with reverb and distance filtering. Matches play a recorded wind bed with a distant battle layer; birdsong, UI tones and the generative music score are procedural.

## Shipping it

**PC builds**
```
npm run dist:win     # installer + unpacked folder in release/
npm run dist:linux   # AppImage (also runs on Steam Deck)
npm run dist:mac
```

**Steam:**
1. Steamworks is already wired in through `steamworks.js`, which provides achievements and the overlay.
2. Create your app in Steamworks and put its App ID in `steam_appid.txt`. It is currently 480, Valve's public test app.
3. Add the achievement IDs from `src/core/save.js` (`FIRST_BLOOD`, `WINNER`, …) in the Steamworks dashboard.
4. Upload `release/win-unpacked` as a depot.

**Xbox / PlayStation:** console stores only accept games built with the platform holders' licensed SDKs and dev kits:
- **Xbox:** ID@Xbox and the Microsoft GDK.
- **PlayStation:** PlayStation Partners.

The current Electron game targets desktop systems. No Xbox or PlayStation console package exists. Controller mappings, menu navigation, aim assist, and rumble logic can inform a console port, but the runtime and platform services still need porting and hardware validation. A browser or UWP wrapper is not a verified substitute for a native console build. See [PLATFORM_READINESS.md](PLATFORM_READINESS.md).

## Project layout
```
src/engine   renderer (post-FX), physics (AABB + raycasts), input (KB/M + gamepad), audio (procedural)
src/game     game loop & modes, player, bots, soldier models, weapons, viewmodel, maps, props, nav (A*), effects, killstreaks, killcam, pickups
src/core     save profile, live ops (challenges, season, supply drop), cosmetics + weapon mastery, catalog
src/ui       HUD, menus, progression UI (live-ui.js)
electron/    desktop shell + Steam bridge
public/assets  models (guns, soldier, props), audio, textures, HDRI, fonts
tools/       Blender asset pipeline + raw CC0 sources
```

## Credits
Platform integration: see [PLATFORM_INTEGRATION.md](PLATFORM_INTEGRATION.md) for the shared source interface and the console runtime work still required.

All third-party assets are CC0; the full list with links is in [CREDITS.md](CREDITS.md). The fonts Rajdhani and Black Ops One come from Google Fonts under the SIL Open Font License. Music, UI sounds and optics are generated procedurally in code.

## Deploy and custom classes

The Deploy screen shows the selected map in the live background. Use CHANGE CLASS to choose one of five saved classes, rename it, and browse actual weapon models and perk effects. Changes save automatically and apply on your next spawn during a match. Gun Game keeps its weapon ladder.

New perks: Marathon (level 4), Mountaineer (6), Deep Reserves (3), Grenadier (5), Stalker (2), and Focus (9).



