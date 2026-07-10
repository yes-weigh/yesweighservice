package in.yesweigh.tcpprint;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "TcpPrint")
public class TcpPrintPlugin extends Plugin {
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @PluginMethod
    public void send(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port", 9100);
        String dataBase64 = call.getString("dataBase64");
        Integer timeoutMs = call.getInt("timeoutMs", 8000);

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
        final int resolvedTimeout = timeoutMs == null ? 8000 : Math.max(1000, timeoutMs);

        executor.execute(() -> {
            Socket socket = null;
            try {
                byte[] payload = Base64.decode(dataBase64, Base64.DEFAULT);
                if (payload.length == 0) {
                    call.reject("Decoded print payload is empty.");
                    return;
                }

                socket = new Socket();
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
                String message = e.getMessage();
                if (message == null || message.isEmpty()) {
                    message = e.getClass().getSimpleName();
                }
                call.reject("Could not reach printer at " + trimmedHost + ":" + resolvedPort + " — " + message);
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (Exception ignored) {
                        // no-op
                    }
                }
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
