# File Reference Guide

Quick reference for all files in the DMX Dashboard application.

## Documentation Files

| File | Purpose |
|------|---------|
| [README.md](README.md) | Main documentation - features, installation, usage |
| [QUICKSTART.md](QUICKSTART.md) | Quick start guide for end users |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment checklist and configuration guide |
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | Technical architecture and developer documentation |
| [FILE_REFERENCE.md](FILE_REFERENCE.md) | This file - quick reference for all files |

## Scripts (Windows)

| File | Purpose | When to Use |
|------|---------|-------------|
| [install.bat](install.bat) | Install all dependencies and build | First time setup |
| [start.bat](start.bat) | Start the application in production mode | Normal daily use |
| [dev.bat](dev.bat) | Start in development mode with hot reload | Development only |
| [verify.bat](verify.bat) | Verify installation is complete | Troubleshooting |

## Server Files (Backend)

### Core Server
| File | Purpose | Key Features |
|------|---------|--------------|
| [server/server.js](server/server.js) | Main Express + WebSocket server | HTTP API, WebSocket, serves React app |

### Modules
| File | Purpose | Key Exports |
|------|---------|--------------|
| [server/config.js](server/config.js) | Configuration management | load(), save(), update(), reset(), import/export |
| [server/state.js](server/state.js) | Real-time state management | get(), update(), addListener() |
| [server/dmxEngine.js](server/dmxEngine.js) | DMX computation and blending | computeOutput(), getUniverse() |
| [server/outputEngine.js](server/outputEngine.js) | Network DMX output (sACN/Art-Net) | start(), stop(), sendFrame() |

### Generated Files
| File | Purpose | Notes |
|------|---------|-------|
| server/config.json | Persistent configuration storage | Created on first run, can be edited |

## Client Files (Frontend)

### React Entry Points
| File | Purpose |
|------|---------|
| [client/src/index.js](client/src/index.js) | React app entry point |
| [client/src/App.js](client/src/App.js) | Main app component with routing |

### Pages
| File | Purpose | Route |
|------|---------|-------|
| [client/src/pages/MainPage.js](client/src/pages/MainPage.js) | Main control interface | `/` |
| [client/src/pages/SettingsPage.js](client/src/pages/SettingsPage.js) | Configuration interface | `/settings` |

### Components
| File | Purpose |
|------|---------|
| [client/src/components/Slider.js](client/src/components/Slider.js) | Reusable slider component |

### Hooks
| File | Purpose |
|------|---------|
| [client/src/hooks/useWebSocket.js](client/src/hooks/useWebSocket.js) | WebSocket connection management |

### Styles
| File | Purpose |
|------|---------|
| [client/src/index.css](client/src/index.css) | Global styles and reset |
| [client/src/App.css](client/src/App.css) | Component styles |

### HTML Template
| File | Purpose |
|------|---------|
| [client/public/index.html](client/public/index.html) | HTML template for React app |

## Configuration Files

| File | Purpose |
|------|---------|
| [package.json](package.json) | Server dependencies and scripts |
| [client/package.json](client/package.json) | React app dependencies and scripts |
| [.gitignore](.gitignore) | Git ignore rules |

## Quick File Location Guide

**Need to modify...**

- Server port? → `server/server.js` (line ~13)
- Default DMX addresses? → `server/config.js` (DEFAULT_CONFIG)
- UI colors/styles? → `client/src/App.css`
- Look blending algorithm? → `server/dmxEngine.js` (computeOutput function)
- Network protocols? → `server/outputEngine.js`
- WebSocket behavior? → `client/src/hooks/useWebSocket.js`
- Main control layout? → `client/src/pages/MainPage.js`
- Settings page layout? → `client/src/pages/SettingsPage.js`

## File Dependencies

```
server.js
  ├── config.js
  ├── state.js
  └── outputEngine.js
      ├── config.js
      ├── state.js
      └── dmxEngine.js
          ├── config.js
          └── state.js

App.js
  ├── MainPage.js
  │   ├── useWebSocket.js
  │   └── Slider.js
  └── SettingsPage.js
```

## Common Modifications

### Change Server Port
File: `server/server.js`
```javascript
const PORT = process.env.PORT || 3001; // Change 3001 to desired port
```

### Add a New Look
File: `server/config.js` → DEFAULT_CONFIG.looks array
```javascript
{
  id: 'look4',
  name: 'Your Look Name',
  targets: {
    panel1: { hue: 0, brightness: 0 },
    panel2: { hue: 0, brightness: 0 },
    par1: { intensity: 0 },
    par2: { intensity: 0 }
  }
}
```

### Modify DMX Output Rate
File: `server/config.js` → DEFAULT_CONFIG.network.outputFps
```javascript
outputFps: 30 // Change to desired FPS (10-60 recommended)
```

### Change UI Colors
File: `client/src/App.css`
```css
.slider::-webkit-slider-thumb {
  background: #4a90e2; /* Change to desired color */
}
```

## Build Output

| Location | Purpose |
|----------|---------|
| client/build/ | Production React build (created by npm run build) |
| node_modules/ | Server dependencies (created by npm install) |
| client/node_modules/ | Client dependencies (created by npm install) |

## Total File Count

- **Documentation**: 5 files
- **Scripts**: 4 files
- **Server code**: 5 files (.js)
- **Client code**: 9 files (.js, .jsx, .css, .html)
- **Configuration**: 3 files (.json, .gitignore)

**Total**: 26 core project files
