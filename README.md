# Ring Link

Online co-op for the Retro Engine Sonic games. The original game scripts run unchanged on a TypeScript port of the
engine; co-op is a small set of script patches. No game data is included: you supply your own game files.

## Running

1. Copy your game files (see below) directly into `game-files/` (no subfolders).
2. `cp .env.example .env` (optional) and `docker compose up -d --build`.
3. Open `http://localhost:8080`.

The `game-files/` folder is included in the repository via a placeholder; all user-added contents are ignored by Git
and excluded from Docker build contexts. Docker mounts the originals read-only: extraction never modifies or deletes
them. Generated packs and audio go into the separate `DATA_PATH` (`./data` by default).
Extraction tools and npm dependencies are installed into the extraction image at build time; host workspace
dependency folders are neither mounted nor modified.
The extraction image trusts only its two script-cache repositories under `/app/data/cache` when their ownership
differs from the container user; no host Git configuration or file ownership changes are needed.

`docker compose up -d --build` runs the `extract` service before starting the server. It identifies games by content,
so any file names work, and processes new or changed source files, missing packs, and updated co-op patches.
Source-content checks also detect replacements that retain an older file timestamp.
`docker compose build` alone only builds images; use `up -d --build` to run extraction as well.
To see what was found: `docker compose run --rm extract npx tsx tools/rsdk-detect.ts /app/game-files`.

If upgrading an existing installation, move the original RSDK/app packages and audio files from the project root
into `game-files/`, keeping their filenames. Leave the generated `data/` folder where it is.
To force a Sonic CD refresh on a Docker deployment, run:

```sh
docker compose stop server client
docker compose run --rm extract npx tsx tools/extract.ts --out data --game soniccd
docker compose up -d --build
```

Restarting the server reloads its cached game data. Refresh both players' browsers after updating the client.
The client revalidates the manifest at each game start and versions pack downloads by extraction date, so a
re-extracted pack does not reuse the browser's older cached scripts.
The manifests at `/data/<game>/manifest.json` should report the current co-op patch counts in `scripts.patches`:
30 for Sonic 1, 35 for Sonic 2 and 24 for Sonic CD.

The existing global Git/Docker exclusions for game-file extensions also remain in place as a safeguard for files
accidentally left outside `game-files/`.

## Playing together

Each player has their own screen, character, rings and HUD; the world, enemies and bosses are shared.

- **Regroup** (the button in the game bar, `T`, or gamepad Y): every player well behind the one furthest ahead is
  brought to them. It is checked and applied by the server; if it can't be used right now (title card, everyone is
  already together, cooldown of 3 seconds) the player is told why.
- **Bosses** hold everyone in their arena. A boss's screen lock applies to every player's screen, a player who is
  outside the arena (behind, or already past it) is brought to a partner inside it, and nobody can leave until the
  boss is beaten. The boss's own edge checks use the arena, whichever screen it is drawn on.
- **Lives** are infinite by default (the HUD shows ∞). A player who dies comes back at the last checkpoint (or the
  start of the act) without restarting the act for their partner; if that checkpoint is outside a boss arena they come
  back next to their partner instead.

### Playing on a phone or tablet

Phones and tablets get on-screen controls during play: put your thumb anywhere on the left half of the screen for a
stick (it centres where you touch; down + jump is a spin dash), A and B on the right both jump, and Regroup and the menu
(☰: mute, scaling, fullscreen, leave) sit along the top. Several fingers work at once. The first touch turns the sound
on and, where the browser allows it (Android Chrome), goes fullscreen in landscape. The screen is kept awake while you
play. On iPhone, Safari can't go fullscreen from a web page: use Share → Add to Home Screen and start it from there.
A touchscreen laptop gets the controls the first time its screen is touched.

### Lobby artwork

The game covers, character portraits and level previews in the lobby are rendered by the engine from your own game
data when the `extract` service runs (`tools/extract-ui.ts`, about a minute): each game's title screen (with its
attract-mode gameplay on hover), each character standing in the first act, and every level just after its title card.
They are written to `data/ui/` and re-rendered whenever a pack is re-extracted. Without them the lobby shows text cards.

### Host options

The host picks these in the lobby; everyone sees them. Not every game offers every option.

| Option              | Sonic 1 | Sonic 2 | Sonic CD | Notes                                                        |
|---------------------|---------|---------|----------|--------------------------------------------------------------|
| Infinite lives      | yes     | yes     | yes      | Off: the original lives (a player can borrow one from a partner) |
| Respawn             | yes     | yes     | –        | At the last checkpoint, or next to your partner              |
| Spin dash           | yes     | –       | –        | Sonic 1 originally had none                                  |
| Tails can fly       | yes     | yes     | yes      |                                                              |
| Knuckles can climb  | yes     | yes     | –        | Off: he drops off walls he glides into                       |
| Super peel out      | –       | –       | yes      | Off: up + jump is an ordinary jump (Sonic 1 and 2 have none) |
| Chat                | yes     | yes     | yes      | On by default; see below                                     |

### Chat

When there are two players in the room, the lobby shows a chat panel, and in game `Y` (or the Chat button in the game
bar, or the ☰ menu on a phone) opens a message box over the game: `Enter` sends, `Esc` closes. While it is open your
character stands still. New messages show over the game for a few seconds; the room keeps the last 30, so a player who
joins or reconnects sees the conversation so far. Messages are plain text of up to 120 characters, and a player can send
at most 5 in 5 seconds. The host can turn chat off in the lobby's options.

Characters: Sonic and Tails everywhere; Knuckles in Sonic 1 and 2. Each player uses their own character's physics.
Not available yet: Knuckles and Amy in Sonic CD and Amy in Sonic 1 and 2 (their code exists only in the scripts'
Origins-runtime branches, which would need their own co-op patches), and more than two players (the scripts are built
around one player 1 and one player 2 object).

## Game files

Each game can come from either its mobile release or from Sonic Origins. If both are present, the mobile release is
used. App packages (`.apk`, `.ipa`, `.xapk`) can be copied in whole: the data packs are read straight out of them.

| Game               | Status                     | Mobile release                         | Sonic Origins                                               |
| ------------------ | -------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| Sonic 1            | Playable                   | Data pack (audio included)             | `Sonic1u.rsdk` + `STH1_music.acb`, `STH1_music.awb`, `STH1_sfx.acb` |
| Sonic 2            | Playable                   | Data pack (audio included)             | `Sonic2u.rsdk` + `STH2_music.acb`, `STH2_music.awb`, `STH2_sfx.acb`, `STH1_music.acb`, `STH1_music.awb` |
| Sonic CD           | Playable co-op             | Detected, not extracted yet            | `SonicCDu.rsdk` + `SCD_music.acb`, `SCD_music.awb`, `SCD_sfx.acb` |
| Sonic 3 & Knuckles | Disabled (see below)       | –                                      | `Sonic3ku.rsdk` (+ `Music03_S3K.acb`, `Music03_S3K.awb`, `STH3_sfx.acb`) |

Optional for Origins: `HITE_sfx.acb`, the SEGA logo chime shared by Sonic 1, 2 and CD.

Sonic 2 needs Sonic 1's music pack as well because Origins plays the 1-Up, drowning and Chaos Emerald jingles of both
games from it.

### Mobile releases

These releases are delisted, but can be downloaded again from your store's purchase history.

- **Sonic 1 / Sonic 2 (Android):** the app's APK. The data pack is `assets/Data.rsdk.xmf` inside it, which can also be
  copied out on its own.
- **Sonic 1 / Sonic 2 (iOS):** the `.ipa`, or the data packs from the app bundle (`Sonic 1 US.app` or
  `Sonic 2 iOS US.app`): `Data.rsdk` is Sonic 2 and `DataSonic1.rsdk` is Sonic 1.
- **Sonic CD (Android):** `split_packs.apk` from `/data/app/com.sega.soniccd.classic…/`, or `assets/Data.rsdk.xmf`
  from inside it.
- **Sonic CD (iOS):** the `.ipa`, or `Sonic CD iOS.app/Data.rsdk` from the app bundle.
- **Sonic CD (Steam, 2011):** `Data.rsdk` in the game's install folder.

Mobile and 2011 data packs contain the music and sound effects.

### Sonic Origins

Sonic Origins keeps the data packs and the audio separately. Find the install folder through Steam (right-click
Sonic Origins → Manage → Browse local files) or the Epic Games Launcher (Manage → Open Install Location).

- **Data packs** (`Sonic1u.rsdk`, `Sonic2u.rsdk`, `SonicCDu.rsdk`, `Sonic3ku.rsdk`) are in `image\x64\raw\retro\`,
  for example `D:\SteamLibrary\steamapps\common\SonicOrigins\image\x64\raw\retro\`.
- **Audio packs** (`.acb` / `.awb`, listed in the table above) are elsewhere in the same install. They contain all of
  the music and sound effects; the Origins data packs contain none. To list them in PowerShell:

  ```powershell
  Get-ChildItem "<install folder>" -Recurse -Include *.acb,*.awb | Select-Object FullName, Length
  ```

  Copy each `.awb` along with the `.acb` of the same name. The audio is decoded with ffmpeg, which the `extract`
  service's image includes (`npm run extract` outside Docker needs ffmpeg installed). Origins music keeps its own
  loop points.

How Origins maps its audio to the files the game scripts ask for comes from the
[RSDK Modding wiki](https://rsdkmodding.com/Games/SonicOrigins/Documentation/Audio/), stored in
`games/origins-audio.json` (regenerate with `npx tsx tools/origins-audio-map.ts`).

### Sonic 3 & Knuckles

`Sonic3ku.rsdk` is an RSDKv5 pack. RSDKv5 games keep their game logic in native code rather than in the data pack,
so the Origins pack holds only assets and Sonic 3 is not playable with its original game logic. The experimental Sonic 3
mode is therefore not offered in the lobby; set `ENABLE_SONIC3=1` for the server to bring it back.

### Sonic CD

Sonic CD runs on RSDKv3, ported in `packages/engine/src/v3/` from the
[RSDKv3 decompilation](https://github.com/RSDKModding/RSDKv3-Decompilation) and driven by the
[decompiled scripts](https://github.com/RSDKModding/RSDKv3-Script-Decompilation) (fetched during extraction). It
matches the original engine frame for frame on every stage (checked with `tools/dev/trace-soniccd.ts` against a build
of the decompilation).

- Use the Origins pack. The 2011 mobile and Steam packs are recognised but their file encryption is not implemented.
- Sonic CD supports two-player online co-op: each player controls Sonic or Tails in the same world. Knuckles and Amy
  are only spawned by the scripts' Origins-runtime code, which this project doesn't provide.
- Music restarts at full volume whenever a track starts, as the original's music loader does (a signpost's fade-out no
  longer leaves the next act silent).
- In co-op, death and drowning respawn that player at the most recently activated shared checkpoint, or the stage's
  start before a checkpoint is reached. Their camera resets there without restarting the partner's game.
- Ramp camera limits and controls, and tube contact/exit state, are independent for each co-op player. Either player
  can activate the goal sign and start the shared act-finish sequence.
