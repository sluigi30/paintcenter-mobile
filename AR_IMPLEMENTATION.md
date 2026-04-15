# AR Implementation Guide

## Current Status

✅ **Working Now**: Camera-based wall paint preview with manual region selection
- Uses expo-camera with gesture-based wall region drawing
- Tap and drag to select wall areas
- Apply colors with adjustable opacity
- Works immediately without native builds

🔄 **Ready for Full AR**: ViroReact implementation (requires development build)
- `app/ar/preview-viro.jsx` contains the full AR version
- Real wall detection using ARKit/ARCore
- Automatic vertical plane detection
- Tap-to-fill on detected walls

## Option 1: Current Working Version (No Build Required)

The current `app/ar/preview.jsx` works immediately with Expo Go:

### Features
- Camera preview with overlay
- Manual wall region selection (drag to draw)
- Color picker with 8 paint colors
- Opacity control (30%-85%)
- Multiple wall regions support
- Clear all functionality

### How to Use
1. Navigate to product detail page
2. Tap "Preview on Wall (AR)"
3. Grant camera permission
4. Tap "+ Add Wall Region"
5. Drag on the wall area you want to paint
6. Select colors and adjust opacity

## Option 2: Full AR with ViroReact (Requires Dev Build)

For real AR with automatic wall detection:

### Step 1: Enable New Architecture

Already configured in `app.json`:
```json
{
  "expo": {
    "newArchEnabled": true
  }
}
```

### Step 2: Prebuild Native Code

```bash
# Commit your changes first
git add .
git commit -m "feat: implement AR wall paint preview"

# Run prebuild
npx expo prebuild --clean
```

### Step 3: Build and Run

#### iOS
```bash
npx expo run:ios
```

#### Android
```bash
npx expo run:android
```

### Step 4: Switch to ViroReact Version

Once the build succeeds, you can use the full AR version:

1. Rename `app/ar/preview.jsx` → `app/ar/preview-camera.jsx` (backup)
2. Rename `app/ar/preview-viro.jsx` → `app/ar/preview.jsx`
3. Restart the dev server

## Full AR Features (ViroReact Version)

### Automatic Wall Detection
- Uses ARKit (iOS) / ARCore (Android)
- Detects vertical planes in real-time
- Visual indicators for detected walls
- Multiple wall support

### Tap-to-Fill
- Tap any detected wall to fill with color
- Instant visual feedback
- Persistent fills across tracking updates

### Advanced Controls
- Opacity slider (30%-100%)
- Color picker modal
- Real-time tracking state display
- Success indicators

## Troubleshooting

### "ViroMaterials: MaterialManager is not available"
**Solution**: You need a development build with native modules. The current camera-based version works without this.

### Prebuild fails
**Solutions**:
- Commit all changes: `git add . && git commit -m "wip"`
- Clean node_modules: `rm -rf node_modules && npm install`
- Clear cache: `npx expo start --clear`

### Build takes too long
**Normal**: First build with native modules takes 5-15 minutes. Subsequent builds are faster.

### AR not working on device
**Check**:
- Physical device required (no simulators)
- iOS: iPhone 6s or newer
- Android: ARCore-supported device
- Camera permissions granted
- Good lighting for wall detection

## Recommendations

### For Quick Testing/Demo
Use the current camera-based version:
- No build required
- Works in Expo Go
- Manual but functional
- Good for showing the concept

### For Production/Best UX
Build the full AR version:
- Automatic wall detection
- Better user experience
- Professional feel
- Real AR tracking

## File Structure

```
app/ar/
├── preview.jsx          # Current: Camera-based (works now)
├── preview-viro.jsx     # Full AR version (requires dev build)
└── estimator.jsx        # Wall paint calculator
```

## Next Steps

1. **Test current version** in Expo Go to verify functionality
2. **Build dev client** when ready for full AR:
   ```bash
   npx expo prebuild --clean
   npx expo run:ios  # or android
   ```
3. **Swap preview files** to use ViroReact version
4. **Test on physical device** with real AR

## Performance Notes

### Camera Version
- ✅ Works immediately
- ✅ No native build needed
- ⚠️ Manual wall selection
- ⚠️ No AR tracking

### ViroReact Version
- ✅ Automatic wall detection
- ✅ Real AR with tracking
- ✅ Professional experience
- ⚠️ Requires dev build
- ⚠️ Physical device only
- ⚠️ First build: 5-15 minutes

## Questions?

See `AR_FEATURES.md` for detailed documentation on the full AR implementation.
