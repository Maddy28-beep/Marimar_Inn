package ph.marimarinn.app

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Classic Bluetooth SPP bridge — same path the working Flutter POS APK uses
 * (`00001101-0000-1000-8000-00805F9B34FB`, insecure then secure socket).
 * Chrome cannot do this; that's why "connected" in the browser still prints nothing.
 */
class PrinterBridge {
    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private val executor = Executors.newSingleThreadExecutor()
    private var socket: BluetoothSocket? = null
    private var output: OutputStream? = null

    @JavascriptInterface
    fun isNative(): Boolean = true

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun listPairedJson(): String {
        val adapter = BluetoothAdapter.getDefaultAdapter() ?: return "[]"
        val list = JSONArray()
        adapter.bondedDevices?.forEach { device ->
            val obj = JSONObject()
            obj.put("id", device.address)
            obj.put("name", device.name ?: device.address)
            list.put(obj)
        }
        return list.toString()
    }

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun connect(mac: String): String {
        return runOnPrinterThread {
            disconnectLocked()
            val adapter = BluetoothAdapter.getDefaultAdapter()
                ?: return@runOnPrinterThread "Bluetooth is not available on this tablet."
            if (!adapter.isEnabled) return@runOnPrinterThread "Turn Bluetooth on first."
            try {
                adapter.cancelDiscovery()
            } catch (_: SecurityException) {
                // BLUETOOTH_SCAN may be missing on first run — connecting to an
                // already-paired printer still works without cancelling discovery.
            }
            val device = adapter.getRemoteDevice(mac)
            val connected = tryConnect(device, insecure = true)
                ?: tryConnect(device, insecure = false)
                ?: return@runOnPrinterThread "Couldn't open the printer. Pair it in Android Settings → Bluetooth, then try again."
            socket = connected
            output = connected.outputStream
            "ok"
        }
    }

    @SuppressLint("MissingPermission")
    private fun tryConnect(device: BluetoothDevice, insecure: Boolean): BluetoothSocket? {
        return try {
            val candidate = if (insecure) {
                device.createInsecureRfcommSocketToServiceRecord(sppUuid)
            } else {
                device.createRfcommSocketToServiceRecord(sppUuid)
            }
            candidate.connect()
            candidate
        } catch (_: Exception) {
            null
        }
    }

    @JavascriptInterface
    fun writeBase64(data: String): String {
        return runOnPrinterThread {
            val stream = output ?: return@runOnPrinterThread "Printer is not connected."
            val bytes = Base64.decode(data, Base64.DEFAULT)
            var offset = 0
            while (offset < bytes.size) {
                val end = minOf(offset + 256, bytes.size)
                stream.write(bytes, offset, end - offset)
                stream.flush()
                offset = end
                Thread.sleep(20)
            }
            "ok"
        }
    }

    @JavascriptInterface
    fun disconnect(): String {
        return runOnPrinterThread {
            disconnectLocked()
            "ok"
        }
    }

    private fun disconnectLocked() {
        try {
            output?.close()
        } catch (_: Exception) {
        }
        try {
            socket?.close()
        } catch (_: Exception) {
        }
        output = null
        socket = null
    }

    private fun runOnPrinterThread(block: () -> String): String {
        val future = executor.submit<String> {
            try {
                block()
            } catch (error: Exception) {
                error.message ?: "Printer error."
            }
        }
        return try {
            future.get(20, TimeUnit.SECONDS)
        } catch (_: Exception) {
            "Printer didn't respond in time."
        }
    }
}
