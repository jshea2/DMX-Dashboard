# DMX Dashboard
#### A desktop dashboard for controlling DMX fixtures with Looks, live overrides, and HTP blending

![DMX Dashboard](https://user-images.githubusercontent.com/70780576/109406368-3c793e00-792d-11eb-90f0-bca884b79e80.png)

## Download

- [Download DMX Dashboard](../../releases)

## What It Does

- Build fixture profiles and patch channels fast
- Control fixtures from dashboards or fixture detail pages
- Create Looks and blend them with live overrides (HTP)
- Output to sACN or Art-Net

## Install

- macOS: open the `.dmg` and drag **DMX Dashboard** to Applications
- Windows: run the `.exe` installer
- Linux: run the `.AppImage` (mark executable if needed)

## Quick Start

1. Open **Settings**
2. Create or edit Fixture Profiles
3. Patch fixtures (universe + start address)
4. Build your Dashboard layout
5. Save Looks and start controlling

## Network Setup

- Choose sACN or Art-Net in **Settings → Network**
- Set your bind address if you need a specific interface
- Default server port is `3000`

## Looks + Overrides (HTP)

- Looks blend from default values to saved targets
- If you move a slider while a look is active, it goes into override
- Use **Clear** to release overrides and return to active Looks

## Files & Config

- Configuration is stored on disk and saved automatically
- On macOS it lives in your app data folder:
  `~/Library/Application Support/DMX Dashboard/config.json`

## Troubleshooting

- **No output?** Check network protocol, universe, and bind address
- **Wrong fixture response?** Verify profile channel order + patch address
- **Can’t connect?** Make sure the server port isn’t blocked by firewall

## Build From Source

```
npm install
npm run electron:build
```

## License

Internal use for DMX Dashboard. Not for redistribution.
