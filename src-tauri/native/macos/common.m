#include "fiore_macos.h"
#include <stdlib.h>
#import <AppKit/AppKit.h>
void fiore_macos_free(void *pointer) { free(pointer); }
void fiore_macos_show_message(const char *message) {
    @autoreleasepool {
        @try {
            NSString *text = message ? [NSString stringWithUTF8String:message] : nil;
            if (!text) return;
            dispatch_async(dispatch_get_main_queue(), ^{
                @try {
                    NSAlert *alert = [[NSAlert alloc] init];
                    alert.messageText = @"Fiore permissions";
                    alert.informativeText = text;
                    [alert addButtonWithTitle:@"OK"];
                    [alert runModal];
                } @catch (NSException *exception) { (void)exception; }
            });
        } @catch (NSException *exception) { (void)exception; }
    }
}
