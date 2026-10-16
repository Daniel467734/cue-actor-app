package com.cue.actor;

import android.content.Context;
import android.media.AudioManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Silences the system speech-recogniser "ding" by muting sound streams while the user's turn is being listened to.
@CapacitorPlugin(name = "BeepMute")
public class BeepMute extends Plugin {
    private static final int[] STREAMS = {
        AudioManager.STREAM_MUSIC, AudioManager.STREAM_SYSTEM, AudioManager.STREAM_NOTIFICATION,
        AudioManager.STREAM_RING, AudioManager.STREAM_ALARM
    };
    private boolean muted = false;

    private void apply(boolean mute) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        for (int s : STREAMS) {
            try {
                am.adjustStreamVolume(s, mute ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE, 0);
            } catch (Exception ignored) {
            }
        }
        muted = mute;
    }

    @PluginMethod
    public void mute(PluginCall call) {
        if (!muted) apply(true);
        call.resolve();
    }

    @PluginMethod
    public void unmute(PluginCall call) {
        if (muted) apply(false);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (muted) apply(false);
    }

    @Override
    protected void handleOnPause() {
        if (muted) apply(false);
    }
}
