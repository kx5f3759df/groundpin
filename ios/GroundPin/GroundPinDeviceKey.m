#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(GroundPinDeviceKey, NSObject)

RCT_EXTERN_METHOD(initializeOrRotateDeviceKey:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(exportPublicKeyAsc:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(signHashesTxtDetachedGpg:(NSDictionary *)input
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
