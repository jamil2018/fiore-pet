#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#include "fiore_macos.h"
#include <stdatomic.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

// The realtime callback exchanges only lock-free scalar state, never PCM buffers.
_Static_assert(ATOMIC_INT_LOCK_FREE == 2, "Audio peak atomics must be lock-free");
static NSString *const kAudioEnabled = @"FioreAudioReactionsEnabled";
static atomic_bool blocked = false;

typedef struct {
    AudioObjectID tap;
    AudioObjectID aggregate;
    AudioObjectID output;
    AudioDeviceIOProcID io;
    bool started;
    atomic_uint peakBits;
    atomic_uint callbacks;
    uint64_t lastCallbackNs;
    uint64_t nextRouteCheckNs;
    AudioStreamBasicDescription format;
} FiorePeak;

static uint64_t monotonic_ns(void) {
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return 0;
    return (uint64_t)now.tv_sec * 1000000000ULL + (uint64_t)now.tv_nsec;
}

int fiore_macos_audio_supported(void) {
    if (@available(macOS 14.2, *)) return 1;
    return 0;
}

int fiore_macos_audio_enabled(void) {
    @autoreleasepool {
        @try {
            return fiore_macos_audio_supported() &&
                [[NSUserDefaults standardUserDefaults] boolForKey:kAudioEnabled];
        } @catch (NSException *exception) { return 0; }
    }
}

void fiore_macos_set_audio_enabled(int enabled) {
    @autoreleasepool {
        @try {
            [[NSUserDefaults standardUserDefaults] setBool:(enabled != 0) forKey:kAudioEnabled];
            atomic_store(&blocked, false);
        } @catch (NSException *exception) { atomic_store(&blocked, true); }
    }
}

static OSStatus read_property(AudioObjectID object, AudioObjectPropertySelector selector,
                              UInt32 size, void *value) {
    AudioObjectPropertyAddress address = { selector, kAudioObjectPropertyScopeGlobal,
                                           kAudioObjectPropertyElementMain };
    return AudioObjectGetPropertyData(object, &address, 0, NULL, &size, value);
}

static AudioObjectID default_output(void) {
    AudioObjectID device = kAudioObjectUnknown;
    if (read_property(kAudioObjectSystemObject, kAudioHardwarePropertyDefaultOutputDevice,
                      sizeof(device), &device) != noErr) return kAudioObjectUnknown;
    return device;
}

static OSStatus sample_audio(AudioObjectID device, const AudioTimeStamp *now,
                             const AudioBufferList *input, const AudioTimeStamp *inputTime,
                             AudioBufferList *output, const AudioTimeStamp *outputTime,
                             void *context) {
    (void)device; (void)now; (void)inputTime; (void)output; (void)outputTime;
    FiorePeak *meter = context;
    float peak = 0;
    if (input != NULL) {
        for (UInt32 b = 0; b < input->mNumberBuffers; b++) {
            const AudioBuffer *buffer = &input->mBuffers[b];
            const float *samples = buffer->mData;
            if (samples == NULL) continue;
            for (UInt32 i = 0; i < buffer->mDataByteSize / sizeof(float); i++) {
                float value = fabsf(samples[i]);
                if (isfinite(value) && value > peak) peak = value;
            }
        }
    }
    peak = fminf(peak, 1.0f);
    unsigned bits;
    memcpy(&bits, &peak, sizeof(bits));
    // Positive IEEE754 float bit order matches numeric order.
    unsigned previous = atomic_load_explicit(&meter->peakBits, memory_order_relaxed);
    while (previous < bits && !atomic_compare_exchange_weak_explicit(
        &meter->peakBits, &previous, bits, memory_order_relaxed, memory_order_relaxed)) {}
    atomic_fetch_add_explicit(&meter->callbacks, 1, memory_order_release);
    return noErr;
}

void fiore_macos_peak_close(void *handle) {
    if (handle == NULL) return;
    FiorePeak *meter = handle;
    if (@available(macOS 14.2, *)) {
        if (meter->aggregate != kAudioObjectUnknown) {
            if (meter->started) AudioDeviceStop(meter->aggregate, meter->io);
            if (meter->io != NULL) {
                // If removal fails, retaining this small context is safer than a callback UAF.
                OSStatus removed = AudioDeviceDestroyIOProcID(meter->aggregate, meter->io);
                OSStatus destroyed = AudioHardwareDestroyAggregateDevice(meter->aggregate);
                if (removed != noErr && destroyed != noErr) {
                    atomic_store(&blocked, true);
                    return;
                }
            } else {
                AudioHardwareDestroyAggregateDevice(meter->aggregate);
            }
        }
        if (meter->tap != kAudioObjectUnknown) AudioHardwareDestroyProcessTap(meter->tap);
    }
    free(meter);
}

static bool float_format(AudioStreamBasicDescription format) {
    return format.mFormatID == kAudioFormatLinearPCM &&
        (format.mFormatFlags & kAudioFormatFlagIsFloat) != 0 &&
        (format.mFormatFlags & kAudioFormatFlagIsBigEndian) == 0 &&
        format.mBitsPerChannel == 32 && format.mChannelsPerFrame > 0 &&
        format.mBytesPerFrame == sizeof(float) *
            ((format.mFormatFlags & kAudioFormatFlagIsNonInterleaved) ? 1 : format.mChannelsPerFrame);
}

void *fiore_macos_peak_open(void) {
    if (!fiore_macos_audio_enabled() || atomic_load(&blocked)) return NULL;
    @autoreleasepool {
        FiorePeak *meter = NULL;
        @try {
            if (@available(macOS 14.2, *)) {
                meter = calloc(1, sizeof(FiorePeak));
                if (meter == NULL) return NULL;
                atomic_init(&meter->peakBits, 0);
                atomic_init(&meter->callbacks, 0);
                meter->output = default_output();
                if (meter->output == kAudioObjectUnknown) goto failed;
                CATapDescription *tap = [[CATapDescription alloc] initStereoGlobalTapButExcludeProcesses:@[]];
                tap.name = @"Fiore output level";
                tap.UUID = [NSUUID UUID];
                [tap setPrivate:YES];
                tap.muteBehavior = CATapUnmuted;
                if (AudioHardwareCreateProcessTap(tap, &meter->tap) != noErr) goto failed;
                if (read_property(meter->tap, kAudioTapPropertyFormat, sizeof(meter->format),
                                  &meter->format) != noErr || !float_format(meter->format)) goto failed;
                // Tap-only aggregate: never attach a physical device's input streams.
                NSDictionary *description = @{
                    @kAudioAggregateDeviceNameKey: @"Fiore private output meter",
                    @kAudioAggregateDeviceUIDKey: [NSUUID UUID].UUIDString,
                    @kAudioAggregateDeviceIsPrivateKey: @YES,
                    @kAudioAggregateDeviceIsStackedKey: @NO,
                    @kAudioAggregateDeviceTapAutoStartKey: @NO,
                    @kAudioAggregateDeviceTapListKey: @[@{
                        @kAudioSubTapUIDKey: tap.UUID.UUIDString,
                        @kAudioSubTapDriftCompensationKey: @YES
                    }]
                };
                if (AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)description,
                                                       &meter->aggregate) != noErr) goto failed;
                if (AudioDeviceCreateIOProcID(meter->aggregate, sample_audio, meter, &meter->io) != noErr) goto failed;
                if (AudioDeviceStart(meter->aggregate, meter->io) != noErr) goto failed;
                meter->started = true;
                meter->lastCallbackNs = monotonic_ns();
                return meter;
            }
        } @catch (NSException *exception) { /* Do not expose OS exception text. */ }
    failed:
        fiore_macos_peak_close(meter);
        // A failed permission/start attempt requires a new explicit tray opt-in.
        atomic_store(&blocked, true);
        return NULL;
    }
}

int fiore_macos_peak_read(void *handle, float *peak) {
    if (handle == NULL || peak == NULL || !fiore_macos_audio_enabled()) return -1;
    FiorePeak *meter = handle;
    uint64_t now = monotonic_ns();
    if (@available(macOS 14.2, *)) {
        if (now >= meter->nextRouteCheckNs) {
            meter->nextRouteCheckNs = now + 1000000000ULL;
            AudioStreamBasicDescription format = {0};
            if (default_output() != meter->output ||
                read_property(meter->tap, kAudioTapPropertyFormat, sizeof(format), &format) != noErr ||
                memcmp(&format, &meter->format, sizeof(format)) != 0) return -1;
        }
    }
    unsigned bits = atomic_exchange_explicit(&meter->peakBits, 0, memory_order_relaxed);
    unsigned callbacks = atomic_exchange_explicit(&meter->callbacks, 0, memory_order_acquire);
    if (callbacks > 0) meter->lastCallbackNs = now;
    if (now > meter->lastCallbackNs + 3000000000ULL) {
        // Capture can stop on permission revocation or a dead device. Do not reopen in a loop.
        atomic_store(&blocked, true);
        return -1;
    }
    memcpy(peak, &bits, sizeof(*peak));
    return callbacks > 0 ? 0 : 1;
}
