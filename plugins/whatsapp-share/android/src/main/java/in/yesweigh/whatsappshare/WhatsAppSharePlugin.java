package in.yesweigh.whatsappshare;

import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
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
import java.util.List;

@CapacitorPlugin(name = "WhatsAppShare")
public class WhatsAppSharePlugin extends Plugin {

    @PluginMethod
    public void shareImage(PluginCall call) {
        String dataBase64 = call.getString("dataBase64");
        String fileName = call.getString("fileName", "share.png");
        String mimeType = call.getString("mimeType", "image/png");
        String phoneRaw = call.getString("phone");
        String caption = call.getString("text", "");

        if (dataBase64 == null || dataBase64.isEmpty()) {
            call.reject("Image data is required.");
            return;
        }
        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = "share.png";
        }
        fileName = fileName.trim().replaceAll("[^a-zA-Z0-9._-]", "_");
        if (!fileName.contains(".")) {
            fileName = fileName + ".png";
        }
        if (mimeType == null || mimeType.trim().isEmpty()) {
            mimeType = "image/png";
        }

        // Unique name avoids stale/empty cached files being reused by WhatsApp.
        final String resolvedName = System.currentTimeMillis() + "-" + fileName;
        final String resolvedMime = mimeType.trim().startsWith("image/")
            ? mimeType.trim()
            : "image/png";
        final String phoneDigits = phoneRaw == null
            ? ""
            : phoneRaw.replaceAll("[^0-9]", "");
        final String resolvedCaption = caption == null ? "" : caption.trim();

        getActivity().runOnUiThread(() -> {
            try {
                byte[] bytes = Base64.decode(dataBase64, Base64.DEFAULT);
                if (bytes.length < 32) {
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
                    fos.getFD().sync();
                }

                if (!outFile.exists() || outFile.length() < 32) {
                    call.reject("Could not write share image.");
                    return;
                }

                Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    outFile
                );

                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(resolvedMime);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                if (!resolvedCaption.isEmpty()) {
                    send.putExtra(Intent.EXTRA_TEXT, resolvedCaption);
                }
                // ClipData is required so the system share sheet and targets can read the URI
                send.setClipData(ClipData.newUri(getContext().getContentResolver(), resolvedName, uri));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                // Explicit grants — without these WhatsApp often shows a blank attachment.
                grantReadToWhatsApp(uri);

                if (phoneDigits.length() >= 10) {
                    send.putExtra("jid", phoneDigits + "@s.whatsapp.net");
                    boolean opened = startWhatsAppSend(send);
                    if (!opened) {
                        // Image to a specific chat failed — open WhatsApp image share (contact picker).
                        send.removeExtra("jid");
                        send.setPackage("com.whatsapp");
                        if (!startActivitySafe(send)) {
                            send.setPackage("com.whatsapp.w4b");
                            if (!startActivitySafe(send)) {
                                call.reject("WhatsApp is not installed.");
                                return;
                            }
                        }
                    }
                } else {
                    Intent chooser = Intent.createChooser(send, "Share");
                    chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    getActivity().startActivity(chooser);
                }

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

    private void grantReadToWhatsApp(Uri uri) {
        int flags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
        try {
            getContext().grantUriPermission("com.whatsapp", uri, flags);
        } catch (Exception ignored) {
            // package may be absent
        }
        try {
            getContext().grantUriPermission("com.whatsapp.w4b", uri, flags);
        } catch (Exception ignored) {
            // package may be absent
        }

        Intent probe = new Intent(Intent.ACTION_SEND);
        probe.setType("image/*");
        probe.putExtra(Intent.EXTRA_STREAM, uri);
        List<ResolveInfo> matches = getContext().getPackageManager()
            .queryIntentActivities(probe, PackageManager.MATCH_DEFAULT_ONLY);
        for (ResolveInfo info : matches) {
            String pkg = info.activityInfo != null ? info.activityInfo.packageName : null;
            if (pkg == null) continue;
            if (!pkg.contains("whatsapp")) continue;
            try {
                getContext().grantUriPermission(pkg, uri, flags);
            } catch (Exception ignored) {
                // ignore
            }
        }
    }

    private boolean startWhatsAppSend(Intent send) {
        send.setPackage("com.whatsapp");
        if (startActivitySafe(send)) return true;
        send.setPackage("com.whatsapp.w4b");
        return startActivitySafe(send);
    }

    private boolean startActivitySafe(Intent intent) {
        try {
            getActivity().startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
