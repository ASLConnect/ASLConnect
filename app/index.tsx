// Global reference so JS callback can update React state
let _setPredictedClass: ((label: string) => void) | null = null;
// compute convex hull (Monotone Chain)
function convexHull(points: [number, number][]): [number, number][] {
    'worklet';
    points = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: [number, number][] = [];
    for (const p of points) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }
    const upper: [number, number][] = [];
    for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
            upper.pop();
        }
        upper.push(p);
    }
    // Only pop if arrays have elements
    if (upper.length > 0) upper.pop();
    if (lower.length > 0) lower.pop();
    return lower.concat(upper);
}
// ray-casting point-in-polygon
function pointInPolygon(pt: [number, number], vs: [number, number][]): boolean {
    'worklet';
    const [x, y] = pt;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const [xi, yi] = vs[i], [xj, yj] = vs[j];
        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}
import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import { FillType, PaintStyle, Skia } from '@shopify/react-native-skia';
import { Buffer } from 'buffer';
import { Redirect, Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Image,
    Pressable,
    StyleSheet,
    Switch,
    Text,
    View
} from 'react-native';
import {
    Camera,
    Camera as CameraLib,
    CameraPermissionStatus,
    PhotoFile,
    TakePhotoOptions,
    useCameraDevice,
    useSkiaFrameProcessor
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
console.log('🟢 CameraScreen module loaded');

import { Frame, VisionCameraProxy } from 'react-native-vision-camera';
import { useResizePlugin } from 'vision-camera-resize-plugin';


// Guarded requires: avoid crashing if native modules are not in the current dev build.
let MailComposer: any = null;
let FileSystem: any = null;
try { MailComposer = require('expo-mail-composer'); } catch {}
try { FileSystem = require('expo-file-system'); } catch {}

export const wpLog = Worklets.createRunOnJS((tag: string, payload?: any) => {
  try {
    const msg =
      typeof payload === 'string'
        ? payload
        : JSON.stringify(payload);
    console.log(`[WP] ${tag}:`, msg);
  } catch {
    console.log(`[WP] ${tag}: <non-serializable>`);
  }
});

// JS-side callback to log Base64 wrist crop with landmark overlay

// Serialize API calls: only allow one in flight at a time
const apiInFlight = Worklets.createSharedValue(false);
const lineThickness = 2; // thickness in pixels for lines
const circleRadius = 4; // radius in pixels for landmark circles
const width = 256, height = 256;
const rgba = new Uint8Array(width * height * 4);
let previousGuess = "";

// Skeletal connections for drawing bones
const lines = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

// Email recipients (must be non-empty or some mail clients won't open). Change if needed.
const EMAIL_TO = ['aaron.zhu0w@gmail.com'];

// Truncate long base64 for mailto: body so the composer will actually open.
function mailtoSafeBody(prefix: string, base64: string) {
  return `${prefix}${base64}`;
}

// Minimum time between calls in ms
// const COOLDOWN_MS = 200;
// let lastCallTime = 0;


/**
 * Convert a raw 256x256 RGB Uint8Array to a 24-bit BMP (base64).
 * No native deps; works in Expo Go. Produces small-ish files good for email attachments.
 */
function rgbToBmpBase64(rgb: Uint8Array, width: number, height: number): string {
  const rowStride = ((width * 3 + 3) >> 2) << 2; // 4-byte row alignment
  const imageSize = rowStride * height;
  const fileSize = 14 + 40 + imageSize; // BMP header(14) + DIB header(40) + pixels
  const out = new Uint8Array(fileSize);
  const dv = new DataView(out.buffer);

  // BMP header 'BM'
  out[0] = 0x42; out[1] = 0x4D;
  dv.setUint32(2, fileSize, true);
  dv.setUint16(6, 0, true);
  dv.setUint16(8, 0, true);
  dv.setUint32(10, 54, true); // offset to pixel data

  // DIB header (BITMAPINFOHEADER)
  dv.setUint32(14, 40, true);        // header size
  dv.setInt32(18, width, true);      // width
  dv.setInt32(22, height, true);     // height (positive => bottom-up)
  dv.setUint16(26, 1, true);         // planes
  dv.setUint16(28, 24, true);        // bits per pixel
  dv.setUint32(30, 0, true);         // compression (BI_RGB)
  dv.setUint32(34, imageSize, true); // image size
  dv.setInt32(38, 2835, true);       // X ppm (~72dpi)
  dv.setInt32(42, 2835, true);       // Y ppm
  dv.setUint32(46, 0, true);         // colors used
  dv.setUint32(50, 0, true);         // important colors

  // Pixel data: BGR order, bottom-up rows
  let src = 0;
  for (let y = 0; y < height; y++) {
    const dstRowStart = 54 + (height - 1 - y) * rowStride;
    let di = dstRowStart;
    for (let x = 0; x < width; x++) {
      const r = rgb[src++], g = rgb[src++], b = rgb[src++];
      out[di++] = b; out[di++] = g; out[di++] = r;
    }
    // pad row to 4-byte multiple
    while ((di - dstRowStart) % 4 !== 0) out[di++] = 0;
  }
  return Buffer.from(out).toString('base64');
}

const logWristCrop = async (data: unknown) => {
  console.log('🔵 logWristCrop function entered');

  // If we're already waiting for an API response, skip heavy work this frame.
  if (apiInFlight.value) {
    console.log('⏭️ API in flight, skipping heavy encode this frame');
    return;
  }

  // We'll build this and send it to the API.
  let b64ForApi: string | null = null;

  // Expect shape { rgb: number[], w: number, h: number, pts: [number, number][] }
  if (
    data &&
    typeof data === 'object' &&
    'rgb' in (data as any) &&
    'w' in (data as any) &&
    'h' in (data as any)
  ) {
    const payload = data as any;
    const W = payload.w as number;
    const H = payload.h as number;
    const rgbArr = payload.rgb as number[];
    const ptsLocal = (payload.pts as [number, number][]) || [];

    console.log('🔵 Received cropped payload', {
      w: W,
      h: H,
      rgbLen: rgbArr.length,
    });

    // plain number[] -> Uint8Array we can mutate
    const buf = new Uint8Array(
      rgbArr.map((v: any) =>
        (typeof v === 'number' ? v : parseInt(String(v), 10)) & 0xff
      )
    );

    // --- mask background outside convex hull ---
    if (ptsLocal && ptsLocal.length >= 3) {
      let hullLocal: [number, number][] = [];
      try {
        hullLocal = convexHull(ptsLocal as [number, number][]);
      } catch (err) {
        console.warn('Hull error on JS side:', err);
      }
      if (hullLocal && hullLocal.length >= 3) {
        for (let yy = 0; yy < H; yy++) {
          for (let xx = 0; xx < W; xx++) {
            if (!pointInPolygon([xx, yy], hullLocal)) {
              const idx = (yy * W + xx) * 3;
              buf[idx] = 0;
              buf[idx + 1] = 0;
              buf[idx + 2] = 0;
            }
          }
        }
      }
    }

    // helpers to draw joints/bones right into buf
    const putPixel = (
      px: number,
      py: number,
      r: number,
      g: number,
      b: number
    ) => {
      if (px >= 0 && px < W && py >= 0 && py < H) {
        const pIdx = (py * W + px) * 3;
        buf[pIdx] = r;
        buf[pIdx + 1] = g;
        buf[pIdx + 2] = b;
      }
    };

    const drawThickLine = (
      x0: number,
      y0: number,
      x1: number,
      y1: number
    ) => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        const fx = x0 + dx * t;
        const fy = y0 + dy * t;
        const ix = Math.round(fx);
        const iy = Math.round(fy);
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            putPixel(ix + ox, iy + oy, 0, 0, 255); // blue
          }
        }
      }
    };

    const drawCircleFill = (cx: number, cy: number, rad: number) => {
      const r2 = rad * rad;
      for (let oy = -rad; oy <= rad; oy++) {
        for (let ox = -rad; ox <= rad; ox++) {
          const dx = ox;
          const dy = oy;
          if (dx * dx + dy * dy <= r2) {
            putPixel(
              Math.round(cx + ox),
              Math.round(cy + oy),
              0,
              255,
              0
            ); // green
          }
        }
      }
    };

    // draw bones on buf
    for (let li = 0; li < lines.length; li++) {
      const i = lines[li][0];
      const j = lines[li][1];
      const p1 = ptsLocal[i];
      const p2 = ptsLocal[j];
      drawThickLine(p1[0], p1[1], p2[0], p2[1]);
    }
    // draw joints on buf
    for (let ci = 0; ci < ptsLocal.length; ci++) {
      const [cx, cy] = ptsLocal[ci];
      drawCircleFill(cx, cy, circleRadius);
    }

    // rotate 90° clockwise into rotBuf (so orientation matches preview)
    const rotBuf = new Uint8Array(W * H * 3);
    for (let srcY = 0; srcY < H; srcY++) {
      for (let srcX = 0; srcX < W; srcX++) {
        // 90° clockwise:
        // newX = H - 1 - srcY
        // newY = srcX
        const newX = H - 1 - srcY;
        const newY = srcX;
        const srcIdx = (srcY * W + srcX) * 3;
        const dstIdx = (newY * W + newX) * 3;
        rotBuf[dstIdx] = buf[srcIdx];
        rotBuf[dstIdx + 1] = buf[srcIdx + 1];
        rotBuf[dstIdx + 2] = buf[srcIdx + 2];
      }
    }

    // Build final BMP base64 to send to model
    const bmpB64Small = rgbToBmpBase64(rotBuf, W, H);
    b64ForApi = bmpB64Small;

    // Update data for fallback handling below
    data = rotBuf;
  }

  console.log('🔵 Received data type:', typeof data);
  console.log('🔵 Data is array?', Array.isArray(data));

  // Fallback / debug base64 conversion
  let b64: string;
  try {
    if (Array.isArray(data)) {
      console.log('🔵 Converting array of', data.length, 'items');
      const numbers = data.map(str =>
        Math.min(
          255,
          Math.max(0, parseInt(String(str), 10) % 256)
        )
      );
      const uint8Array = new Uint8Array(numbers);
      b64 = Buffer.from(uint8Array).toString('base64');
      console.log(
        '🔵 Successfully converted array to base64, length:',
        b64.length
      );
    } else if (typeof data === 'string') {
      console.log('🔵 Data is already a string');
      b64 = data;
    } else if (data instanceof Uint8Array) {
      console.log(
        '🔵 Converting Uint8Array of length:',
        data.length
      );
      b64 = Buffer.from(data).toString('base64');
      console.log(
        '🔵 Successfully converted Uint8Array to base64, length:',
        b64.length
      );
    } else if (data instanceof ArrayBuffer) {
      console.log('🔵 Converting ArrayBuffer');
      b64 = Buffer.from(new Uint8Array(data)).toString(
        'base64'
      );
      console.log(
        '🔵 Successfully converted ArrayBuffer to base64, length:',
        b64.length
      );
    } else if (data && typeof data === 'object') {
      console.log('🔵 Object shape:', {
        hasBuffer: 'buffer' in data,
        bufferType: (data as any).buffer
          ? typeof (data as any).buffer
          : 'no buffer',
        hasLength: 'length' in data,
        length:
          'length' in data
            ? (data as any).length
            : 'no length',
        hasBytes: 'bytes' in data,
        bytesType:
          'bytes' in data
            ? typeof (data as any).bytes
            : 'no bytes',
      });
      if ('buffer' in (data as any)) {
        const bufferData = (data as any).buffer;
        console.log('🔵 Buffer type:', typeof bufferData);
        if (bufferData instanceof Uint8Array) {
          b64 = Buffer.from(bufferData).toString('base64');
        } else if (bufferData instanceof ArrayBuffer) {
          b64 = Buffer.from(
            new Uint8Array(bufferData)
          ).toString('base64');
        } else if (Array.isArray(bufferData)) {
          b64 = Buffer.from(
            new Uint8Array(bufferData)
          ).toString('base64');
        } else {
          console.error('🔴 Unknown buffer type');
          throw new Error(
            'Unknown buffer type: ' + typeof bufferData
          );
        }
      } else if (
        'bytes' in (data as any) &&
        Array.isArray((data as any).bytes)
      ) {
        console.log('🔵 Converting bytes array');
        b64 = Buffer.from(
          new Uint8Array((data as any).bytes)
        ).toString('base64');
      } else if (
        'length' in (data as any) &&
        typeof (data as any).length === 'number'
      ) {
        console.log('🔵 Converting array-like object');
        const arr = Array.from(data as ArrayLike<number>);
        b64 = Buffer.from(
          new Uint8Array(arr)
        ).toString('base64');
      } else {
        throw new Error(
          'Object has no usable buffer or array data'
        );
      }
      console.log(
        '🔵 Successfully converted object to base64, length:',
        b64?.length
      );
    } else {
      throw new Error('Unexpected data type: ' + typeof data);
    }

    // Prefer processed/rotated BMP base64 for the API
    const apiPayloadB64 = b64ForApi ?? b64;

    // mark API busy so frameProcessor stops sending us new frames
    apiInFlight.value = true;
    console.log('trying');
    wpLog('🚀 Calling API with wrist crop');

    fetch(
      'https://ag.usw-17.palantirfoundry.com/foundry-ml-live/api/inference/transform/ri.foundry-ml-live.main.live-deployment.3826955b-26c8-4d0c-b276-14c5738ede6b/v2',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization':
            'eyJwbG50ciI6IkxOVk1kUE5WTkxhZy8zMEVISzVzdEE9PSIsImFsZyI6IkVTMjU2In0.eyJzdWIiOiI0RS92NFRMTlJHbU9rT3c5ODlaMEp3PT0iLCJqdGkiOiJvRHRjY2FoOFFlYUhNQys1cXU4MTZ3PT0iLCJvcmciOiJaSXhWd0ZTT1E5cUhaR1lFbTQ1RU1nPT0ifQ.uMxENfVhkRur4eCIMxAgdK4EDLNdeYW9n1jqeZy1l2NMPZu079S6zrskcvDlMsfRJNQyolgAuyptAXwsi5lTbg'
        },
        body: JSON.stringify({
          input_df: [
            {
              base64: apiPayloadB64 || '',
            },
          ],
        }),
      }
    )
      .then(res => {
        console.log('✅ API response status:', res.status);
        return res.json();
      })
      .then(json => {
        console.log('📊 API response JSON:', json);

        // Try to extract predicted class from response
        let predictedClass = '';
        if (
          json.prediction &&
          Array.isArray(json.prediction) &&
          json.prediction.length > 0
        ) {
          const entry = json.prediction[0];
          if (entry.predicted_class != null) {
            predictedClass = String(entry.predicted_class);
          } else if (entry.class != null) {
            predictedClass = String(entry.class);
          } else if (entry.result != null) {
            predictedClass = String(entry.result);
          }
        } else if (
          typeof json === 'object' &&
          'predicted_class' in json
        ) {
          predictedClass = String(
            (json as any).predicted_class
          );
        } else if (typeof json === 'string') {
          predictedClass = json;
        }

        console.log('Predicted class:', predictedClass);

        // Notify React state via registered setter
        if (_setPredictedClass) {
          _setPredictedClass(predictedClass);
        }

        // free up API so next frame can run
        apiInFlight.value = false;
      })
      .catch(err => {
        console.error('❌ API request failed:', err);
        // free up API even on error
        apiInFlight.value = false;
      });
  } catch (e) {
    console.error('🥡 wrist-crop base64/encode error:', e);
  }
};

// let plugin: any = null;

/**
 * Run the “handLandmarks” frame‐processor plugin.
 *
 * @param {import('react-native-vision-camera').Frame} frame
 * @returns {Array<import('react-native-vision-camera').FrameProcessorPluginResultType>}
 */
/**
 * Initialize the frame processor plugin lazily
 */
// function initializePlugin() {
//     'worklet';
//     if (plugin === null) {
//         try {
//             const plugin = VisionCameraProxy.initFrameProcessorPlugin('handLandmarks', {});
//             console.log('HandLandmarks plugin initialized:', plugin);
//         } catch (error) {
//             console.error('Failed to initialize handLandmarks plugin:', error);
//             plugin = false; // Mark as failed
//         }
//     }
//     return plugin;
// }

// Initialize plugin
const plugin = VisionCameraProxy.initFrameProcessorPlugin('handLandmarks', {});
// console.log('🟡 handLandmarks plugin instance:', plugin);

function handLandmarks(frame: Frame) {
    'worklet';

    // const pluginInstance = initializePlugin();

    // if (!pluginInstance || pluginInstance === false) {
    //     console.warn('HandLandmarks plugin not available');
    //     return [];
    // }

    // try {
    //     return pluginInstance.call(frame) || [];
    // } catch (error) {
    //     console.error('Error calling handLandmarks plugin:', error);
    //     return [];
    // }

    if (plugin == null) {
        throw new Error('Failed to load Frame Processor Plugin!');
    }
    return plugin.call(frame);
}



const CameraScreen = () => {
    const [predictedClass, setPredictedClass] = useState<string>('');
    const [overlayEnabled, setOverlayEnabled] = useState<boolean>(true);
    // Register setter for external callbacks
    _setPredictedClass = setPredictedClass;
    const wristCropFrameCount = useRef(0);
    const router = useRouter();
    const [cameraPosition, setCameraPosition] = useState<'front' | 'back'>('back');
    const device = useCameraDevice(cameraPosition, {
        physicalDevices: ['ultra-wide-angle-camera'],
    });

    const { resize } = useResizePlugin();
    // console.log('🔧 resize plugin:', resize);

    const [isActive, setIsActive] = useState(false);
    const [flash, setFlash] = useState<TakePhotoOptions['flash']>('off');

    const [photo, setPhoto] = useState<PhotoFile | undefined>(undefined);

    const camera = useRef<Camera>(null);

    const [cameraPermissionStatus, setCameraPermissionStatus] = useState<CameraPermissionStatus>('not-determined');
    const [microphonePermissionStatus, setMicrophonePermissionStatus] = useState<CameraPermissionStatus>('not-determined');

    const requestMicrophonePermission = async () => {
        const permission = await Camera.requestMicrophonePermission();

        setMicrophonePermissionStatus(permission);
    };

    const requestCameraPermission = async () => {
        const permission = await Camera.requestCameraPermission();

        setCameraPermissionStatus(permission);
    };

    useEffect(() => {
        (async () => {
            console.log('🔧 Starting permission check');
            const camPerm = await CameraLib.getCameraPermissionStatus();
            setCameraPermissionStatus(camPerm);
            const micPerm = await CameraLib.getMicrophonePermissionStatus();
            setMicrophonePermissionStatus(micPerm);
            console.log('🎬 Camera permission status:', camPerm, 'Microphone:', micPerm);
            requestCameraPermission();
            requestMicrophonePermission();
            console.log('Camera permission status:', camPerm);
            console.log('Microphone permission status:', micPerm);
        })();
    }, []);

    useFocusEffect(
        useCallback(() => {
            console.log('▶️ CameraScreen gained focus, activating frame processor');
            setIsActive(true);
            return () => {
                console.log('⏸️ CameraScreen lost focus, deactivating frame processor');
                setIsActive(false);
            };
        }, [])
    );

    const paint = Skia.Paint();
    paint.setStyle(PaintStyle.Fill);
    paint.setStrokeWidth(2);
    paint.setColor(Skia.Color('lime'));

    const linePaint = Skia.Paint();
    linePaint.setStyle(PaintStyle.Fill);
    linePaint.setStrokeWidth(4);
    linePaint.setColor(Skia.Color('blue'));

    const logWristCropJS = Worklets.createRunOnJS((data: unknown) => {
        console.log('🟡 logWristCropJS wrapper called');
        logWristCrop(data);
        console.log('🟡 logWristCropJS wrapper finished');
    });

    const frameProcessor = useSkiaFrameProcessor(frame => {
        'worklet';
        const shouldDrawOverlay = overlayEnabled;
        frame.render();
        try {
            wpLog('Frame processor iteration', 'Starting new frame');
            const data = handLandmarks(frame);
            const frameWidth = frame.width;
            const frameHeight = frame.height;
            const isHandArray = (d: any): d is any[][] => Array.isArray(d) && Array.isArray(d[0]);
            if (isHandArray(data)) {
                // Define the 512x512 crop used for the resize buffer
                const cropRect = { x: 256, y: 256, width: 512, height: 512 };
                const buf = resize(frame, {
                    scale: {
                        width: 256,
                        height: 256,
                    },
                    crop: cropRect,
                    pixelFormat: 'rgb',
                    dataType: 'uint8'
                });
                // Map landmarks into ABSOLUTE frame coordinates and clamp to the 512x512 crop box
                const maxX = cropRect.x + cropRect.width;
                const maxY = cropRect.y + cropRect.height;
                const pts: [number, number][] = data[0].map(
                  (lm): [number, number] => {
                    // Landmark positions are normalized [0..1] relative to the frame
                    const lx = lm.x * frameWidth;
                    const ly = lm.y * frameHeight;
                    // Clamp to the crop rect so drawings align with the red box
                    const xClamped = lx < cropRect.x ? cropRect.x : (lx > maxX ? maxX : lx);
                    const yClamped = ly < cropRect.y ? cropRect.y : (ly > maxY ? maxY : ly);
                    return [xClamped, yClamped];
                  }
                );
                // console.log('🟢 Hand landmarks points:', pts);
                let hull: [number, number][] = [];
                try {
                    hull = convexHull(pts);
                    // console.log('🟢 Convex hull points:', hull);
                } catch (hullError) {
                    console.error('🔴 Convex hull computation error:', hullError, 'Input points:', pts);
                    throw hullError;
                }
                // Convert tuples to SkPoint objects
                let skPts;
                try {
                    skPts = hull.map(([x, y]) => ({ x, y }));
                    // console.log('🟢 SkPoints:', skPts);
                } catch (skPtsError) {
                    console.error('🔴 SkPoints mapping error:', skPtsError, 'Hull:', hull);
                    throw skPtsError;
                }
                let path;
                try {
                    path = Skia.Path.Make();
                    // console.log('🟢 SkPath created:', path);
                    // Build path from SkPoint[]
                    path.addPoly(skPts, true);
                    // console.log('🟢 Path created with points:', skPts);
                } catch (pathError) {
                    console.error('🔴 Path creation error:', pathError, 'SkPoints:', skPts);
                    throw pathError;
                }
                // Apply outside mask: black outside the hull, keep inside untouched within the crop
                if (shouldDrawOverlay) {
                    try {
                        const maskPath = Skia.Path.Make();
                        // Cover the crop rect
                        maskPath.addRect(Skia.XYWHRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height));
                        // Subtract the hull polygon using even-odd fill
                        maskPath.addPoly(skPts, true);
                        // Use EvenOdd so we effectively draw (cropRect - hull)
                        // @ts-ignore FillType is provided by RN Skia
                        maskPath.setFillType(FillType.EvenOdd);
                        const maskPaint = Skia.Paint();
                        maskPaint.setStyle(PaintStyle.Fill);
                        maskPaint.setColor(Skia.Color('black'));
                        frame.drawPath(maskPath, maskPaint);
                    } catch (drawMaskError) {
                        console.error('🔴 draw outside-mask error:', drawMaskError);
                        throw drawMaskError;
                    }
                }
                // Draw bone lines
                if (shouldDrawOverlay) {
                    try {
                        for (const [i, j] of lines) {
                            const p1 = pts[i], p2 = pts[j];
                            frame.drawLine(p1[0], p1[1], p2[0], p2[1], linePaint);
                        }
                    } catch (drawLineError) {
                        console.error('🔴 drawLine error:', drawLineError, 'Points:', pts);
                        throw drawLineError;
                    }
                }
                // Draw landmark circles
                if (shouldDrawOverlay) {
                    try {
                        for (const [x, y] of pts) {
                            frame.drawCircle(x, y, circleRadius, paint);
                        }
                    } catch (drawCircleError) {
                        console.error('🔴 drawCircle error:', drawCircleError, 'Points:', pts);
                        throw drawCircleError;
                    }
                }
                // Hand off to JS only if no API call is currently in flight.
                // JS will do the heavy per-pixel work (masking, rotation, encoding, fetch).
                wristCropFrameCount.current++;
                wpLog('Frame Counter', {
                  count: wristCropFrameCount.current,
                  hasValidBuffer: !!buf,
                });

                if (buf && !apiInFlight.value) {
                  // Map absolute frame coords -> local 256x256 crop coords
                  const ptsLocal: [number, number][] = pts.map(([ax, ay]) => {
                    const cx = ((ax - cropRect.x) / cropRect.width) * 256;
                    const cy = ((ay - cropRect.y) / cropRect.height) * 256;
                    const x = cx < 0 ? 0 : cx > 255 ? 255 : cx;
                    const y = cy < 0 ? 0 : cy > 255 ? 255 : cy;
                    return [x, y];
                  });

                  // Give raw buf (unmodified), plus projected landmarks, to JS.
                  // JS will mask background, draw skeleton, rotate, encode BMP, and call the API.
                  logWristCropJS({
                    rgb: Array.from(buf),
                    w: 256,
                    h: 256,
                    pts: ptsLocal,
                  });
                } else if (!buf) {
                  wpLog('Error', 'Buffer is null');
                }
            }
            // Draw debug rect
            try {
                const rect = Skia.XYWHRect(256, 256, 512, 512)
                const paint1 = Skia.Paint()
                paint1.setColor(Skia.Color('red'))
                paint1.setStyle(PaintStyle.Stroke);
                frame.drawRect(rect, paint1)
            } catch (rectError) {
                console.error('🔴 drawRect error:', rectError);
            }
        } catch (error) {
            console.error('🔴 Frame processor error (outer):', error);
        }
    }, [resize, overlayEnabled]);

    const onTakePicturePressed = async () => {
        console.log('📸 onTakePicturePressed fired');
        const photo = await camera.current?.takePhoto({
            flash,
        });
        console.log('📸 Photo taken:', photo);
        setPhoto(photo);
    };

    if (cameraPermissionStatus === 'not-determined' || microphonePermissionStatus === 'not-determined') {
        console.log('⏳ Permissions loading...');
        return <Text>Loading permissions...</Text>;
    }

    if (cameraPermissionStatus !== 'granted' || microphonePermissionStatus !== 'granted') {
        console.log('🔒 Permissions denied, redirecting');
        console.log('Redirecting to /permissions because permissions are not granted:', cameraPermissionStatus, microphonePermissionStatus);
        return <Redirect href="/permissions" />;
    }

    if (!device) {
        console.log('❌ No camera device available');
        return <Text>Camera device not found</Text>;
    }
    console.log('✅ Rendering main CameraScreen UI');
    return (
        <View style={{ flex: 1 }}>
            <Stack.Screen options={{ headerShown: false }} />
            <Camera
                ref={camera}
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={isActive && !photo}
                photo
                audio
                frameProcessor={frameProcessor}
                pixelFormat='rgb'
            />
            {photo && (
                <>
                    <Image source={{ uri: photo.path }} style={StyleSheet.absoluteFill} />
                    <FontAwesome5
                        onPress={() => setPhoto(undefined)}
                        name="arrow-left"
                        size={25}
                        color="white"
                        style={{ position: 'absolute', top: 50, left: 30 }}
                    />
                </>
            )}
            {!photo && (
                <>
                    <View
                        style={{
                            position: 'absolute',
                            right: 10,
                            top: 50,
                            padding: 10,
                            borderRadius: 5,
                            backgroundColor: 'rgba(0, 0, 0, 0.40)',
                            gap: 30,
                        }}
                    >
                        <View style={{ alignItems: 'center' }}>
                            <Text style={{ color: 'white', fontSize: 12 }}>Overlay</Text>
                            <Switch
                                value={overlayEnabled}
                                onValueChange={setOverlayEnabled}
                            />
                        </View>

                        <Ionicons
                            name={flash === 'off' ? 'flash-off' : 'flash'}
                            onPress={() =>
                                setFlash((curValue) => (curValue === 'off' ? 'on' : 'off'))
                            }
                            size={30}
                            color="white"
                        />
                        <Ionicons
                            name="camera-reverse-outline"
                            onPress={() => setCameraPosition((p) => (p === 'back' ? 'front' : 'back'))}
                            size={30}
                            color="white"
                        />
                    </View>
                    <Pressable
                        onPress={onTakePicturePressed}
                        style={{
                            position: 'absolute',
                            alignSelf: 'center',
                            bottom: 50,
                            width: 80,
                            height: 80,
                            borderRadius: 40,
                            backgroundColor: 'white',
                            borderWidth: 4,
                            borderColor: '#eee',
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.3,
                            shadowRadius: 8,
                            elevation: 8,
                            justifyContent: 'center',
                            alignItems: 'center',
                        }}
                    >
                        <FontAwesome5 name="camera" size={36} color="#222" />
                    </Pressable>
                </>
            )}

            {predictedClass !== '' && (
                <View style={{
                    position: 'absolute',
                    bottom: 100,
                    alignSelf: 'center',
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 8,
                }}>
                    <Text style={{ color: 'white', fontSize: 18 }}>
                        {predictedClass}
                    </Text>
                </View>
            )}
        </View>
    );
};

export default CameraScreen;
