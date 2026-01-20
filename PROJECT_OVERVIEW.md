# DMX Dashboard - Project Overview

## Architecture

### Technology Stack

**Backend:**
- Node.js with Express
- WebSocket (ws library) for real-time communication
- e131 library for sACN output
- Custom Art-Net implementation

**Frontend:**
- React 18
- React Router for navigation
- Native WebSocket API
- CSS3 for responsive design

**Protocols:**
- sACN (E1.31) - Streaming ACN for DMX over IP
- Art-Net - Alternative DMX over IP protocol

## Application Structure

```
DMX Dashboard/
├── server/
│   ├── server.js          # Express + WebSocket server
│   ├── config.js          # Configuration management
│   ├── state.js           # Real-time state management
│   ├── dmxEngine.js       # DMX computation and blending
│   ├── outputEngine.js    # sACN/Art-Net output
│   └── config.json        # Persistent configuration (created at runtime)
│
├── client/
│   ├── public/
│   │   └── index.html     # HTML template
│   ├── src/
│   │   ├── components/
│   │   │   └── Slider.js  # Reusable slider component
│   │   ├── hooks/
│   │   │   └── useWebSocket.js  # WebSocket connection hook
│   │   ├── pages/
│   │   │   ├── MainPage.js      # Control interface
│   │   │   └── SettingsPage.js  # Configuration interface
│   │   ├── App.js         # Main app component
│   │   ├── App.css        # Styles
│   │   └── index.js       # React entry point
│   └── package.json       # Client dependencies
│
├── package.json           # Server dependencies
├── start.bat             # Production startup script
├── install.bat           # Installation script
├── dev.bat               # Development mode script
├── README.md             # Main documentation
├── QUICKSTART.md         # Quick start guide
└── DEPLOYMENT.md         # Deployment checklist
```

## Data Flow

### Real-Time Control Flow

1. User moves slider on phone/tablet
2. React component updates local state
3. WebSocket sends update to server
4. Server updates shared state
5. Server broadcasts new state to all connected clients
6. DMX engine computes blended output
7. Output engine sends DMX data at configured FPS

### Configuration Flow

1. User modifies settings in Settings page
2. Client sends HTTP POST to `/api/config`
3. Server validates and saves to `config.json`
4. Output engine restarts with new configuration
5. Client receives confirmation

## Key Components

### server/config.js
- Manages persistent configuration
- Loads/saves JSON file
- Provides export/import functionality
- Default configuration template

### server/state.js
- Maintains real-time lighting state
- Observer pattern for state changes
- Manages looks levels and fixture values

### server/dmxEngine.js
- Computes final DMX values
- **Blending Algorithm:**
  - Converts hue+brightness to RGB
  - Blends multiple looks using vector addition (for hue) and intensity addition
  - Clamps values to DMX range (0-255)
- Manages 512-slot DMX buffers per universe

### server/outputEngine.js
- Handles network output
- sACN multicast/unicast
- Art-Net broadcast/unicast
- Configurable frame rate (default 30 FPS)

### client/hooks/useWebSocket.js
- WebSocket connection management
- Auto-reconnection on disconnect
- State synchronization
- Update throttling

## Blending Algorithm Details

### RGB Fixtures (Panels)

The system uses a sophisticated color blending approach:

1. **Individual Control**: Base hue and brightness from manual sliders
2. **Look Contributions**: Each active look adds its target values
3. **Hue Blending**:
   - Converts hues to 2D vectors (polar to cartesian)
   - Weights by brightness and look level
   - Averages vectors and converts back to hue
4. **Brightness Blending**: Simple additive blending
5. **RGB Conversion**: HSV to RGB with full saturation
6. **DMX Output**: RGB values scaled and clamped to 0-255

### Intensity Fixtures (PARs)

1. **Individual Control**: Base intensity from manual slider
2. **Look Contributions**: Additive blending of look targets
3. **DMX Output**: Percentage scaled to 0-255 and clamped

### Example:
```
Look 1 at 50%: Panel 1 = Hue 30°, Brightness 75%
Look 2 at 30%: Panel 1 = Hue 200°, Brightness 70%
Individual: Panel 1 = Hue 0°, Brightness 0%

Result: Blended output considering all three inputs
```

## Network Protocols

### sACN (E1.31)
- Industry-standard streaming ACN
- Multicast: 239.255.0.x where x = universe number
- Unicast: Direct to specified IP addresses
- Priority levels: 0-200 (default 100)
- Refresh rate: User configurable

### Art-Net
- Widely supported alternative
- UDP port 6454
- Net/Subnet/Universe addressing
- Broadcast or unicast modes
- Packet format: Art-Net v14

## API Endpoints

### State Management
- `GET /api/state` - Get current state
- `POST /api/state` - Update state

### Configuration
- `GET /api/config` - Get configuration
- `POST /api/config` - Update configuration
- `POST /api/config/reset` - Reset to defaults
- `GET /api/config/export` - Export as JSON
- `POST /api/config/import` - Import from JSON

### Looks
- `POST /api/looks/:lookId/capture` - Capture current state to look

## WebSocket Messages

### From Server
```json
{
  "type": "state",
  "data": {
    "blackout": false,
    "looks": { "look1": 0.5, "look2": 0, "look3": 0.75 },
    "fixtures": {
      "panel1": { "hue": 180, "brightness": 80 },
      "panel2": { "hue": 240, "brightness": 60 },
      "par1": { "intensity": 50 },
      "par2": { "intensity": 75 }
    }
  }
}
```

### From Client
```json
{
  "type": "update",
  "data": {
    "looks": { "look1": 0.5 }
  }
}
```

## Performance Considerations

- **WebSocket**: Minimal latency for control updates
- **DMX Output**: Runs on interval timer (30 FPS default)
- **React**: State updates throttled by WebSocket send rate
- **Network**: UDP for DMX (no TCP overhead)

## Security Considerations

- Local network only (no internet exposure)
- Optional password protection for Settings (configurable)
- No authentication required for control (faculty use case)
- Config file on disk (ensure appropriate file permissions)

## Browser Compatibility

Tested on:
- Chrome/Edge (desktop and mobile)
- Safari (iOS)
- Firefox (desktop)

Requirements:
- WebSocket support
- Modern JavaScript (ES6+)
- CSS Grid and Flexbox

## Future Enhancement Ideas

- [ ] Multiple pages of looks (pagination)
- [ ] Effects (color chase, fade, strobe)
- [ ] Timecode/timeline integration
- [ ] MIDI control support
- [ ] Multiple user permissions
- [ ] Show recording/playback
- [ ] Scene snapshots
- [ ] Grand master fader
- [ ] Color picker UI for RGB fixtures
- [ ] Preset library sharing
- [ ] Mobile app wrapper (React Native)
- [ ] DMX input monitoring
- [ ] Network diagnostics page
- [ ] Fixture groups

## Known Limitations

- No sub-millisecond timing (limited by network and JavaScript)
- RGB fixtures use full saturation (no white point)
- Look blending is additive (can exceed 100%)
- Single universe optimization (multi-universe works but uses separate buffers)
- No DMX input (output only)
- No fixture patching conflict resolution (warns but allows)

## Development

### Running in Development Mode

```bash
npm run dev
```

This starts:
- React dev server on port 3000 (with hot reload)
- Express API server on port 3001
- WebSocket server on port 3001

### Building for Production

```bash
cd client
npm run build
cd ..
node server/server.js
```

Or use `install.bat` and `start.bat` on Windows.

## Testing Checklist

- [ ] WebSocket connection/reconnection
- [ ] All sliders update DMX output
- [ ] Look blending works correctly
- [ ] Individual controls work
- [ ] Blackout function
- [ ] Configuration save/load
- [ ] Export/import configuration
- [ ] Capture look from current state
- [ ] Fixture patching updates
- [ ] Protocol switching (sACN ↔ Art-Net)
- [ ] Multiple clients connected simultaneously
- [ ] Network disconnect/reconnect behavior
- [ ] DMX output verification with hardware

## License & Usage

Internal use for DMX Dashboard. Not for redistribution.
