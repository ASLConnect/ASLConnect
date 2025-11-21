# ASLConnect

ASLConnect is a simple mobile app that captures American Sign Language through the device camera and turns it into English text. It is built with Expo and React Native.

## What it does

- Requests camera and microphone access so the app can see and hear the signer.
- Streams the signing data through our translation pipeline.
- Displays English text so non-signers can understand the conversation.

## Getting started

1. Install dependencies

   ```bash
   npm install
   ```

2. Run the development server

   ```bash
   npx expo start
   ```

3. Open the app in Expo Go or an emulator and grant the requested permissions.

## Folder guide

- `app/` – screens, including the permissions flow and translator UI.
- `components/` – shared UI pieces such as themed text and views.
- `assets/` – app icons, splash art, and fonts.

## Requirements

- iOS device/emulator with a camera.
- Camera and microphone permissions enabled for accurate ASL capture.
