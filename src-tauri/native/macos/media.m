#import "fiore_macos.h"
#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>
#import <ScriptingBridge/ScriptingBridge.h>
#include <stdlib.h>
#include <string.h>

// These read-only selectors are shared by Music.sdef and Spotify.sdef. The
// generated ScriptingBridge subclasses implement them dynamically.
@protocol FioreScriptableTrack
@property (readonly, copy) NSString *name;
@property (readonly, copy) NSString *artist;
@end
@protocol FioreScriptablePlayer
@property (readonly) unsigned int playerState;
@property (readonly, strong) id<FioreScriptableTrack> currentTrack;
@end

@interface FioreMediaError : NSObject <SBApplicationDelegate>
@property NSInteger code;
@end
@implementation FioreMediaError
- (id)eventDidFail:(const AppleEvent *)event withError:(NSError *)error {
    (void)event;
    self.code = error.code;
    return nil;
}
@end

static NSString *player_bundle(int player) {
    return player == 0 ? @"com.apple.Music" : @"com.spotify.client";
}

static NSRunningApplication *running_player(int player) {
    for (NSRunningApplication *app in
         [NSRunningApplication runningApplicationsWithBundleIdentifier:player_bundle(player)]) {
        if (!app.terminated) return app;
    }
    return nil;
}

static OSStatus permission(pid_t pid, Boolean ask) {
    NSAppleEventDescriptor *target = [NSAppleEventDescriptor descriptorWithProcessIdentifier:pid];
    return AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, ask);
}

static NSDictionary *empty_snapshot(NSString *status) {
    return @{@"status": status, @"playing": @NO, @"title": @"",
             @"artist": @"", @"source_app": @""};
}

static char *encode_snapshot(NSDictionary *snapshot) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:snapshot options:0 error:NULL];
    if (!json) return NULL;
    char *result = malloc(json.length + 1);
    if (!result) return NULL;
    memcpy(result, json.bytes, json.length);
    result[json.length] = '\0';
    return result;
}

static NSString *event_error_status(NSInteger code) {
    if (code == errAEEventNotPermitted || code == errAEEventWouldRequireUserConsent)
        return @"denied";
    if (code == procNotFound || code == connectionInvalid || code == errAETimeout)
        return @"unavailable";
    return @"error";
}

static NSDictionary *sample_player(int index) {
    NSRunningApplication *running = running_player(index);
    if (!running) return empty_snapshot(@"unavailable");
    OSStatus consent = permission(running.processIdentifier, false);
    if (consent != noErr) return empty_snapshot(event_error_status(consent));

    // A PID target cannot launch a missing application. No bundle-identifier
    // SBApplication factory, activate or playback command is ever used.
    SBApplication *application = [SBApplication applicationWithProcessIdentifier:running.processIdentifier];
    if (!application || running.terminated || ![application isRunning])
        return empty_snapshot(@"unavailable");
    FioreMediaError *delegate = [FioreMediaError new];
    application.delegate = delegate;
    application.timeout = 15; // Apple event ticks (60 Hz): 250 ms per request.
    application.sendMode = kAEWaitReply | kAENeverInteract | kAEDontRecord;
    id<FioreScriptablePlayer> player = (id<FioreScriptablePlayer>)application;
    unsigned int state = player.playerState;
    if (delegate.code != 0) return empty_snapshot(event_error_status(delegate.code));
    // The playing enumerator in both players' public scripting dictionaries.
    if (state != 'kPSP') return empty_snapshot(@"ok");
    id<FioreScriptableTrack> track = player.currentTrack;
    if (delegate.code != 0) return empty_snapshot(event_error_status(delegate.code));
    NSString *title = track.name;
    if (delegate.code != 0) return empty_snapshot(event_error_status(delegate.code));
    NSString *artist = track.artist;
    if (delegate.code != 0) return empty_snapshot(event_error_status(delegate.code));
    if ((title && ![title isKindOfClass:[NSString class]]) ||
        (artist && ![artist isKindOfClass:[NSString class]]))
        return empty_snapshot(@"error");
    return @{@"status": @"ok", @"playing": @YES, @"title": title ?: @"",
             @"artist": artist ?: @"", @"source_app": player_bundle(index)};
}

char *fiore_macos_media_snapshot(void) {
    @autoreleasepool {
        @try {
            // Only the media sensor worker accesses this selection. Keep the
            // chosen player while it is playing, avoiding alternating banners.
            static int preferred = 0;
            NSDictionary *first = sample_player(preferred);
            if ([first[@"playing"] boolValue]) return encode_snapshot(first);
            NSDictionary *second = sample_player(1 - preferred);
            if ([second[@"playing"] boolValue]) {
                preferred = 1 - preferred;
                return encode_snapshot(second);
            }
            // A denied player must not prevent an authorized player from working.
            if ([first[@"status"] isEqual:@"error"] || [second[@"status"] isEqual:@"error"])
                return encode_snapshot(empty_snapshot(@"error"));
            if ([first[@"status"] isEqual:@"denied"] || [second[@"status"] isEqual:@"denied"])
                return encode_snapshot(empty_snapshot(@"denied"));
            return encode_snapshot(empty_snapshot(@"ok"));
        } @catch (NSException *exception) {
            // Exceptions may contain private track information: never stringify.
            (void)exception;
            return encode_snapshot(empty_snapshot(@"error"));
        }
    }
}

int fiore_macos_request_media_permission(int player) {
    @autoreleasepool {
        @try {
            if (player != 0 && player != 1) return 3;
            NSRunningApplication *running = running_player(player);
            if (!running) return 1;
            OSStatus result = permission(running.processIdentifier, true);
            if (result == noErr) return 0;
            if (result == procNotFound || result == connectionInvalid) return 1;
            if (result == errAEEventNotPermitted || result == errAEEventWouldRequireUserConsent)
                return 2;
            return 3;
        } @catch (NSException *exception) {
            (void)exception;
            return 3;
        }
    }
}
