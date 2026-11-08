#import "fiore_macos.h"
#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>
#import <ScriptingBridge/ScriptingBridge.h>
#include <stdlib.h>
#include <string.h>

@protocol FioreBrowserTab
- (id)executeJavascript:(NSString *)script;
@end
@protocol FioreBrowserWindow
@property (readonly, strong) SBElementArray *tabs;
@end
@protocol FioreBrowserApplication
@property (readonly, strong) SBElementArray *windows;
- (id)doJavaScript:(NSString *)script in:(id)tab;
@end

@interface FioreBrowserError : NSObject <SBApplicationDelegate>
@property NSInteger code;
@end
@implementation FioreBrowserError
- (id)eventDidFail:(const AppleEvent *)event withError:(NSError *)error {
    (void)event;
    self.code = error.code;
    return nil;
}
@end

static NSString *bundle(int index) {
    switch (index) {
        case 0: return @"com.google.Chrome";
        case 1: return @"com.apple.Safari";
        case 2: return @"com.microsoft.edgemac";
        case 3: return @"com.brave.Browser";
        default: return nil;
    }
}
static NSString *preference(int index) {
    NSString *identifier = bundle(index);
    return identifier ? [@"FioreBrowserMedia." stringByAppendingString:identifier] : nil;
}
int fiore_macos_browser_enabled(int index) {
    @autoreleasepool {
        @try {
            NSString *key = preference(index);
            return key && [[NSUserDefaults standardUserDefaults] boolForKey:key];
        } @catch (NSException *exception) { (void)exception; return 0; }
    }
}
void fiore_macos_set_browser_enabled(int index, int enabled) {
    @autoreleasepool {
        @try {
            NSString *key = preference(index);
            if (key) [[NSUserDefaults standardUserDefaults] setBool:enabled != 0 forKey:key];
        } @catch (NSException *exception) { (void)exception; }
    }
}
static NSRunningApplication *running_browser(int index) {
    NSString *identifier = bundle(index);
    if (!identifier) return nil;
    for (NSRunningApplication *app in [NSRunningApplication runningApplicationsWithBundleIdentifier:identifier]) {
        if (!app.terminated) return app;
    }
    return nil;
}
static OSStatus permission(pid_t pid, Boolean ask) {
    NSAppleEventDescriptor *target = [NSAppleEventDescriptor descriptorWithProcessIdentifier:pid];
    return AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, ask);
}
int fiore_macos_request_browser_permission(int index) {
    @autoreleasepool {
        @try {
            if (!bundle(index)) return 3;
            NSRunningApplication *app = running_browser(index);
            if (!app) return 1;
            OSStatus result = permission(app.processIdentifier, true);
            if (result == noErr) return 0;
            if (result == procNotFound || result == connectionInvalid) return 1;
            if (result == errAEEventNotPermitted || result == errAEEventWouldRequireUserConsent) return 2;
            return 3;
        } @catch (NSException *exception) { (void)exception; return 3; }
    }
}

static char *encode(NSDictionary *snapshot) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:snapshot options:0 error:NULL];
    if (!data) return NULL;
    char *result = malloc(data.length + 1);
    if (!result) return NULL;
    memcpy(result, data.bytes, data.length);
    result[data.length] = 0;
    return result;
}
static NSDictionary *stopped(void) {
    return @{ @"status": @"ok", @"playing": @NO, @"title": @"", @"artist": @"", @"source_app": @"" };
}
// Leave one 100ms AppleEvent timeout inside the 400ms work budget.
static BOOL has_time(NSTimeInterval deadline) {
    return NSProcessInfo.processInfo.systemUptime + 0.1 < deadline;
}
static SBApplication *application(int index, FioreBrowserError *errors, pid_t *pid,
                                  NSTimeInterval deadline) {
    if (!fiore_macos_browser_enabled(index) || !has_time(deadline)) return nil;
    NSRunningApplication *running = running_browser(index);
    if (!running || !has_time(deadline) || permission(running.processIdentifier, false) != noErr ||
        !has_time(deadline)) return nil;
    SBApplication *app = [SBApplication applicationWithProcessIdentifier:running.processIdentifier];
    if (!app || running.terminated || ![app isRunning]) return nil;
    app.timeout = 6;
    app.sendMode = kAEWaitReply | kAENeverInteract | kAEDontRecord;
    app.delegate = errors;
    *pid = running.processIdentifier;
    return app;
}
static NSDictionary *sample(SBApplication *app, id tab, int index, NSString *probe,
                            FioreBrowserError *errors, BOOL *known) {
    if (known) *known = NO;
    @try {
    errors.code = 0;
    id value = index == 1 ? [(id<FioreBrowserApplication>)app doJavaScript:probe in:tab]
                         : [(id<FioreBrowserTab>)tab executeJavascript:probe];
    if (known && (errors.code == errAENoSuchObject || errors.code == procNotFound ||
                  errors.code == connectionInvalid || errors.code == errAEEventNotPermitted))
        *known = YES;
    if (errors.code || ![value isKindOfClass:NSString.class] || [value length] > 8192) return nil;
    NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
    id raw = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
    if (![raw isKindOfClass:NSDictionary.class]) return nil;
    id playing = raw[@"playing"], title = raw[@"title"], artist = raw[@"artist"];
    if (!playing || CFGetTypeID((__bridge CFTypeRef)playing) != CFBooleanGetTypeID() ||
        ![title isKindOfClass:NSString.class] || ![artist isKindOfClass:NSString.class] ||
        [title length] > 512 || [artist length] > 512) return nil;
    if (known) *known = YES;
    if (![playing boolValue]) return nil;
    return @{ @"status": @"ok", @"playing": @YES,
              @"title": [title length] ? title : @"Browser audio",
              @"artist": artist, @"source_app": bundle(index) };
    } @catch (NSException *exception) {
        (void)exception;
        return nil; // A stale selected tab must not prevent discovery of another player.
    }
}

char *fiore_macos_browser_snapshot(const char *script) {
    @autoreleasepool {
        @try {
            if (!script) return encode(stopped());
            NSString *probe = [NSString stringWithUTF8String:script];
            if (!probe) return encode(stopped());
            // Selection and cursors belong exclusively to the media sensor worker.
            static id selectedTab = nil;
            static SBApplication *selectedApp = nil;
            static int selectedBrowser = -1;
            static pid_t selectedPid = 0;
            static unsigned nextBrowser = 0;
            static NSUInteger windowCursor[4] = {0}, tabCursor[4] = {0};
            NSTimeInterval deadline = NSProcessInfo.processInfo.systemUptime + 0.4;
            FioreBrowserError *errors = [FioreBrowserError new];
            BOOL keepSelected = NO;
            if (selectedTab && fiore_macos_browser_enabled(selectedBrowser)) {
                NSRunningApplication *running = running_browser(selectedBrowser);
                if (running && running.processIdentifier == selectedPid &&
                    has_time(deadline) && permission(selectedPid, false) == noErr) {
                    keepSelected = YES;
                    selectedApp.delegate = errors;
                    if (has_time(deadline)) {
                        BOOL known = NO;
                        NSDictionary *result = sample(selectedApp, selectedTab, selectedBrowser, probe, errors, &known);
                        if (result) return encode(result);
                        if (known) keepSelected = NO;
                    }
                }
            }
            // Keep an unknown remote reference for next tick, but never replay its old
            // metadata. The Rust stop hold handles short misses while discovery proceeds.
            if (!keepSelected) {
                selectedTab = nil;
                selectedApp = nil;
                selectedBrowser = -1;
            }
            for (unsigned tried = 0; tried < 4 && has_time(deadline); tried++) {
                int index = nextBrowser++ % 4;
                pid_t pid = 0;
                SBApplication *app = application(index, errors, &pid, deadline);
                if (!app || !has_time(deadline)) continue;
                errors.code = 0;
                SBElementArray *windows = [(id<FioreBrowserApplication>)app windows];
                if (!has_time(deadline)) break;
                NSUInteger count = windows.count;
                if (errors.code || !count) continue;
                windowCursor[index] %= count;
                for (unsigned scanned = 0; scanned < 4 && has_time(deadline); scanned++) {
                    id<FioreBrowserWindow> window = [windows objectAtIndex:windowCursor[index]];
                    if (!has_time(deadline)) break;
                    SBElementArray *tabs = window.tabs;
                    if (!has_time(deadline)) break;
                    NSUInteger total = tabs.count;
                    if (errors.code) break;
                    if (!total || tabCursor[index] >= total) {
                        tabCursor[index] = 0;
                        windowCursor[index] = (windowCursor[index] + 1) % count;
                        continue;
                    }
                    if (!has_time(deadline)) break;
                    id tab = [tabs objectAtIndex:tabCursor[index]++];
                    if (!has_time(deadline)) break;
                    NSDictionary *result = sample(app, tab, index, probe, errors, NULL);
                    if (result) {
                        selectedTab = tab; selectedApp = app;
                        selectedBrowser = index; selectedPid = pid;
                        return encode(result);
                    }
                    // JavaScript-disabled tabs and closed tabs are recoverable misses.
                    errors.code = 0;
                }
                // One enabled browser per tick, rotated fairly even with many tabs.
                break;
            }
            return encode(stopped());
        } @catch (NSException *exception) {
            (void)exception; // Browser errors must never disable native players or leak page text.
            return encode(stopped());
        }
    }
}
