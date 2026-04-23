import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import JSZip from "jszip";
import { Client as FTPClient } from "basic-ftp";
import { BambuPrinter } from "bambu-js";
import * as mqtt from "mqtt";
import { BambuClient, GCodeFileCommand, GCodeLineCommand, PushAllCommand, UpdateStateCommand, } from "bambu-node";
/**
 * Post-Jan-2025 H2D firmware requires mTLS with a Bambu-issued client cert.
 * Loads cert+key once from:
 *   - BAMBU_CLIENT_CERT / BAMBU_CLIENT_KEY env vars (paths), or
 *   - ~/Desktop/bambu certs/embedded-cert.pem + embedded-key.pem (default)
 * Returns null if files missing — caller falls back to no-cert TLS.
 */
function loadClientCreds() {
    const defaultDir = path.join(os.homedir(), "Desktop", "bambu certs");
    const certPath = process.env.BAMBU_CLIENT_CERT || path.join(defaultDir, "embedded-cert.pem");
    const keyPath = process.env.BAMBU_CLIENT_KEY || path.join(defaultDir, "embedded-key.pem");
    try {
        if (!existsSync(certPath) || !existsSync(keyPath))
            return null;
        return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
    }
    catch {
        return null;
    }
}
const CLIENT_CREDS = loadClientCreds();
const COMMAND_SETTLE_MS = 300;
const MODEL_ID_TO_NAME = {
    O1D: "H2D",
    O1E: "H2D Pro",
    O1S: "H2S",
    N2S: "A1",
    A1M: "A1 Mini",
    C11: "P1P",
    C12: "P1S",
    "BL-P001": "X1C",
    "BL-P002": "X1",
    C13: "X1E",
};
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function resolveModelName(data) {
    const modelId = `${data?.model_id ?? ""}`.toUpperCase();
    return (MODEL_ID_TO_NAME[modelId] ||
        data?.model ||
        data?.device?.devModel ||
        data?.device?.dev_model ||
        "Unknown");
}
async function invokeWithoutAck(printer, command) {
    await command.invoke(printer);
    await sleep(COMMAND_SETTLE_MS);
}
function getPrinterKey(host, serial, token) {
    return `${host}-${serial}-${token}`;
}
class TolerantBambuClient extends BambuClient {
    /**
     * H2D-class firmware streams push status immediately after subscribe, but
     * never answers bambu-node's initial get_version round-trip. Avoid treating
     * that missing ACK as a failed connection.
     */
    async onConnect() {
        const subscribe = this.subscribe.bind(this);
        await subscribe(`device/${this.config.serialNumber}/report`);
    }
    /**
     * H2S/H2D printers don't respond to get_version with module info.
     * Infer model from serial number prefix so downstream code (Job, status
     * parsing, etc.) has a valid printerModel instead of undefined.
     */
    inferModelFromSerial() {
        const sn = this.config.serialNumber;
        if (sn.startsWith("093"))
            return "H2S";
        if (sn.startsWith("094"))
            return "H2D";
        if (sn.startsWith("00M"))
            return "X1C";
        if (sn.startsWith("00W"))
            return "X1";
        if (sn.startsWith("03W"))
            return "X1E";
        if (sn.startsWith("01S"))
            return "P1P";
        if (sn.startsWith("01P"))
            return "P1S";
        if (sn.startsWith("030"))
            return "A1";
        if (sn.startsWith("039"))
            return "A1M";
        return undefined;
    }
    /**
     * Override bambu-node's MQTT connect to pass a client cert+key for mTLS.
     * Post-Jan-2025 H2D firmware rejects TLS handshakes without a valid Bambu-
     * issued client certificate. Options mirror the upstream implementation
     * plus `cert`/`key` when creds are available.
     */
    async connect() {
        await new Promise((resolve, reject) => {
            const self = this;
            if (self.mqttClient) {
                throw new Error("Can't establish a new connection while running another one!");
            }
            const tlsOpts = {
                username: "bblp",
                password: self.config.accessToken,
                reconnectPeriod: self.clientOptions.reconnectInterval,
                connectTimeout: self.clientOptions.connectTimeout,
                keepalive: self.clientOptions.keepAlive,
                resubscribe: true,
                rejectUnauthorized: false,
            };
            if (CLIENT_CREDS) {
                tlsOpts.cert = CLIENT_CREDS.cert;
                tlsOpts.key = CLIENT_CREDS.key;
            }
            const client = mqtt.connect(`mqtts://${self.config.host}:${self.config.port}`, tlsOpts);
            self.mqttClient = client;
            client.on("connect", async (...args) => {
                try {
                    await self.onConnect(...args);
                    self.emit("client:connect");
                    resolve();
                }
                catch (e) {
                    reject(e);
                }
            });
            client.on("disconnect", () => {
                self.emit("client:disconnect", false);
                self.emit("printer:statusUpdate", self._printerStatus, "OFFLINE");
                self._printerStatus = "OFFLINE";
                if (self.currentJob)
                    self.emit("job:pause", self.currentJob, true);
            });
            client.on("offline", () => {
                self.emit("client:disconnect", true);
                self.emit("printer:statusUpdate", self._printerStatus, "OFFLINE");
                self._printerStatus = "OFFLINE";
                if (self.currentJob)
                    self.emit("job:pause", self.currentJob, true);
            });
            client.on("message", (topic, payload) => self.emit("rawMessage", topic, payload));
            client.on("error", (err) => {
                self.emit("client:error", err);
                reject(err);
            });
        });
        // H2S/H2D printers don't respond to get_version with module info.
        // Infer model from serial number prefix so downstream code works.
        if (!this.data.model) {
            const inferred = this.inferModelFromSerial();
            if (inferred) {
                this.data.model = inferred;
                this.emit("printer:dataUpdate", this.data, { model: inferred });
            }
        }
        return [undefined];
    }
}
/** Build FTPS secureOptions that include the client cert+key when available. */
function ftpsSecureOptions() {
    const opts = { rejectUnauthorized: false };
    if (CLIENT_CREDS) {
        opts.cert = CLIENT_CREDS.cert;
        opts.key = CLIENT_CREDS.key;
    }
    return opts;
}
class BambuClientStore {
    constructor() {
        this.printers = new Map();
        this.initialConnectionPromises = new Map();
        this.reportSnapshots = new Map();
        this.initialReportPromises = new Map();
        this.initialReportResolvers = new Map();
    }
    ensureInitialReportPromise(key) {
        const existing = this.initialReportPromises.get(key);
        if (existing) {
            return existing;
        }
        const promise = new Promise((resolve) => {
            this.initialReportResolvers.set(key, resolve);
        });
        this.initialReportPromises.set(key, promise);
        return promise;
    }
    resolveInitialReport(key) {
        const resolve = this.initialReportResolvers.get(key);
        if (!resolve) {
            return;
        }
        this.initialReportResolvers.delete(key);
        resolve();
    }
    updateReportSnapshot(key, update) {
        if (!update || Object.keys(update).length === 0) {
            return;
        }
        const previous = this.reportSnapshots.get(key) || {};
        this.reportSnapshots.set(key, { ...previous, ...update });
        this.resolveInitialReport(key);
    }
    getCachedReport(host, serial, token) {
        return this.reportSnapshots.get(getPrinterKey(host, serial, token)) || null;
    }
    async waitForInitialReport(host, serial, token, timeoutMs = 4000) {
        const key = getPrinterKey(host, serial, token);
        const existing = this.reportSnapshots.get(key);
        if (existing && Object.keys(existing).length > 0) {
            return existing;
        }
        const reportPromise = this.ensureInitialReportPromise(key);
        try {
            await Promise.race([
                reportPromise,
                sleep(timeoutMs).then(() => {
                    throw new Error(`Timed out waiting for initial printer report after ${timeoutMs}ms.`);
                }),
            ]);
        }
        catch (error) {
            console.warn(`No initial printer report received for ${serial}:`, error);
        }
        return this.reportSnapshots.get(key) || null;
    }
    async getPrinter(host, serial, token) {
        const key = getPrinterKey(host, serial, token);
        if (this.printers.has(key)) {
            return this.printers.get(key);
        }
        if (this.initialConnectionPromises.has(key)) {
            await this.initialConnectionPromises.get(key);
            if (this.printers.has(key)) {
                return this.printers.get(key);
            }
            throw new Error(`Existing Bambu client connection for ${key} failed.`);
        }
        const printer = new TolerantBambuClient({
            host,
            serialNumber: serial,
            accessToken: token,
        });
        this.ensureInitialReportPromise(key);
        printer.on("rawMessage", (_topic, payload) => {
            try {
                const parsed = JSON.parse(payload.toString());
                const printMessage = parsed?.print;
                if (printMessage && typeof printMessage === "object") {
                    this.updateReportSnapshot(key, printMessage);
                }
            }
            catch {
                // Ignore unrelated payloads.
            }
        });
        printer.on("printer:dataUpdate", (data) => {
            this.updateReportSnapshot(key, data);
        });
        printer.on("client:connect", () => {
            this.printers.set(key, printer);
            this.initialConnectionPromises.delete(key);
        });
        printer.on("client:error", () => {
            this.printers.delete(key);
            this.initialConnectionPromises.delete(key);
            this.initialReportPromises.delete(key);
            this.initialReportResolvers.delete(key);
        });
        printer.on("client:disconnect", () => {
            this.printers.delete(key);
            this.initialConnectionPromises.delete(key);
            this.initialReportPromises.delete(key);
            this.initialReportResolvers.delete(key);
        });
        const connectPromise = printer.connect().then(() => { });
        this.initialConnectionPromises.set(key, connectPromise);
        try {
            await connectPromise;
            return printer;
        }
        catch (error) {
            this.initialConnectionPromises.delete(key);
            throw error;
        }
    }
    async disconnectAll() {
        const disconnectPromises = [];
        for (const printer of this.printers.values()) {
            disconnectPromises.push((async () => {
                try {
                    await printer.disconnect();
                }
                catch (error) {
                    console.error("Failed to disconnect Bambu client", error);
                }
            })());
        }
        await Promise.allSettled(disconnectPromises);
        this.printers.clear();
        this.initialConnectionPromises.clear();
        this.initialReportPromises.clear();
        this.initialReportResolvers.clear();
    }
}
export class BambuImplementation {
    constructor() {
        this.printerStore = new BambuClientStore();
    }
    async getPrinter(host, serial, token) {
        return this.printerStore.getPrinter(host, serial, token);
    }
    async resolveProjectFileMetadata(localThreeMfPath, plateIndex) {
        const archive = await fs.readFile(localThreeMfPath);
        const zip = await JSZip.loadAsync(archive);
        const plateEntries = Object.values(zip.files).filter((entry) => !entry.dir && /^Metadata\/plate_\d+\.gcode$/i.test(entry.name));
        if (plateEntries.length === 0) {
            throw new Error("3MF does not contain any Metadata/plate_<n>.gcode entries. Re-slice and export a printable 3MF.");
        }
        let selectedEntry = plateEntries.sort((a, b) => a.name.localeCompare(b.name))[0];
        if (plateIndex !== undefined) {
            const expectedEntryName = `Metadata/plate_${plateIndex + 1}.gcode`;
            const matchedEntry = plateEntries.find((entry) => entry.name.toLowerCase() === expectedEntryName.toLowerCase());
            if (!matchedEntry) {
                const available = plateEntries.map((entry) => entry.name).join(", ");
                throw new Error(`Requested plateIndex=${plateIndex} (${expectedEntryName}) not present in 3MF. Available: ${available}`);
            }
            selectedEntry = matchedEntry;
        }
        const gcodeBuffer = await selectedEntry.async("nodebuffer");
        const md5 = createHash("md5").update(gcodeBuffer).digest("hex");
        return {
            plateFileName: path.posix.basename(selectedEntry.name),
            plateInternalPath: selectedEntry.name,
            md5,
        };
    }
    async getStatus(host, serial, token) {
        try {
            const printer = await this.getPrinter(host, serial, token);
            try {
                await invokeWithoutAck(printer, new PushAllCommand());
            }
            catch (error) {
                console.warn("PushAllCommand failed, continuing with cached status", error);
            }
            const cachedData = await this.printerStore.waitForInitialReport(host, serial, token);
            const data = cachedData && Object.keys(cachedData).length > 0
                ? cachedData
                : printer.data;
            return {
                status: data.gcode_state || "UNKNOWN",
                connected: true,
                temperatures: {
                    nozzle: {
                        actual: data.nozzle_temper || 0,
                        target: data.nozzle_target_temper || 0,
                    },
                    bed: {
                        actual: data.bed_temper || 0,
                        target: data.bed_target_temper || 0,
                    },
                    chamber: data.chamber_temper || data.frame_temper || 0,
                },
                print: {
                    filename: data.subtask_name || data.gcode_file || "None",
                    progress: data.mc_percent || 0,
                    timeRemaining: data.mc_remaining_time || 0,
                    currentLayer: data.layer_num || 0,
                    totalLayers: data.total_layer_num || 0,
                },
                ams: data.ams || null,
                model: resolveModelName(data),
                serial,
                raw: data,
            };
        }
        catch (error) {
            console.error(`Failed to get Bambu status for ${serial}:`, error);
            return { status: "error", connected: false, error: error.message };
        }
    }
    async print3mf(host, serial, token, options) {
        if (!options.filePath.toLowerCase().endsWith(".3mf")) {
            throw new Error("print3mf requires a .3mf input file.");
        }
        const remoteFileName = path.basename(options.filePath);
        const remoteProjectPath = `cache/${remoteFileName}`;
        // Upload via basic-ftp directly (bypasses bambu-js double-path bug)
        await this.ftpUpload(host, token, options.filePath, `/cache/${remoteFileName}`);
        // Pre-sliced .gcode.3mf files contain embedded gcode and must be started
        // with gcode_file, not project_file — project_file tries to parse slicer
        // metadata that isn't present in .gcode.3mf and returns error 405004002.
        if (options.filePath.toLowerCase().endsWith(".gcode.3mf")) {
            const printer = await this.getPrinter(host, serial, token);
            await invokeWithoutAck(printer, new GCodeFileCommand({ fileName: remoteProjectPath }));
            return {
                status: "success",
                message: `Uploaded and started gcode.3mf print: ${options.projectName}`,
                remoteProjectPath,
            };
        }
        const projectMetadata = await this.resolveProjectFileMetadata(options.filePath, options.plateIndex);
        // Send project_file command via bambu-node MQTT (bypasses bambu-js
        // hardcoded use_ams=true and missing ams_mapping support)
        const printer = await this.getPrinter(host, serial, token);
        const md5 = options.md5 ?? projectMetadata.md5;
        // Build AMS mapping per OpenBambuAPI spec: 5-element array
        // [-1,-1,-1,-1,0] means slot 0 only; pad unused slots with -1
        let amsMapping;
        if (options.amsMapping && options.amsMapping.length > 0) {
            amsMapping = Array.from({ length: 5 }, (_, i) => i < options.amsMapping.length ? options.amsMapping[i] : -1);
        }
        else {
            amsMapping = [-1, -1, -1, -1, 0];
        }
        const projectFileCmd = {
            print: {
                command: "project_file",
                param: `Metadata/${projectMetadata.plateFileName}`,
                url: `file:///sdcard/${remoteProjectPath}`,
                subtask_name: options.projectName,
                md5,
                flow_cali: options.flowCalibration ?? true,
                layer_inspect: options.layerInspect ?? true,
                vibration_cali: options.vibrationCalibration ?? true,
                bed_leveling: options.bedLeveling ?? true,
                bed_type: options.bedType || "textured_plate",
                timelapse: options.timelapse ?? false,
                use_ams: options.useAMS !== false,
                ams_mapping: amsMapping,
                profile_id: "0",
                project_id: "0",
                sequence_id: "0",
                subtask_id: "0",
                task_id: "0",
            },
        };
        await printer.publish(projectFileCmd);
        await new Promise((resolve) => setTimeout(resolve, 300));
        return {
            status: "success",
            message: `Uploaded and started 3MF print: ${options.projectName}`,
            remoteProjectPath,
            plateFile: projectMetadata.plateFileName,
            platePath: projectMetadata.plateInternalPath,
            md5,
            amsMapping,
        };
    }
    async cancelJob(host, serial, token) {
        const printer = await this.getPrinter(host, serial, token);
        try {
            await invokeWithoutAck(printer, new UpdateStateCommand({ state: "stop" }));
            return { status: "success", message: "Cancel command sent successfully." };
        }
        catch (error) {
            throw new Error(`Failed to cancel print: ${error.message}`);
        }
    }
    async setTemperature(host, serial, token, component, temperature) {
        const printer = await this.getPrinter(host, serial, token);
        const normalizedComponent = component.toLowerCase();
        const targetTemperature = Math.round(temperature);
        if (targetTemperature < 0 || targetTemperature > 300) {
            throw new Error("Temperature must be between 0 and 300°C.");
        }
        let gcode;
        if (normalizedComponent === "bed") {
            gcode = `M140 S${targetTemperature}`;
        }
        else if (normalizedComponent === "extruder" ||
            normalizedComponent === "nozzle" ||
            normalizedComponent === "tool" ||
            normalizedComponent === "tool0") {
            gcode = `M104 S${targetTemperature}`;
        }
        else {
            throw new Error(`Unsupported temperature component: ${component}. Use one of: bed, nozzle, extruder.`);
        }
        await invokeWithoutAck(printer, new GCodeLineCommand({ gcodes: [gcode] }));
        return {
            status: "success",
            message: `Temperature command sent for ${normalizedComponent}.`,
            command: gcode,
        };
    }
    async getFiles(host, serial, token) {
        const printer = new BambuPrinter(host, serial, token);
        const directories = ["cache", "timelapse", "logs"];
        const filesByDirectory = {};
        await printer.manipulateFiles(async (context) => {
            for (const directory of directories) {
                try {
                    filesByDirectory[directory] = await context.readDir(directory);
                }
                catch {
                    filesByDirectory[directory] = [];
                }
            }
        });
        const files = Object.entries(filesByDirectory).flatMap(([directory, names]) => names.map((name) => `${directory}/${name}`));
        return {
            files,
            directories: filesByDirectory,
        };
    }
    async getFile(host, serial, token, filename) {
        const printer = new BambuPrinter(host, serial, token);
        const normalized = filename.replace(/^\/+/, "");
        const directory = path.posix.dirname(normalized) === "." ? "cache" : path.posix.dirname(normalized);
        const baseName = path.posix.basename(normalized);
        let exists = false;
        await printer.manipulateFiles(async (context) => {
            const entries = await context.readDir(directory);
            exists = entries.includes(baseName);
        });
        return {
            name: `${directory}/${baseName}`,
            exists,
        };
    }
    async uploadFile(host, serial, token, filePath, filename, print) {
        await fs.access(filePath);
        const normalizedFileName = filename.replace(/^\/+/, "");
        const remotePath = normalizedFileName.includes("/")
            ? normalizedFileName
            : `cache/${normalizedFileName}`;
        // Use direct FTP upload (bypasses bambu-js double-path bug)
        await this.ftpUpload(host, token, filePath, `/${remotePath}`);
        const response = {
            status: "success",
            uploaded: true,
            remotePath,
            printRequested: print,
        };
        if (print) {
            if (remotePath.toLowerCase().endsWith(".gcode")) {
                response.startResult = await this.startJob(host, serial, token, remotePath);
            }
            else if (remotePath.toLowerCase().endsWith(".3mf")) {
                response.note =
                    "3MF upload complete. Use print_3mf to start a project print with plate and metadata options.";
            }
            else {
                throw new Error("Automatic print after upload supports .gcode only. Use print_3mf for .3mf project prints.");
            }
        }
        return response;
    }
    async startJob(host, serial, token, filename) {
        const lower = filename.toLowerCase();
        if (lower.endsWith(".3mf") && !lower.endsWith(".gcode.3mf")) {
            throw new Error("Use print_3mf for .3mf project files.");
        }
        const printer = await this.getPrinter(host, serial, token);
        const normalizedFileName = filename.replace(/^\/+/, "");
        const remoteFile = normalizedFileName.includes("/")
            ? normalizedFileName
            : `cache/${normalizedFileName}`;
        await invokeWithoutAck(printer, new GCodeFileCommand({ fileName: remoteFile }));
        return {
            status: "success",
            message: `Start command sent for ${remoteFile}.`,
            file: remoteFile,
        };
    }
    /**
     * Upload a file to the printer via FTP using basic-ftp directly.
     * Bypasses bambu-js's sendFile which has a double-path bug (ensureDir CDs
     * into the target directory, then uploadFrom uses the full relative path
     * again, resulting in e.g. /cache/cache/file.3mf).
     */
    async ftpUpload(host, token, localPath, remotePath) {
        const client = new FTPClient(15000);
        try {
            await client.access({
                host,
                port: 990,
                user: "bblp",
                password: token,
                secure: "implicit",
                secureOptions: ftpsSecureOptions(),
            });
            // With TLS 1.3 the session ticket arrives asynchronously; basic-ftp calls
            // getSession() when opening the data channel and gets undefined if the
            // ticket hasn't arrived yet, causing a fresh TLS negotiation that Bambu
            // printers reject. Wait for the session ticket before proceeding.
            await this.waitForTlsSession(client);
            // Use absolute path to avoid CWD side-effects
            const absoluteRemote = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
            const remoteDir = path.posix.dirname(absoluteRemote);
            await client.ensureDir(remoteDir);
            // uploadFrom with just the basename since we're already in the right dir
            await client.uploadFrom(localPath, path.posix.basename(absoluteRemote));
        }
        finally {
            client.close();
        }
    }
    async waitForTlsSession(ftpClient) {
        const socket = ftpClient.ftp?.socket;
        if (!socket || typeof socket.getSession !== "function")
            return;
        if (socket.getSession())
            return;
        await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 1000);
            socket.once("session", () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }
    async disconnectAll() {
        await this.printerStore.disconnectAll();
    }
}
