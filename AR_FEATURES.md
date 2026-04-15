# AR Wall Paint Preview Feature

## Overview

The AR Paint Preview feature uses **ViroReact** to provide real augmented reality wall detection and paint color visualization. Users can point their camera at walls, detect vertical surfaces, and fill them with paint colors to preview how they would look in real-time.

## Features

### ✅ Implemented
- **Real Wall Detection**: Uses ARKit (iOS) and ARCore (Android) to detect vertical planes (walls)
- **Tap-to-Fill**: Tap on detected walls to fill them with the selected paint color
- **Color Selection**: Choose from a palette of paint colors
- **Opacity Control**: Adjust paint opacity (30% - 100%) to visualize different coverage levels
- **Real-time Preview**: See the paint applied to actual wall surfaces in AR
- **Multiple Wall Support**: Detect and fill multiple walls in the same space
- **Tracking Feedback**: Visual indicators show AR tracking state and guide users

## How It Works

### Architecture

```
ARPreview (Main Component)
├── ViroARSceneNavigator (AR Container)
│   └── ARWallScene (AR Scene Logic)
│       ├── ViroARPlaneSelector (Wall Detection)
│       ├── ViroARPlane (Detected Walls)
│       └── ViroBox (Color Overlays)
└── UI Overlay (Controls)
    ├── Top Bar (Back, Title, Color Dot)
    ├── Instructions
    ├── Opacity Control
    └── Bottom Controls (Color Picker, Estimator)
```

### Wall Detection Flow

1. **User starts AR experience** → Camera permission requested
2. **ViroARSceneNavigator initializes** → AR session starts
3. **User points camera at wall** → ViroARPlaneSelector detects vertical surfaces
4. **Detected planes are tracked** → Grid overlays appear on walls
5. **User taps a wall** → onPlaneSelected callback fires
6. **Color fill applied** → ViroBox with paint material overlays the wall
7. **User can change color/opacity** → Updates propagate to all filled planes

### Key Components

#### `ViroARPlaneSelector`
- Detects vertical planes (walls) in real-time
- Configured with `alignment={'Vertical'}`
- Minimum dimensions: 0.3m x 0.3m
- Maximum planes: 15
- Fires `onPlaneSelected` when user taps a detected wall

#### `ViroARPlane`
- Represents a detected wall surface
- Anchored to real-world position and orientation
- Contains child components (color overlays, grids)
- Updates automatically as AR tracking improves

#### `ViroBox` (Color Overlay)
- Applied as a thin box on the wall surface
- Uses ViroMaterials for paint colors
- Opacity controlled via material properties
- Scales automatically to match wall dimensions

## Setup & Configuration

### Dependencies Installed
```json
{
  "@reactvision/react-viro": "latest"
}
```

### App.json Configuration
```json
{
  "expo": {
    "plugins": [
      "expo-router",
      "expo-camera",
      "@reactvision/react-viro"
    ],
    "ios": {
      "infoPlist": {
        "NSCameraUsageDescription": "Camera access for AR wall detection",
        "NSPhotoLibraryUsageDescription": "Access to save paint previews"
      }
    },
    "android": {
      "permissions": ["CAMERA", "android.permission.CAMERA"]
    }
  }
}
```

### Required Permissions
- **Camera**: Required for AR scene capture
- **Photo Library** (iOS): Optional, for saving previews
- **ARKit** (iOS): Automatic with ViroReact
- **ARCore** (Android): Automatic with ViroReact

## Usage

### Basic Usage
1. Navigate to a product detail page
2. Tap "🎨 Preview on Wall (AR)" button
3. Grant camera permissions
4. Point camera at a wall
5. Tap the detected wall to fill with color
6. Use controls to change color and opacity

### Controls

#### Top Bar
- **← Back**: Exit AR and return to product page
- **Color Dot**: Shows currently selected paint color

#### Instructions Panel
- Displays guidance text for first-time users
- Shows "Move camera slowly to detect walls" during limited tracking

#### Opacity Control
- Preset values: 30%, 50%, 70%, 85%, 100%
- Tap to change paint transparency
- Applies to all filled walls

#### Bottom Controls
- **🎨 Change Color**: Opens color picker modal
- **📐 Measure Wall**: Opens wall paint estimator

### Color Picker Modal
- Scrollable horizontal list of paint colors
- Tap to select and apply to next wall
- Shows selected color with orange border

## Technical Details

### Material Registration
```javascript
ViroMaterials.registerMaterials({
  [`${colorHex}_fill`]: {
    diffuseColor: colorHex,
    lightingModel: 'Phong',
    shininess: 1.0,
  }
});
```

Colors are registered as Viro materials on component mount. Each color hex code becomes a unique material key.

### Plane State Management
```javascript
const [filledPlanes, setFilledPlanes] = useState([]);
// Structure: { anchorId, color, opacity }
```

Filled planes are tracked by their AR anchor ID, allowing:
- Persistent color application
- Updates when color/opacity changes
- Multiple walls with different colors

### Tracking States
- **NORMAL**: Good tracking, walls detected
- **LIMITED**: Moving camera needed for better detection
- **NOT_AVAILABLE**: AR not supported on device

## Testing

### On iOS
```bash
npm run ios
```
Requires physical device for ARKit (simulator has limited AR support)

### On Android
```bash
npm run android
```
Requires ARCore-enabled device (most modern Android phones)

### Development Build
For custom native modules, use Expo Dev Client:
```bash
npx expo run:ios
npx expo run:android
```

## Troubleshooting

### Issue: Walls not detecting
**Solutions:**
- Ensure good lighting (AR needs visual features to track)
- Move camera slowly in a scanning motion
- Avoid plain, featureless walls
- Check camera permissions

### Issue: Color not appearing on wall
**Solutions:**
- Verify opacity is not set to 0%
- Check that materials are registered
- Tap directly on the detected plane area
- Ensure wall is at least 0.3m x 0.3m

### Issue: AR crashes on startup
**Solutions:**
- Rebuild app with `npx expo prebuild`
- Verify ViroReact plugin in app.json
- Check device ARKit/ARCore compatibility
- Clear Metro cache: `npx expo start --clear`

### Issue: Materials not changing
**Solutions:**
- Materials are registered once per session
- Restart app if adding new colors
- Check material key format (no `#` in hex codes)

## Future Enhancements

### Potential Improvements
1. **Screenshot Capture**: Save AR previews to share
2. **Measurement Tools**: Show wall dimensions in AR
3. **Multiple Colors**: Paint different sections of the same wall
4. **Finish Options**: Add matte, satin, glossy material variants
5. **Lighting Adaptation**: Adjust colors based on room lighting
6. **Furniture Occlusion**: Detect and work around objects
7. **3D Paint cans**: Place product models in the room
8. **Collaborative AR**: Share previews with others

### Performance Optimizations
- Lazy load materials only for visible colors
- Reduce max planes for lower-end devices
- Add debounce to plane selection
- Implement plane merging for large walls

## Resources

- **ViroReact Docs**: https://viro-community.readme.io
- **ViroReact GitHub**: https://github.com/ReactVision/viro
- **ARKit Documentation**: https://developer.apple.com/documentation/arkit
- **ARCore Documentation**: https://developers.google.com/ar/develop

## Notes

- **Development Build Required**: ViroReact requires a development build, not Expo Go
- **Physical Device Required**: AR features don't work in simulators/emulators
- **Internet Not Required**: AR processing is entirely on-device
- **Battery Intensive**: AR uses camera and motion sensors, expect increased battery drain
