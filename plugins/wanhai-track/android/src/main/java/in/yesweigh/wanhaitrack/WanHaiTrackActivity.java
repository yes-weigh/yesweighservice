package in.yesweigh.wanhaitrack;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

/**
 * In-app Wan Hai tracker for phone:
 * 1) User passes CAPTCHA in the WebView
 * 2) Taps "Track now" — JS selects Ctnr No., pastes container, clicks Query
 * 3) On results page, JS scrapes the table and finishes the Activity
 */
public class WanHaiTrackActivity extends AppCompatActivity {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_CONTAINER = "containerNumber";
    public static final String EXTRA_RESULT_CONTAINER = "resultContainer";
    public static final String EXTRA_RESULT_STATUS = "resultStatus";
    public static final String EXTRA_RESULT_DEPOT = "resultDepot";
    public static final String EXTRA_RESULT_VOYAGE = "resultVoyage";
    public static final String EXTRA_RESULT_VESSEL = "resultVessel";
    public static final String EXTRA_RESULT_EVENT_AT = "resultEventAt";
    public static final String EXTRA_RESULT_BOOKING = "resultBooking";
    public static final String EXTRA_RESULT_ROWS_JSON = "resultRowsJson";
    public static final String EXTRA_RESULT_SOURCE_URL = "resultSourceUrl";

    private WebView webView;
    private TextView statusView;
    private Button trackButton;
    private String containerNumber = "";
    private boolean scrapeArmed = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String url = getIntent().getStringExtra(EXTRA_URL);
        containerNumber = String.valueOf(getIntent().getStringExtra(EXTRA_CONTAINER)).trim().toUpperCase();
        if (url == null || url.isEmpty() || containerNumber.isEmpty()) {
            setResult(Activity.RESULT_CANCELED);
            finish();
            return;
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        root.setBackgroundColor(Color.parseColor("#0B1220"));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.setPadding(28, 28, 28, 20);
        bar.setBackgroundColor(Color.parseColor("#111827"));

        statusView = new TextView(this);
        statusView.setTextColor(Color.parseColor("#E2E8F0"));
        statusView.setTextSize(14f);
        statusView.setText("1) Pass Wan Hai CAPTCHA\n2) Tap Track now — we paste " + containerNumber + " and Query");
        bar.addView(statusView, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.END);
        actions.setPadding(0, 16, 0, 0);

        Button closeButton = new Button(this);
        closeButton.setText("Close");
        closeButton.setOnClickListener(v -> {
            setResult(Activity.RESULT_CANCELED);
            finish();
        });

        trackButton = new Button(this);
        trackButton.setText("Track now");
        trackButton.setOnClickListener(v -> runTrackScript());

        actions.addView(closeButton);
        actions.addView(trackButton);
        bar.addView(actions);

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new Bridge(), "YesWeighWanHai");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String finishedUrl) {
                if (scrapeArmed || (finishedUrl != null && finishedUrl.contains("tracking_ctnr_list"))) {
                    scrapeArmed = true;
                    view.postDelayed(() -> runScrapeScript(), 700);
                }
            }
        });

        root.addView(bar, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        root.addView(webView, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ));
        setContentView(root);

        webView.loadUrl(url);
    }

    private void runTrackScript() {
        statusView.setText("Pasting container and tapping Query…");
        trackButton.setEnabled(false);
        scrapeArmed = true;
        String escaped = containerNumber
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "")
            .replace("\r", "");
        String js =
            "(function(){"
                + "try{"
                + "var container='" + escaped + "';"
                + "function visible(el){if(!el)return false;var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}"
                + "var selects=document.querySelectorAll('select');"
                + "for(var i=0;i<selects.length;i++){var opts=selects[i].options||[];for(var j=0;j<opts.length;j++){"
                + "if(/ctnr|container/i.test(opts[j].text||'')){selects[i].value=opts[j].value;"
                + "selects[i].dispatchEvent(new Event('change',{bubbles:true}));break;}}}"
                + "var items=document.querySelectorAll('li,label,span,div,a');"
                + "for(var k=0;k<items.length;k++){var t=(items[k].textContent||'').trim();"
                + "if(/^ctnr\\s*no\\.?$/i.test(t)){items[k].click();break;}}"
                + "var inputs=[].slice.call(document.querySelectorAll('input[type=text],input:not([type]),textarea'))"
                + ".filter(visible);"
                + "if(inputs[0]){inputs[0].focus();inputs[0].value=container;"
                + "inputs[0].dispatchEvent(new Event('input',{bubbles:true}));"
                + "inputs[0].dispatchEvent(new Event('change',{bubbles:true}));}"
                + "var buttons=document.querySelectorAll('button,input[type=button],input[type=submit],a');"
                + "for(var b=0;b<buttons.length;b++){var label=((buttons[b].value||'')+' '+(buttons[b].textContent||'')).trim();"
                + "if(/\\bquery\\b/i.test(label)){buttons[b].click();break;}}"
                + "return true;"
                + "}catch(e){return false;}"
                + "})();";
        webView.evaluateJavascript(js, value -> {
            if ("false".equals(value)) {
                statusView.setText("Could not find the form yet — finish CAPTCHA, then tap Track now again.");
                trackButton.setEnabled(true);
            } else {
                statusView.setText("Query sent — waiting for results…");
            }
        });
    }

    private void runScrapeScript() {
        String js =
            "(function(){"
                + "try{"
                + "var tables=document.querySelectorAll('table');"
                + "for(var t=0;t<tables.length;t++){"
                + "var ths=[].slice.call(tables[t].querySelectorAll('th')).map(function(th){return (th.textContent||'').replace(/\\s+/g,' ').trim();});"
                + "if(!ths.some(function(h){return /ctnr|container|status|vessel|voyage/i.test(h);})) continue;"
                + "var trs=[].slice.call(tables[t].querySelectorAll('tbody tr, tr')).filter(function(tr){return tr.querySelectorAll('td').length;});"
                + "var rows=trs.map(function(tr){var cells=[].slice.call(tr.querySelectorAll('td')).map(function(td){return (td.textContent||'').replace(/\\s+/g,' ').trim();});"
                + "var row={};ths.forEach(function(h,i){if(h)row[h]=cells[i]||'';});return row;}).filter(function(r){return Object.keys(r).length;});"
                + "if(!rows.length) continue;"
                + "var first=rows[0];"
                + "function pick(){var keys=[].slice.call(arguments);for(var key in first){for(var i=0;i<keys.length;i++){if(key.toLowerCase().indexOf(keys[i])>=0)return first[key]||null;}}return null;}"
                + "var payload={"
                + "containerNumber:pick('ctnr no','container'),"
                + "eventAt:pick('ctnr date','date'),"
                + "statusName:pick('status'),"
                + "depotName:pick('depot'),"
                + "voyage:pick('voyage'),"
                + "vesselName:pick('vessel'),"
                + "bookingRef:pick('more detail','booking','detail'),"
                + "rows:rows,"
                + "sourceUrl:location.href"
                + "};"
                + "YesWeighWanHai.onResult(JSON.stringify(payload));"
                + "return true;"
                + "}"
                + "return false;"
                + "}catch(e){return false;}"
                + "})();";
        webView.evaluateJavascript(js, value -> {
            if ("false".equals(value)) {
                // keep waiting; user can tap Track again
                trackButton.setEnabled(true);
            }
        });
    }

    private class Bridge {
        @JavascriptInterface
        public void onResult(String json) {
            runOnUiThread(() -> {
                try {
                    org.json.JSONObject obj = new org.json.JSONObject(json);
                    Intent data = new Intent();
                    data.putExtra(EXTRA_RESULT_CONTAINER, obj.optString("containerNumber", containerNumber));
                    data.putExtra(EXTRA_RESULT_STATUS, emptyToNull(obj.optString("statusName", null)));
                    data.putExtra(EXTRA_RESULT_DEPOT, emptyToNull(obj.optString("depotName", null)));
                    data.putExtra(EXTRA_RESULT_VOYAGE, emptyToNull(obj.optString("voyage", null)));
                    data.putExtra(EXTRA_RESULT_VESSEL, emptyToNull(obj.optString("vesselName", null)));
                    data.putExtra(EXTRA_RESULT_EVENT_AT, emptyToNull(obj.optString("eventAt", null)));
                    data.putExtra(EXTRA_RESULT_BOOKING, emptyToNull(obj.optString("bookingRef", null)));
                    data.putExtra(EXTRA_RESULT_ROWS_JSON, obj.optJSONArray("rows") != null
                        ? obj.optJSONArray("rows").toString()
                        : "[]");
                    data.putExtra(EXTRA_RESULT_SOURCE_URL, emptyToNull(obj.optString("sourceUrl", null)));
                    setResult(Activity.RESULT_OK, data);
                    Toast.makeText(WanHaiTrackActivity.this, "Wan Hai status captured", Toast.LENGTH_SHORT).show();
                    finish();
                } catch (Exception e) {
                    statusView.setText("Could not read results — try Track now again.");
                    trackButton.setEnabled(true);
                }
            });
        }
    }

    private static String emptyToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() || "null".equalsIgnoreCase(trimmed) ? null : trimmed;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        setResult(Activity.RESULT_CANCELED);
        super.onBackPressed();
    }
}
