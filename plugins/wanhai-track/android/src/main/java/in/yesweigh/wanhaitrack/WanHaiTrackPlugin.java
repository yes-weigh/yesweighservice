package in.yesweigh.wanhaitrack;

import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WanHaiTrack")
public class WanHaiTrackPlugin extends Plugin {

    @PluginMethod
    public void track(PluginCall call) {
        String url = call.getString("url", "");
        String containerNumber = call.getString("containerNumber", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("Wan Hai tracking URL is required.");
            return;
        }
        if (containerNumber == null || containerNumber.trim().isEmpty()) {
            call.reject("Container number is required.");
            return;
        }

        Intent intent = new Intent(getContext(), WanHaiTrackActivity.class);
        intent.putExtra(WanHaiTrackActivity.EXTRA_URL, url.trim());
        intent.putExtra(WanHaiTrackActivity.EXTRA_CONTAINER, containerNumber.trim().toUpperCase());
        startActivityForResult(call, intent, "onTrackResult");
    }

    @ActivityCallback
    private void onTrackResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Wan Hai tracking cancelled.");
            return;
        }
        Intent data = result.getData();
        JSObject out = new JSObject();
        out.put("ok", true);
        out.put("containerNumber", data.getStringExtra(WanHaiTrackActivity.EXTRA_RESULT_CONTAINER));
        out.put("statusName", data.getStringExtra(WanHaiTrackActivity.EXTRA_RESULT_STATUS));
        out.put("depotName", data.getStringExtra(WanHaiTrackActivity.EXTRA_RESULT_DEPOT));
        out.put("voyage", data.getStringExtra(WanHaiTrackActivity.EXTRA_RESULT_VOYAGE));
        out.put("vesselName", data.getStringExtra(WanHaiTrackActivity.EXTRA_RESULT_VESSEL));
        out.put("eventAt", data.getStringExtra(WanHaiTrackActivity.EXTRA_RESULT_EVENT_AT));
        out.put("bookingRef", data.getStringExtra(WanHaiTrackActivity.EXTRA_RESULT_BOOKING));
        out.put("rowsJson", data.getStringExtra(WanHaiTrackActivity.EXTRA_RESULT_ROWS_JSON));
        out.put("sourceUrl", data.getStringExtra(WanHaiTrackActivity.EXTRA_RESULT_SOURCE_URL));
        call.resolve(out);
    }
}
