package hr.strukovnasamobor.ludo_get_angry;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Disable Android's auto-applied translucent scrim on the system bars,
        // otherwise the nav bar area looks grey even though windowBackground is
        // black. Requires API 29+ (Android 10+).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }

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
}
