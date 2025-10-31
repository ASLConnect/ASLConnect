#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>

#if __has_include("ASL/ASL-Swift.h")
#import "ASL/ASL-Swift.h"
#else
#import "ASL-Swift.h"
#endif

VISION_EXPORT_SWIFT_FRAME_PROCESSOR(HandLandmarksFrameProcessorPlugin, handLandmarks)