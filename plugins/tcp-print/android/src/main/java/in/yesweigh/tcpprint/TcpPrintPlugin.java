package in.yesweigh.tcpprint;

import android.Manifest;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "TcpPrint",
    permissions = {
        @Permission(
            alias = "nearbyWifi",
            strings = { Manifest.permission.NEARBY_WIFI_DEVICES }
        )
    }
)
public class TcpPrintPlugin extends Plugin {
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @PluginMethod
    public void probe(PluginCall call) {
        if (requestNearbyIfNeeded(call, "onNearbyForProbe")) {
            return;
        }
        executeProbe(call);
    }

    @PermissionCallback
    private void onNearbyForProbe(PluginCall call) {
        executeProbe(call);
    }

    @PluginMethod
    public void send(PluginCall call) {
        if (requestNearbyIfNeeded(call, "onNearbyForSend")) {
            return;
        }
        executeSend(call);
    }

    @PermissionCallback
    private void onNearbyForSend(PluginCall call) {
        executeSend(call);
    }

    /**
     * Android 13+ Nearby devices / local-network prompt. Denied still tries TCP
     * (INTERNET is enough on many devices).
     */
    private boolean requestNearbyIfNeeded(PluginCall call, String callback) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return false;
        }
        if (getPermissionState("nearbyWifi") == PermissionState.GRANTED) {
            return false;
        }
        requestPermissionForAlias("nearbyWifi", call, callback);
        return true;
    }

    private void executeProbe(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port", 9100);
        Integer timeoutMs = call.getInt("timeoutMs", 4000);

        if (host == null || host.trim().isEmpty()) {
            call.reject("Printer host (IP) is required.");
            return;
        }
        if (port == null || port < 1 || port > 65535) {
            call.reject("Printer port must be between 1 and 65535.");
            return;
        }

        final String trimmedHost = host.trim();
        final int resolvedPort = port;
        final int resolvedTimeout = timeoutMs == null ? 4000 : Math.max(500, timeoutMs);

        executor.execute(() -> {
            Socket socket = null;
            try {
                socket = openLanSocket();
                socket.connect(new InetSocketAddress(trimmedHost, resolvedPort), resolvedTimeout);
                JSObject result = new JSObject();
                result.put("ok", true);
                result.put("host", trimmedHost);
                result.put("port", resolvedPort);
                call.resolve(result);
            } catch (Exception e) {
                call.reject(reachError(trimmedHost, resolvedPort, e));
            } finally {
                closeQuietly(socket);
            }
        });
    }

    private void executeSend(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port", 9100);
        String dataBase64 = call.getString("dataBase64");
        Integer timeoutMs = call.getInt("timeoutMs", 15000);

        if (host == null || host.trim().isEmpty()) {
            call.reject("Printer host (IP) is required.");
            return;
        }
        if (dataBase64 == null || dataBase64.isEmpty()) {
            call.reject("Print data is required.");
            return;
        }
        if (port == null || port < 1 || port > 65535) {
            call.reject("Printer port must be between 1 and 65535.");
            return;
        }

        final String trimmedHost = host.trim();
        final int resolvedPort = port;
        final int resolvedTimeout = timeoutMs == null ? 15000 : Math.max(1000, timeoutMs);

        executor.execute(() -> {
            Socket socket = null;
            try {
                byte[] payload = Base64.decode(dataBase64, Base64.DEFAULT);
                if (payload.length == 0) {
                    call.reject("Decoded print payload is empty.");
                    return;
                }

                socket = openLanSocket();
                socket.connect(new InetSocketAddress(trimmedHost, resolvedPort), resolvedTimeout);
                socket.setSoTimeout(resolvedTimeout);
                OutputStream out = socket.getOutputStream();
                out.write(payload);
                out.flush();

                JSObject result = new JSObject();
                result.put("ok", true);
                result.put("bytesSent", payload.length);
                call.resolve(result);
            } catch (Exception e) {
                call.reject(reachError(trimmedHost, resolvedPort, e));
            } finally {
                closeQuietly(socket);
            }
        });
    }

    /**
     * Bind TCP to Wi‑Fi. With mobile data on, the default network is often
     * cellular, so LAN printer IPs time out ("No logistics printer reachable").
     */
    private Socket openLanSocket() throws Exception {
        Network wifi = findWifiNetwork();
        if (wifi != null) {
            return wifi.getSocketFactory().createSocket();
        }
        return new Socket();
    }

    private Network findWifiNetwork() {
        Context context = getContext();
        if (context == null) return null;
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return null;
        Network[] networks = cm.getAllNetworks();
        if (networks == null) return null;
        Network fallback = null;
        for (Network network : networks) {
            NetworkCapabilities caps = cm.getNetworkCapabilities(network);
            if (caps == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                continue;
            }
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
                || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)) {
                if (fallback == null) fallback = network;
                continue;
            }
            return network;
        }
        return fallback;
    }

    private static String reachError(String host, int port, Exception e) {
        String message = e.getMessage();
        if (message == null || message.isEmpty()) {
            message = e.getClass().getSimpleName();
        }
        return "Could not reach printer at " + host + ":" + port + " — " + message
            + ". Use the YesOne APK on the printer Wi‑Fi, allow Nearby devices, "
            + "and turn VPN off. If mobile data is on, retry after this app update.";
    }

    private static void closeQuietly(Socket socket) {
        if (socket == null) return;
        try {
            socket.close();
        } catch (Exception ignored) {
            // no-op
        }
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
