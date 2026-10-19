# Ring Link

Online co-op for the Retro Engine Sonic games. The original game scripts run unchanged on a TypeScript port of the
engine; co-op is a small set of script patches. No game data is included: you supply your own game files.

## Running

1. Copy your game files (see below) into this folder, next to `compose.yaml`.
2. `cp .env.example .env` (optional) and `docker compose up -d --build`.
3. Open `http://localhost:8080`.

On every start the `extract` service identifies the files by their content, so any file names work, and extracts
whatever is missing or out of date into `DATA_PATH` (`./data` by default). To see what was found:
`npm run detect -- .`

All game files are ignored by git and Docker (`*.rsdk`, `*.xmf`, `*.acb`, `*.awb`, `*.apk`, `*.apks`, `*.xapk`,
`*.ipa`, `*.zip`), so they are never committed or copied into an image.

## Game files

Each game can come from either its mobile release or from Sonic Origins. If both are present, the mobile release is
used. App packages (`.apk`, `.ipa`, `.xapk`) can be copied in whole: the data packs are read straight out of them.

| Game               | Status                     | Mobile release                         | Sonic Origins                                               |
| ------------------ | -------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| Sonic 1            | Playable                   | Data pack (audio included)             | `Sonic1u.rsdk` + `STH1_music.acb`, `STH1_music.awb`, `STH1_sfx.acb` |
| Sonic 2            | Playable                   | Data pack (audio included)             | `Sonic2u.rsdk` + `STH2_music.acb`, `STH2_music.awb`, `STH2_sfx.acb`, `STH1_music.acb`, `STH1_music.awb` |
| Sonic CD           | Playable co-op             | Detected, not extracted yet            | `SonicCDu.rsdk` + `SCD_music.acb`, `SCD_music.awb`, `SCD_sfx.acb` |
| Sonic 3 & Knuckles | Experimental (see below)   | –                                      | `Sonic3ku.rsdk` (+ `Music03_S3K.acb`, `Music03_S3K.awb`, `STH3_sfx.acb`) |

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
so the Origins pack holds only assets and Sonic 3 is not playable with its original game logic. The current Sonic 3
mode is an experiment.

### Sonic CD

Sonic CD runs on RSDKv3, ported in `packages/engine/src/v3/` from the
[RSDKv3 decompilation](https://github.com/RSDKModding/RSDKv3-Decompilation) and driven by the
[decompiled scripts](https://github.com/RSDKModding/RSDKv3-Script-Decompilation) (fetched during extraction). It
matches the original engine frame for frame on every stage (checked with `tools/dev/trace-soniccd.ts` against a build
of the decompilation).

- Use the Origins pack. The 2011 mobile and Steam packs are recognised but their file encryption is not implemented.
- Sonic CD supports two-player online co-op: each player controls Sonic or Tails in the same world. Knuckles and Amy
  are only spawned by the scripts' Origins-runtime code, which this project doesn't provide.
