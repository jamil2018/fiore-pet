#ifndef FIORE_MACOS_H
#define FIORE_MACOS_H
#include <stddef.h>
char *fiore_macos_desktop_snapshot(void);
void fiore_macos_request_accessibility(void);
char *fiore_macos_media_snapshot(void);
int fiore_macos_request_media_permission(int player);
void *fiore_macos_peak_open(void);
int fiore_macos_peak_read(void *handle, float *peak);
void fiore_macos_peak_close(void *handle);
int fiore_macos_audio_enabled(void);
void fiore_macos_set_audio_enabled(int enabled);
int fiore_macos_audio_supported(void);
void fiore_macos_free(void *pointer);
void fiore_macos_show_message(const char *message);
#endif
