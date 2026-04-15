# NCM Paint Center Mobile App

## Project Overview

**NCM Paint Center** is a cross-platform mobile application built with **React Native** and **Expo** (SDK ~54). It serves as an e-commerce platform for a paint retail business, allowing customers to browse products, manage carts, place orders, and communicate with the store.

### Key Features
- **Authentication**: Login and registration with JWT-based auth persisted via AsyncStorage
- **Product Browsing**: Searchable product catalog with filtering, image display, and color swatches
- **Product Details**: Size selection (multi-volume options), quantity picker, stock indicators
- **Shopping Cart**: Full cart management (add, update quantity, remove items)
- **Checkout**: Supports delivery and pickup order types with multiple payment methods (COD, GCash, Card, Cash)
- **Order Management**: View order history with status tracking and cancellation
- **Messaging**: Real-time chat system with store admin (auto-polling every 5 seconds)
- **AR Wall Paint Preview**: Real augmented reality wall detection with tap-to-fill color visualization (using ViroReact/ARKit/ARCore)
- **Profile Management**: User account and profile settings

### Tech Stack
| Category | Technology |
|----------|-----------|
| Framework | React Native 0.81.5 + Expo ~54 |
| Routing | Expo Router ~6.0 (file-based routing) |
| State Management | Zustand |
| HTTP Client | Axios + Fetch API |
| Persistence | @react-native-async-storage |
| UI | React Native core components, custom styles |
| AR | @reactvision/react-viro (ViroReact), ARKit (iOS), ARCore (Android) |
| Animations | react-native-reanimated, react-native-gesture-handler |
| Icons | @expo/vector-icons (Ionicons) |

## Project Structure

```
paintcenter-mobile/
├── app/                          # Expo Router file-based routing
│   ├── _layout.jsx               # Root layout (Stack navigator)
│   ├── index.jsx                 # Root index (redirects to auth or tabs)
│   ├── checkout.jsx              # Checkout flow
│   ├── order-success.jsx         # Order confirmation screen
│   ├── (auth)/                   # Authentication route group
│   │   ├── _layout.jsx
│   │   ├── login.jsx
│   │   └── register.jsx
│   ├── (tabs)/                   # Main tab navigation route group
│   │   ├── _layout.jsx           # Tab bar configuration
│   │   ├── index.jsx             # Home / Product listing
│   │   ├── cart.jsx              # Shopping cart
│   │   ├── orders.jsx            # Order history
│   │   ├── messages.jsx          # Admin chat
│   │   └── profile.jsx           # User profile
│   ├── product/
│   │   └── [id].jsx              # Product detail page (dynamic route)
│   └── ar/
│       ├── preview.jsx           # AR color preview
│       └── estimator.jsx         # Paint quantity estimator
├── stores/                       # Zustand state stores
│   ├── authStore.js              # Authentication state & API calls
│   └── cartStore.js              # Cart state & API calls
├── constants/
│   ├── api.js                    # API base URL configuration
│   └── axios.js                  # Axios instance configuration
├── components/                   # Reusable UI components (currently empty)
├── assets/                       # Static assets (images, fonts, etc.)
├── package.json
├── app.json
└── babel.config.js
```

## Building and Running

### Prerequisites
- Node.js (v18+)
- npm, yarn, or bun
- Expo CLI (installed via project dependencies)
- For AR features: Physical iOS or Android device with ARKit/ARCore support
- For mobile testing: Expo Go app (for non-AR features) or Dev Client build (for AR)

### Commands

```bash
# Install dependencies
npm install

# Start Expo dev server
npm start

# Run on Android device/emulator
npm run android

# Run on iOS simulator
npm run ios
```

### Backend API Configuration

The app connects to a backend API at `http://192.168.1.69:8000/api`. This IP is hardcoded in multiple files and should be updated to match your backend server:

- `constants/api.js`
- `stores/authStore.js`
- `stores/cartStore.js`
- `app/(tabs)/index.jsx`
- `app/(tabs)/cart.jsx`
- `app/(tabs)/orders.jsx`
- `app/(tabs)/messages.jsx`
- `app/(tabs)/profile.jsx`
- `app/product/[id].jsx`
- `app/checkout.jsx`

**Note**: Consider centralizing the API URL in `constants/api.js` and importing it everywhere to simplify future changes.

## API Endpoints Used

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/login` | POST | User login |
| `/auth/register` | POST | User registration |
| `/auth/logout` | POST | User logout |
| `/products` | GET | List/search products |
| `/products/:id` | GET | Get product details |
| `/cart` | GET | Fetch user's cart |
| `/cart/add` | POST | Add item to cart |
| `/cart/:productId` | PUT | Update cart item quantity |
| `/cart/:productId` | DELETE | Remove item from cart |
| `/orders` | GET | Fetch user orders |
| `/orders` | POST | Place new order |
| `/orders/:id/cancel` | POST | Cancel an order |
| `/messages/admin` | GET | Get admin user ID |
| `/messages/thread/:adminId` | GET | Fetch message thread |
| `/messages/send` | POST | Send a message |

## Development Conventions

### State Management
- Uses **Zustand** for global state management
- Auth state (`authStore.js`) handles login, register, logout, and session persistence
- Cart state (`cartStore.js`) manages cart operations with axios
- Stores follow a pattern: state, actions, and async API calls

### Styling
- Uses React Native `StyleSheet.create()` for all component styles
- Consistent color scheme: primary orange (`#f97316`), dark text (`#1a1a1a`), gray accents
- Border radius values tend toward 12-16 for cards, 20+ for pill-shaped elements
- Shadow + elevation for cross-platform depth

### Code Patterns
- Functional components with React hooks (`useState`, `useEffect`, `useCallback`, etc.)
- API URLs currently duplicated across files; `constants/api.js` exists but is not consistently used
- Error handling via `Alert.alert()` for user-facing messages
- Loading states with `ActivityIndicator`
- JSX files use `.jsx` extension

### Tabs Navigation
The main app has 5 tabs (configured in `app/(tabs)/_layout.jsx`):
1. **Home** - Product listing with search
2. **Cart** - Shopping cart management
3. **Orders** - Order history and tracking
4. **Messages** - Chat with admin
5. **Profile** - User account settings

## Known Improvements

1. **API URL Centralization**: The backend URL (`192.168.1.69:8000`) is hardcoded in many files. Migrate all references to use `constants/api.js`.
2. **Axios Interceptors**: The `cartStore.js` uses axios but doesn't attach auth tokens via interceptors; other files use fetch with manual headers.
3. **Error Boundaries**: No React error boundaries implemented.
4. **TypeScript**: Project uses JavaScript; consider migrating to TypeScript for better type safety.
5. **Empty Components Directory**: The `components/` folder is empty; consider extracting reusable UI elements (product cards, buttons, etc.).
6. **Real-time Messaging**: Currently uses polling (5s interval); consider WebSockets for real-time updates.

## AR Features Documentation

The app includes a comprehensive AR wall paint preview feature powered by **ViroReact** (@reactvision/react-viro).

### AR Capabilities
- **Real Wall Detection**: Uses ARKit (iOS) and ARCore (Android) to detect vertical planes (walls)
- **Tap-to-Fill**: Tap detected walls to fill them with selected paint colors
- **Multiple Walls**: Detect and color multiple walls independently
- **Opacity Control**: Adjust paint transparency from 30% to 100%
- **Color Selection**: Choose from paint color palette
- **Real-time Tracking**: Automatic plane detection and tracking updates

### AR Files
- `app/ar/preview.jsx` - Main AR wall detection and paint preview component
- `app/ar/estimator.jsx` - Manual wall measurement calculator
- `AR_FEATURES.md` - Comprehensive AR feature documentation

### AR Requirements
- **Physical device required** (simulators don't support AR)
- **Development build** required (not Expo Go)
- **Camera permissions** must be granted
- **iOS**: ARKit-compatible device (iPhone 6s+)
- **Android**: ARCore-supported device

### Building for AR
```bash
# Development build with native modules
npx expo run:ios    # iOS
npx expo run:android  # Android

# Or use EAS Build for production
npx eas build --platform ios
npx eas build --platform android
```

### AR Architecture
See `AR_FEATURES.md` for detailed architecture, setup, troubleshooting, and future enhancements.
