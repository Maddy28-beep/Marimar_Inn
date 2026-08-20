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
 * Cheap printers often drop an idle socket, so each print job reconnects.
 */
class PrinterBridge {
    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private val executor = Executors.newSingleThreadExecutor()
    private var socket: BluetoothSocket? = null
    private var output: OutputStream? = null
    private var lastMac: String? = null

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
            val result = connectLocked(mac)
            if (result == "ok") {
                lastMac = mac
            }
            result
        }
    }

    @SuppressLint("MissingPermission")
    private fun connectLocked(mac: String): String {
        disconnectLocked()
        val adapter = BluetoothAdapter.getDefaultAdapter()
            ?: return "Bluetooth is not available on this tablet."
        if (!adapter.isEnabled) return "Turn Bluetooth on first."
        try {
            adapter.cancelDiscovery()
        } catch (_: SecurityException) {
            // Connecting to an already-paired printer still works without this.
        }
        val device = adapter.getRemoteDevice(mac)
        val connected = tryConnect(device, insecure = true)
            ?: tryConnect(device, insecure = false)
            ?: tryConnectRfcommChannel(device)
            ?: return "Couldn't open the printer. Pair it in Android Settings → Bluetooth, then try again."
        socket = connected
        output = connected.outputStream
        lastMac = mac
        Thread.sleep(400)
        return "ok"
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
            if (candidate.isConnected) candidate else null
        } catch (_: Exception) {
            null
        }
    }

    @SuppressLint("MissingPermission")
    private fun tryConnectRfcommChannel(device: BluetoothDevice): BluetoothSocket? {
        return try {
            val method = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
            val candidate = method.invoke(device, 1) as BluetoothSocket
            candidate.connect()
            if (candidate.isConnected) candidate else null
        } catch (_: Exception) {
            null
        }
    }

    @JavascriptInterface
    fun writeBase64(data: String?): String {
        return runOnPrinterThread {
            val mac = lastMac ?: return@runOnPrinterThread "Printer is not connected. Tap the printer icon and connect again."
            if (data.isNullOrEmpty()) return@runOnPrinterThread "Nothing to print."
            fun sendOnce(): String {
                val reopened = connectLocked(mac)
                if (reopened != "ok") return reopened
                return writeLocked(data)
            }
            try {
                sendOnce()
            } catch (error: Exception) {
                try {
                    sendOnce()
                } catch (retryError: Exception) {
                    retryError.message ?: error.message ?: "Print failed."
                }
            }
        }
    }

    @JavascriptInterface
    fun printTest(): String {
        val quality = byteArrayOf(
            0x1B, 0x40,
            0x1B, 0x4D, 0x00,
            0x12, 0x23, 0x08,
            0x1B, 0x45, 0x01,
            0x1B, 0x61, 0x01,
        )
        val body = "Marimar Inn\nPrinter test\n\n"
        val bytes = quality +
            body.toByteArray(Charsets.US_ASCII) +
            byteArrayOf(0x0A, 0x0A, 0x1D, 0x56, 0x41, 0x03)
        return writeBase64(Base64.encodeToString(bytes, Base64.NO_WRAP))
    }

    private fun writeLocked(data: String): String {
        val stream = output ?: return "Printer is not connected. Tap the printer icon and connect again."
        val bytes = Base64.decode(data, Base64.DEFAULT)
        if (bytes.isEmpty()) return "Nothing to print."
        stream.write(bytes)
        stream.flush()
        // Let the head finish a slow, dark pass before we return — disconnecting
        // while it's still heating made the last lines look washed out.
        val waitMs = (800 + bytes.size * 6).coerceIn(1200, 8000)
        Thread.sleep(waitMs.toLong())
        return "ok"
    }

    @JavascriptInterface
    fun kickDrawer(): String {
        return runOnPrinterThread {
            val mac = lastMac ?: return@runOnPrinterThread "Printer is not connected. Tap the printer icon and connect again."
            val reopened = connectLocked(mac)
            if (reopened != "ok") return@runOnPrinterThread reopened
            val stream = output ?: return@runOnPrinterThread "Printer is not connected. Tap the printer icon and connect again."
            fun write(bytes: ByteArray) {
                stream.write(bytes)
                stream.flush()
            }
            // Pin 5 + a printed line first — Jingpu/Gprinter clones discard a
            // kick-only write, and they wire the solenoid to pin 5.
            write(
                byteArrayOf(0x1B, 0x40, 0x1B, 0x61, 0x01) +
                    "Drawer\n".toByteArray(Charsets.US_ASCII) +
                    byteArrayOf(0x07, 0x1B, 0x70, 0x01, 0xFF.toByte(), 0xFF.toByte(), 0x0A)
            )
            Thread.sleep(800)
            write(byteArrayOf(0x1B, 0x40, 0x07, 0x1B, 0x70, 0x00, 0xFF.toByte(), 0xFF.toByte(), 0x0A))
            Thread.sleep(600)
            "ok"
        }
    }

    @JavascriptInterface
    fun disconnect(): String {
        return runOnPrinterThread {
            lastMac = null
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
            future.get(40, TimeUnit.SECONDS)
        } catch (_: Exception) {
            "Printer didn't respond in time."
        }
    }
}
