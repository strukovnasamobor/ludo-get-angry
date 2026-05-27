package hr.strukovnasamobor.ludo_get_angry;

import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebSettings;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.google.firebase.FirebaseApp;
import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory;
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "LudoMain";
    private static final String PLAY_STORE_PKG = "com.android.vending";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Install the App Check provider factory BEFORE super.onCreate so the
        // WebView/JS bridge sees the right factory when it requests its first token.
        // Play Store install -> Play Integrity. Sideload -> Debug provider
        // (only mints valid tokens for UUIDs whitelisted in Firebase Console).
        FirebaseApp.initializeApp(this);
        FirebaseAppCheck appCheck = FirebaseAppCheck.getInstance();
        if (isFromPlayStore()) {
            Log.i(TAG, "AppCheck: installing PlayIntegrity provider");
            appCheck.installAppCheckProviderFactory(
                PlayIntegrityAppCheckProviderFactory.getInstance()
            );
        } else {
            Log.i(TAG, "AppCheck: installing Debug provider (sideload)");
            appCheck.installAppCheckProviderFactory(
                DebugAppCheckProviderFactory.getInstance()
            );
        }

        super.onCreate(savedInstanceState);

        // Android 15+ (targetSdk >= 35) forces edge-to-edge. Pad the WebView so it
        // doesn't draw under system bars; the bar areas then show the activity
        // theme's window background instead of overlaying our content with a scrim.
        ViewCompat.setOnApplyWindowInsetsListener(
            findViewById(android.R.id.content),
            (v, insets) -> {
                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsetsCompat.CONSUMED;
            }
        );

        // Force-dark OFF so Samsung Internet / Android WebView cannot auto-invert.
        WebSettings s = this.bridge.getWebView().getSettings();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(s, WebSettingsCompat.FORCE_DARK_OFF);
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK_STRATEGY)) {
            WebSettingsCompat.setForceDarkStrategy(
                s, WebSettingsCompat.DARK_STRATEGY_WEB_THEME_DARKENING_ONLY
            );
        }
    }

    private boolean isFromPlayStore() {
        try {
            PackageManager pm = getPackageManager();
            String installer;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                installer = pm.getInstallSourceInfo(getPackageName()).getInstallingPackageName();
            } else {
                installer = pm.getInstallerPackageName(getPackageName());
            }
            return PLAY_STORE_PKG.equals(installer);
        } catch (Exception e) {
            return false;
        }
    }
}
