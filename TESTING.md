# Profile Refactor Testing Guide

## Phase 1: Backend Schema & Migration

### Prerequisites
1. **Backup your current config** (automatic, but verify)
2. **Stop the server** if running
3. **Note your current fixture states** (take screenshots if needed)

### Test 1: Migration Runs Successfully

**Steps**:
1. Start the server with `npm start` (or `node server/server.js`)
2. Watch the console output

**Expected Output**:
```
[Server] Running migrations...
[Server] Creating backup before migration...
[Server] Backup created at /path/to/server/config.backup.json
[Migration] ========================================
[Migration] Starting migration to Control Blocks v1
[Migration] ========================================
[Migration] Starting profile migration to Control Blocks...
[Migration] Migrating profile rgb-3ch (LED Par (3ch RGB))
[Migration]   Found RGB at index 0
[Migration]   Created 1 controls
[Migration] Profile migration complete
[Migration] Starting HSV → RGB look conversion...
[Migration]   Converting look look1 target panel1 from HSV to RGB
[Migration]     HSV(30, 100, 75) → RGB(75, 37, 0)
[Migration]   Look look1 converted
[Migration] Look conversion complete
[Migration] Removing colorMode from fixtures...
[Migration]   Removing colorMode from fixture panel1
[Migration]   Removing colorMode from fixture panel2
[Migration] Removed colorMode from 2 fixtures
[Migration] ========================================
[Migration] Migration complete!
[Migration] ========================================
[Server] Saving migrated config...
[Server] Config saved successfully
[Server] Config reloaded
[Server] No migration needed
```

**Verification**:
- [ ] Migration runs without errors
- [ ] `config.backup.json` file created in `server/` directory
- [ ] Console shows all profiles migrated
- [ ] Console shows looks converted (if any had HSV)
- [ ] Console shows colorMode removed from fixtures

---

### Test 2: Backup File Created

**Steps**:
1. Navigate to `server/` directory
2. Check for `config.backup.json` file

**Expected**:
- [ ] `config.backup.json` exists
- [ ] File contains your original config (before migration)
- [ ] File is valid JSON (can open and read)

---

### Test 3: Profile Structure Migrated

**Steps**:
1. Open `server/config.json`
2. Look at `fixtureProfiles` array

**Expected Structure**:
```json
{
  "fixtureProfiles": [
    {
      "id": "rgb-3ch",
      "name": "LED Par (3ch RGB)",
      "controls": [
        {
          "id": "some-uuid",
          "label": "RGB Color",
          "domain": "Color",
          "controlType": "RGB",
          "channelCount": 3,
          "components": [
            { "type": "red", "name": "red", "offset": 0 },
            { "type": "green", "name": "green", "offset": 1 },
            { "type": "blue", "name": "blue", "offset": 2 }
          ],
          "defaultValue": { "type": "rgb", "r": 1.0, "g": 1.0, "b": 1.0 }
        }
      ]
    }
  ]
}
```

**Verification**:
- [ ] `controls` array exists (not `channels`)
- [ ] Each control has `id`, `label`, `domain`, `controlType`, `channelCount`, `components`
- [ ] RGB channels grouped into single RGB control
- [ ] Intensity channels become Intensity control
- [ ] Other channels become Generic controls
- [ ] Channel offsets are correct (0, 1, 2 for RGB)

---

### Test 4: HSV Looks Converted to RGB

**Steps**:
1. Open `server/config.json`
2. Look at `looks` array → `targets` for each look

**Before Migration** (in backup):
```json
{
  "looks": [
    {
      "id": "look1",
      "targets": {
        "panel1": { "hue": 30, "sat": 100, "brightness": 75 }
      }
    }
  ]
}
```

**After Migration** (in config.json):
```json
{
  "looks": [
    {
      "id": "look1",
      "targets": {
        "panel1": { "red": 75, "green": 37, "blue": 0 }
      }
    }
  ]
}
```

**Verification**:
- [ ] Look targets no longer have `hue`, `sat`, `brightness`
- [ ] Look targets now have `red`, `green`, `blue`
- [ ] RGB values are reasonable (0-100 range)
- [ ] Colors look approximately correct (you can verify visually later)

**Color Conversion Reference**:
- HSV(0, 100, 100) → RGB(100, 0, 0) - Pure Red
- HSV(120, 100, 100) → RGB(0, 100, 0) - Pure Green
- HSV(240, 100, 100) → RGB(0, 0, 100) - Pure Blue
- HSV(30, 100, 75) → RGB(75, 37.5, 0) - Orange

---

### Test 5: colorMode Removed from Fixtures

**Steps**:
1. Open `server/config.json`
2. Look at `fixtures` array

**Before Migration** (in backup):
```json
{
  "fixtures": [
    {
      "id": "panel1",
      "profileId": "rgb-3ch",
      "colorMode": "hsv",
      "address": 1
    }
  ]
}
```

**After Migration** (in config.json):
```json
{
  "fixtures": [
    {
      "id": "panel1",
      "profileId": "rgb-3ch",
      "address": 1
    }
  ]
}
```

**Verification**:
- [ ] No `colorMode` field on any fixture
- [ ] All other fixture properties preserved (`id`, `profileId`, `address`, `name`, `tags`)

---

### Test 6: Migration Version Set

**Steps**:
1. Open `server/config.json`
2. Look at root level

**Expected**:
```json
{
  "migrationVersion": 1,
  "fixtureProfiles": [...],
  ...
}
```

**Verification**:
- [ ] `migrationVersion` is `1`

---

### Test 7: Migration Only Runs Once

**Steps**:
1. Stop the server
2. Start the server again
3. Watch console output

**Expected Output**:
```
[Server] Running migrations...
[Server] No migration needed
```

**Verification**:
- [ ] "No migration needed" message appears
- [ ] No backup file created (or timestamp unchanged)
- [ ] Migration logic skipped

---

### Test 8: Server Starts Successfully

**Steps**:
1. After migration, verify server continues to start

**Expected Output**:
```
Server running on port 2996
Bind address: 0.0.0.0
Local access: http://localhost:2996
...
```

**Verification**:
- [ ] Server starts without errors
- [ ] Web interface accessible at http://localhost:2996
- [ ] No error messages in console

---

## Rollback Procedure (If Needed)

If migration fails or causes issues:

**Steps**:
1. Stop the server
2. Copy `server/config.backup.json` to `server/config.json`:
   ```bash
   cp server/config.backup.json server/config.json
   ```
3. Delete migration version (optional, to re-run migration):
   - Open `server/config.json`
   - Remove `"migrationVersion": 1` line
4. Restart server

---

## Common Issues & Solutions

### Issue: Migration fails with "Cannot find module 'uuid'"
**Solution**: Install uuid package:
```bash
cd server
npm install uuid
```

### Issue: "config.json is not valid JSON" error
**Solution**:
1. Restore from backup: `cp server/config.backup.json server/config.json`
2. Check JSON syntax with a validator
3. Report the error

### Issue: Looks don't work after migration
**Symptoms**: Looks don't change fixture colors
**Diagnosis**: Check if look targets were converted correctly
**Solution**: Verify RGB values in looks are 0-100 range

### Issue: Fixtures show no color
**Symptoms**: Color wheel doesn't work, fixtures stay off
**Diagnosis**: State may not have been reinitialized
**Solution**:
1. Restart server
2. Clear browser cache
3. Check DMX output page to verify values

---

---

## Phase 2 & 3: State Management & DMX Engine

### Test 9: Server Starts Without Errors

**Steps**:
1. Stop the server (if running)
2. Start the server: `node server/server.js`
3. Watch for errors

**Expected Output**:
```
[Server] Running migrations...
[Server] No migration needed
Output engine started at 30 fps
Server running on port 2996
Bind address: 0.0.0.0
Local access: http://localhost:2996
...
```

**Verification**:
- [ ] No "Cannot read properties of undefined" errors
- [ ] No "profile.channels.forEach" errors
- [ ] Server stays running (doesn't crash)

---

### Test 10: State Generated from Control Blocks

**Steps**:
1. With server running, make API request:
   ```bash
   curl http://localhost:2996/api/config | jq '.fixtureProfiles[0].controls'
   ```

**Expected**: See Control Blocks structure (not channels)

**Verification**:
- [ ] Profiles have `controls` array
- [ ] No `channels` array present

---

### Test 11: RGB Fixtures Have Correct State Keys

**Steps**:
1. Open the dashboard in browser: http://localhost:2996
2. Open browser console (F12)
3. Check WebSocket messages for state

**Expected State**:
```javascript
{
  fixtures: {
    "panel1": {
      red: 0,
      green: 0,
      blue: 0
    }
  }
}
```

**Verification**:
- [ ] RGB fixtures have `red`, `green`, `blue` keys (NOT `hue`, `sat`, `brightness`)
- [ ] Intensity fixtures have `intensity` key
- [ ] All values start at 0

---

### Test 12: DMX Output Works

**Steps**:
1. Open dashboard
2. Adjust an RGB fixture (use color wheel)
3. Check DMX Output page
4. Verify channels show correct values

**Expected**:
- Moving color wheel updates RGB channels (Ch 1, 2, 3)
- Values are 0-255
- DMX output matches slider positions

**Verification**:
- [ ] Color wheel adjustments update DMX output
- [ ] RGB channels output correct values
- [ ] No errors in console

---

### Test 13: Looks Work with RGB

**Steps**:
1. Open dashboard
2. Move a Look slider to 100%
3. Check fixture color changes
4. Check DMX Output page

**Expected**:
- Look applies RGB color to fixture
- DMX output shows correct RGB values
- Colors match what was recorded in look

**Verification**:
- [ ] Looks apply correctly
- [ ] RGB values blend with HTP
- [ ] Multiple looks blend correctly

---

### Test 14: No Legacy Code Warnings

**Steps**:
1. Check server console logs
2. Look for warning messages

**Expected**:
- No warnings about "old 'channels' schema"
- No warnings about HSV processing

**Verification**:
- [ ] No legacy schema warnings
- [ ] Clean console output

---

## Next Phase

Once Phase 2 & 3 pass all tests, proceed to **Phase 4: Settings Page Profiles Tab UI**.

Phase 4 will update the Settings page to show and edit Control Blocks.
