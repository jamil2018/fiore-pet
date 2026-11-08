#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreGraphics/CoreGraphics.h>
#include <math.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include "fiore_macos.h"

static char *encode(NSDictionary *value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    if (!data) return NULL;
    char *result = malloc(data.length + 1);
    if (!result) return NULL;
    memcpy(result, data.bytes, data.length);
    result[data.length] = 0;
    return result;
}

static NSDictionary *rect_value(CGRect rect) {
    return @{ @"x": @(rect.origin.x), @"y": @(rect.origin.y),
              @"width": @(rect.size.width), @"height": @(rect.size.height) };
}

static void focused_details(pid_t pid, NSMutableDictionary *result) {
    // No prompt during polling, and no traversal of text/value attributes.
    if (!AXIsProcessTrusted()) return;
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    if (!app) return;
    AXUIElementSetMessagingTimeout(app, 0.15f);
    CFTypeRef focused = NULL;
    if (AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute, &focused) == kAXErrorSuccess &&
        focused && CFGetTypeID(focused) == AXUIElementGetTypeID()) {
        AXUIElementRef window = (AXUIElementRef)focused;
        AXUIElementSetMessagingTimeout(window, 0.15f);
        CFTypeRef title = NULL;
        if (AXUIElementCopyAttributeValue(window, kAXTitleAttribute, &title) == kAXErrorSuccess &&
            title && CFGetTypeID(title) == CFStringGetTypeID()) {
            result[@"title"] = (__bridge NSString *)title;
        }
        if (title) CFRelease(title);
        CFTypeRef fullscreen = NULL;
        // Optional app-provided hint; unsupported attributes fall back to geometry.
        if (AXUIElementCopyAttributeValue(window, CFSTR("AXFullScreen"), &fullscreen) == kAXErrorSuccess &&
            fullscreen && CFGetTypeID(fullscreen) == CFBooleanGetTypeID()) {
            result[@"fullscreen"] = @((bool)CFBooleanGetValue(fullscreen));
        }
        if (fullscreen) CFRelease(fullscreen);
    }
    if (focused) CFRelease(focused);
    CFRelease(app);
}

// YES means enumeration succeeded and this app has no visible ordinary window.
// Query failures remain unknown, distinct from returning to an empty desktop.
static BOOL no_visible_window(pid_t pid, NSMutableDictionary *result) {
    CFArrayRef raw = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly |
                                             kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    if (!raw) return NO;
    NSArray *windows = CFBridgingRelease(raw);
    for (NSDictionary *window in windows) {
        if ([window[(__bridge id)kCGWindowOwnerPID] intValue] != pid ||
            [window[(__bridge id)kCGWindowLayer] intValue] != 0 ||
            [window[(__bridge id)kCGWindowAlpha] doubleValue] <= 0) continue;
        CGRect bounds;
        NSDictionary *dictionary = window[(__bridge id)kCGWindowBounds];
        if (!dictionary || !CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)dictionary, &bounds) ||
            CGRectIsEmpty(bounds) || CGRectIsInfinite(bounds) || CGRectIsNull(bounds)) continue;
        uint32_t count = 0;
        if (CGGetActiveDisplayList(0, NULL, &count) != kCGErrorSuccess || count == 0) return NO;
        CGDirectDisplayID *displays = calloc(count, sizeof(CGDirectDisplayID));
        if (!displays) return NO;
        if (CGGetActiveDisplayList(count, displays, &count) == kCGErrorSuccess) {
            double largest = 0;
            CGRect selected = CGRectNull;
            for (uint32_t i = 0; i < count; ++i) {
                CGRect display = CGDisplayBounds(displays[i]);
                CGRect intersection = CGRectIntersection(display, bounds);
                double area = CGRectIsNull(intersection) ? 0 : intersection.size.width * intersection.size.height;
                if (isfinite(area) && area > largest) { largest = area; selected = display; }
            }
            if (!CGRectIsNull(selected)) {
                result[@"window"] = rect_value(bounds);
                result[@"display"] = rect_value(selected);
            }
        }
        free(displays);
        return NO; // First normal window of the frontmost app is frontmost in CG order.
    }
    return YES;
}

char *fiore_macos_desktop_snapshot(void) {
    @autoreleasepool {
        @try {
            __block pid_t pid = 0;
            __block NSString *bundle = nil;
            __block BOOL regular = NO;
            __block BOOL identityFailed = NO;
            void (^identity)(void) = ^{
                @try {
                    NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
                    pid = app.processIdentifier;
                    bundle = [app.bundleIdentifier copy];
                    regular = app && app.activationPolicy == NSApplicationActivationPolicyRegular;
                } @catch (NSException *exception) { (void)exception; identityFailed = YES; }
            };
            if ([NSThread isMainThread]) identity();
            else dispatch_sync(dispatch_get_main_queue(), identity);
            if (identityFailed) return encode(@{ @"status": @"error" });
            NSMutableDictionary *result = [@{ @"status": @"ok", @"pid": pid > 0 ? @(pid) : NSNull.null,
                @"bundle_id": bundle ?: NSNull.null, @"title": NSNull.null,
                @"fullscreen": NSNull.null, @"is_self": @(pid == getpid()) } mutableCopy];
            if (pid <= 0 || pid == getpid()) return encode(result);
            if (!regular || [bundle isEqualToString:@"com.apple.dock"] ||
                [bundle isEqualToString:@"com.apple.systemuiserver"]) {
                result[@"fullscreen"] = @NO;
                return encode(result);
            }
            focused_details(pid, result);
            if (no_visible_window(pid, result) && ![result[@"fullscreen"] isEqual:@YES])
                result[@"fullscreen"] = @NO;
            return encode(result);
        } @catch (NSException *exception) {
            (void)exception;
            return encode(@{ @"status": @"error" });
        }
    }
}

void fiore_macos_request_accessibility(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            @try {
                NSDictionary *options = @{ (__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES };
                AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
            } @catch (NSException *exception) { (void)exception; }
        }
    });
}
