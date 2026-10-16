package com.cue.actor;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BeepMute.class);
        super.onCreate(savedInstanceState);
    }
}
