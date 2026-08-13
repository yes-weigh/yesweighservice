package in.yesweigh.whatsappshare;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "WhatsAppShare")
public class WhatsAppSharePlugin extends Plugin {

    @PluginMethod
    public void shareImage(PluginCall call) {
        String dataBase64 = call.getString("dataBase64");
        String fileName = sanitizeFileName(call.getString("fileName", "share.png"), "share.png");
        String mimeType = sanitizeMime(call.getString("mimeType", "image/png"), "image/png");

        if (dataBase64 == null || dataBase64.isEmpty()) {
            call.reject("Image data is required.");
            return;
        }

        final String resolvedName = fileName;
        final String resolvedMime = mimeType;

        getActivity().runOnUiThread(() -> {
            try {
                byte[] bytes = decodeBase64(dataBase64);
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

                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(resolvedMime.startsWith("image/") ? "image/*" : resolvedMime);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.setClipData(ClipData.newRawUri(resolvedName, uri));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(send, "Share");
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(chooser);

                JSObject result = new JSObject();
                result.put("ok", true);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not open share sheet — " + errorMessage(e));
            }
        });
    }

    @PluginMethod
    public void saveImage(PluginCall call) {
        String url = call.getString("url");
        String dataBase64 = call.getString("dataBase64");
        String fileName = sanitizeFileName(call.getString("fileName", "product.jpg"), "product.jpg");
        String mimeType = sanitizeMime(call.getString("mimeType"), null);

        if ((url == null || url.trim().isEmpty()) && (dataBase64 == null || dataBase64.isEmpty())) {
            call.reject("Image URL or data is required.");
            return;
        }

        final String resolvedUrl = url != null ? url.trim() : "";
        final String resolvedBase64 = dataBase64;
        final String resolvedName = fileName;
        final String requestedMime = mimeType;

        new Thread(() -> {
            try {
                String mime = requestedMime;
                byte[] bytes;
                if (resolvedBase64 != null && !resolvedBase64.isEmpty()) {
                    bytes = decodeBase64(resolvedBase64);
                } else {
                    String[] mimeOut = new String[] { mime };
                    bytes = downloadUrl(resolvedUrl, mimeOut);
                    if (mimeOut[0] != null && !mimeOut[0].isEmpty()) {
                        mime = mimeOut[0];
                    }
                }
                if (mime == null || mime.isEmpty() || "application/octet-stream".equals(mime)) {
                    mime = mimeFromFileName(resolvedName);
                }

                Uri uri = saveBytesToGallery(bytes, resolvedName, mime);
                JSObject result = new JSObject();
                result.put("ok", true);
                result.put("uri", uri.toString());
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not save photo — " + errorMessage(e));
            }
        }, "yesweigh-save-image").start();
    }

    private Uri saveBytesToGallery(byte[] bytes, String fileName, String mimeType) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/YesWeigh");
            values.put(MediaStore.Images.Media.IS_PENDING, 1);

            Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            Uri uri = resolver.insert(collection, values);
            if (uri == null) {
                uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            }
            if (uri == null) {
                throw new Exception("Could not create gallery entry.");
            }
            try {
                try (OutputStream os = resolver.openOutputStream(uri)) {
                    if (os == null) {
                        throw new Exception("Could not write gallery file.");
                    }
                    os.write(bytes);
                    os.flush();
                }
                ContentValues pending = new ContentValues();
                pending.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, pending, null, null);
                return uri;
            } catch (Exception e) {
                resolver.delete(uri, null, null);
                throw e;
            }
        }

        File pictures = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
        File dir = new File(pictures, "YesWeigh");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new Exception("Could not create Pictures/YesWeigh.");
        }
        File out = new File(dir, fileName);
        try (FileOutputStream fos = new FileOutputStream(out)) {
            fos.write(bytes);
            fos.flush();
        }
        MediaScannerConnection.scanFile(
            getContext(),
            new String[] { out.getAbsolutePath() },
            new String[] { mimeType },
            null
        );
        return Uri.fromFile(out);
    }

    private static byte[] downloadUrl(String urlString, String[] mimeOut) throws Exception {
        URL url = new URL(urlString);
        int redirects = 0;
        while (true) {
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(45000);
            conn.setRequestProperty("Accept", "image/*,*/*");
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400 && redirects < 5) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null || loc.isEmpty()) {
                    throw new Exception("Download redirect missing location.");
                }
                url = new URL(url, loc);
                redirects += 1;
                continue;
            }
            if (code < 200 || code >= 300) {
                conn.disconnect();
                throw new Exception("Download failed (" + code + ").");
            }
            String contentType = conn.getContentType();
            if (contentType != null && mimeOut != null && mimeOut.length > 0) {
                int semi = contentType.indexOf(';');
                mimeOut[0] = (semi >= 0 ? contentType.substring(0, semi) : contentType).trim().toLowerCase();
            }
            try (InputStream in = conn.getInputStream()) {
                return readAll(in);
            } finally {
                conn.disconnect();
            }
        }
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    private static byte[] decodeBase64(String dataBase64) throws Exception {
        String payload = dataBase64.trim();
        int comma = payload.indexOf(',');
        if (payload.startsWith("data:") && comma >= 0) {
            payload = payload.substring(comma + 1);
        }
        byte[] bytes = Base64.decode(payload, Base64.DEFAULT);
        if (bytes.length == 0) {
            throw new Exception("Decoded image is empty.");
        }
        return bytes;
    }

    private static String sanitizeFileName(String fileName, String fallback) {
        if (fileName == null || fileName.trim().isEmpty()) {
            return fallback;
        }
        String cleaned = fileName.trim().replaceAll("[^a-zA-Z0-9._-]", "_");
        return cleaned.isEmpty() ? fallback : cleaned;
    }

    private static String sanitizeMime(String mimeType, String fallback) {
        if (mimeType == null || mimeType.trim().isEmpty()) {
            return fallback;
        }
        return mimeType.trim();
    }

    private static String mimeFromFileName(String fileName) {
        String lower = fileName.toLowerCase();
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        return "image/jpeg";
    }

    private static String errorMessage(Exception e) {
        String message = e.getMessage();
        if (message == null || message.isEmpty()) {
            return e.getClass().getSimpleName();
        }
        return message;
    }
}
