import { VisionCameraProxy, Frame } from "react-native-vision-camera";

let plugin = null;

/**
 * Run the “handLandmarks” frame‐processor plugin.
 *
 * @param {import("react-native-vision-camera").Frame} frame
 * @returns {Array<import("react-native-vision-camera").FrameProcessorPluginResultType>}
 */
/**
 * Initialize the frame processor plugin lazily
 */
function initializePlugin() {
  "worklet";
  if (plugin === null) {
    try {
      plugin = VisionCameraProxy.initFrameProcessorPlugin("handLandmarks", {});
    } catch (error) {
      console.error("Failed to initialize handLandmarks plugin:", error);
      plugin = false; // Mark as failed
    }
  }
  return plugin;
}

export function handLandmarks(frame) {
  "worklet";
  const pluginInstance = initializePlugin();
  
  if (!pluginInstance || pluginInstance === false) {
    console.warn("HandLandmarks plugin not available");
    return [];
  }
  
  try {
    return pluginInstance.call(frame) || [];
  } catch (error) {
    console.error("Error calling handLandmarks plugin:", error);
    return [];
  }
}

export default function _() {
  return null;
}
