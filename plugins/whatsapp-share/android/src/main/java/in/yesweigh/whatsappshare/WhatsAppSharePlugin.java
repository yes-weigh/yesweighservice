package in.yesweigh.whatsappshare;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

@CapacitorPlugin(name = "WhatsAppShare")
public class WhatsAppSharePlugin extends Plugin {
    private static final String PKG_WHATSAPP = "com.whatsapp";
    private static final String PKG_WHATSAPP_BUSINESS = "com.whatsapp.w4b";

    @PluginMethod
    public void shareImage(PluginCall call) {
        String dataBase64 = call.getString("dataBase64");
        String fileName = call.getString("fileName", "share.png");
        String mimeType = call.getString("mimeType", "image/png");

        if (dataBase64 == null || dataBase64.isEmpty()) {
            call.reject("Image data is required.");
            return;
        }
        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = "share.png";
        }
        fileName = fileName.trim().replaceAll("[^a-zA-Z0-9._-]", "_");
        if (mimeType == null || mimeType.trim().isEmpty()) {
            mimeType = "image/png";
        }

        final String resolvedName = fileName;
        final String resolvedMime = mimeType.trim();

        getActivity().runOnUiThread(() -> {
            try {
                String packageName = resolveWhatsAppPackage();
                if (packageName == null) {
                    call.reject("WhatsApp is not installed.");
                    return;
                }

                byte[] bytes = Base64.decode(dataBase64, Base64.DEFAULT);
                if (bytes.length == 0) {
                    call.reject("Decoded image is empty.");
                    return;
                }

                File cacheDir = new File(getContext().getCacheDir(), "whatsapp-share");
                if (!cacheDir.exists() && !cacheDir.mkdirs()) {
                    call.reject("Could not create share cache.");
                    return;
                }

                File outFile = new File(cacheDir, resolvedName);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(bytes);
                    fos.flush();
                }

                Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    outFile
                );

                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType(resolvedMime);
                intent.setPackage(packageName);
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                getActivity().startActivity(intent);

                JSObject result = new JSObject();
                result.put("ok", true);
                call.resolve(result);
            } catch (Exception e) {
                String message = e.getMessage();
                if (message == null || message.isEmpty()) {
                    message = e.getClass().getSimpleName();
                }
                call.reject("Could not open WhatsApp — " + message);
            }
        });
    }

    private String resolveWhatsAppPackage() {
        PackageManager pm = getContext().getPackageManager();
        if (isInstalled(pm, PKG_WHATSAPP)) {
            return PKG_WHATSAPP;
        }
        if (isInstalled(pm, PKG_WHATSAPP_BUSINESS)) {
            return PKG_WHATSAPP_BUSINESS;
        }
        return null;
    }

    private boolean isInstalled(PackageManager pm, String packageName) {
        try {
            pm.getPackageInfo(packageName, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
