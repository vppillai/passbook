# Assets Directory

This directory contains application assets like icons, splash screens, and other media files.

## Required Assets

The following assets are required for the application to build properly:

### App Icons

- **icon.png** (1024x1024): Main app icon for iOS and Android
- **adaptive-icon.png** (1024x1024): Adaptive icon for Android
- **favicon.png** (48x48 or larger): Favicon for web

### Splash Screens

- **splash.png** (2048x2048 recommended): Splash screen for all platforms

### Notifications

- **notification-icon.png** (96x96): Icon for push notifications (Android)

## Creating Assets

### Option 1: Generate from Logo

If you have a logo:

1. Create a 1024x1024 PNG with your logo centered
2. Save as `icon.png`
3. Use https://www.appicon.co/ to generate all required sizes
4. Use https://www.favicon-generator.org/ for favicon

### Option 2: Use Placeholder Assets

For development, you can use solid color placeholders:

```bash
# Install ImageMagick if you don't have it
# macOS: brew install imagemagick
# Ubuntu: sudo apt-get install imagemagick

# Generate placeholder icon (blue)
convert -size 1024x1024 xc:#4A90E2 icon.png

# Generate placeholder adaptive icon (green)
convert -size 1024x1024 xc:#50C878 adaptive-icon.png

# Generate placeholder splash (light blue gradient)
convert -size 2048x2048 gradient:#87CEEB-#4A90E2 splash.png

# Generate placeholder favicon
convert -size 48x48 xc:#4A90E2 favicon.png

# Generate placeholder notification icon
convert -size 96x96 xc:#4A90E2 notification-icon.png
```

### Option 3: Expo Asset Generator

Use Expo's asset generator:

```bash
npx expo-asset-generator -p icon-source.png -b #ffffff
```

## Current Status

⚠️ **TODO**: Replace placeholder assets with actual branded assets before production deployment.

Current assets are placeholders generated for development purposes only.

## Asset Guidelines

### Icon Requirements

- **Format**: PNG with transparency
- **Size**: 1024x1024px minimum
- **Design**: Simple, recognizable at small sizes
- **Colors**: High contrast, avoid fine details
- **Safe Zone**: Keep important elements in central 80%

### Splash Screen Requirements

- **Format**: PNG
- **Size**: 2048x2048px minimum
- **Design**: Centered logo/brand with solid background
- **Safe Zone**: Keep content in central 50% for different screen ratios

### Notification Icon (Android)

- **Format**: PNG with transparency
- **Size**: 96x96px
- **Design**: White/transparent only (no colors)
- **Style**: Simple silhouette

## References

- [Expo App Icons](https://docs.expo.dev/guides/app-icons/)
- [Expo Splash Screens](https://docs.expo.dev/guides/splash-screens/)
- [Android Adaptive Icons](https://developer.android.com/guide/practices/ui_guidelines/icon_design_adaptive)
- [iOS App Icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)
