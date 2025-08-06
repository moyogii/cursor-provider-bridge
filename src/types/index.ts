export interface BridgeConfiguration {
    readonly providerUrl: string;
    readonly autoStart: boolean;
    readonly showStatusBar: boolean;
    readonly ngrokAuthToken: string;
    readonly ngrokDomain: string;
    readonly ngrokRegion: NgrokRegion;
}

export type NgrokRegion = 'us' | 'eu' | 'au' | 'ap' | 'sa' | 'jp' | 'in';

export type ConfigurationKey = keyof BridgeConfiguration;

export interface TunnelStatus {
    readonly isRunning: boolean;
    readonly isStarting?: boolean;
    readonly url?: string;
    readonly error?: string;
}

export interface ModelInfo {
    readonly id: string;
    readonly object: string;
    readonly created: number;
    readonly owned_by: string;
}

export interface ChatMessage {
    readonly role: 'system' | 'user' | 'assistant';
    readonly content: string;
}

export interface ChatCompletionRequest {
    readonly model: string;
    readonly messages: ReadonlyArray<ChatMessage>;
    readonly temperature?: number;
    readonly stream?: boolean;
    readonly max_tokens?: number;
    readonly top_p?: number;
    readonly frequency_penalty?: number;
    readonly presence_penalty?: number;
}

export interface ChatCompletionChunk {
    readonly id: string;
    readonly object: string;
    readonly created: number;
    readonly model: string;
    readonly choices: ReadonlyArray<{
        readonly index: number;
        readonly delta: {
            readonly content?: string;
            readonly role?: string;
        };
        readonly finish_reason?: string | null;
    }>;
}

export interface ChatCompletionError {
    readonly error: {
        readonly message: string;
        readonly type?: string;
        readonly code?: string;
    };
}

export interface QuickPickOption {
    readonly label: string;
    readonly description?: string;
    readonly detail?: string;
}

export interface SetupData {
    readonly authToken: string;
    readonly customDomain: string;
    readonly providerUrl: string;
    readonly autoStart: boolean;
}

export interface NgrokTunnel {
    url(): string | null;
    close(): Promise<void>;
}

export interface NgrokOptions {
    addr: string;
    region: NgrokRegion;
    authtoken?: string;
    domain?: string;
    [key: string]: unknown;
}

export interface HttpResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly headers: Map<string, string>;
    readonly body?: NodeJS.ReadableStream;
    json(): Promise<unknown>;
    text(): Promise<string>;
}

export interface TunnelStartResult {
    readonly tunnel: NgrokTunnel;
    readonly url: string;
    readonly proxyPort: number;
}

export type Result<T, E = Error> = 
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly error: E };

export interface Logger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, error?: unknown): void;
    debug(message: string, ...args: unknown[]): void;
}

export interface IConfigurationManager {
    getConfiguration(): BridgeConfiguration;
    updateConfiguration<K extends ConfigurationKey>(key: K, value: BridgeConfiguration[K]): Promise<void>;
    reload(): void;
    showConfigurationQuickPick(): Promise<void>;
    onConfigurationChanged(listener: (config: BridgeConfiguration) => void): { dispose(): void };
    dispose(): void;
}

export interface IModelProvider {
    getModels(): Promise<ReadonlyArray<ModelInfo>>;
    isModelLoaded(modelId: string): Promise<boolean>;
    createChatCompletion(request: ChatCompletionRequest): Promise<AsyncIterableIterator<ChatCompletionChunk>>;
}

export interface ITunnelManager {
    start(): Promise<void>;
    stop(): Promise<void>;
    restart(): Promise<void>;
    forceCleanup(): Promise<void>;
    getStatus(): TunnelStatus;
    dispose(): void;
}

export interface ConfigurationChangedEvent {
    readonly key: ConfigurationKey;
    readonly oldValue: unknown;
    readonly newValue: unknown;
}

export interface TunnelStatusChangedEvent {
    readonly oldStatus: TunnelStatus;
    readonly newStatus: TunnelStatus;
}

export class BridgeError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly cause?: unknown
    ) {
        super(message);
        this.name = 'BridgeError';
    }
}

export class ConfigurationError extends BridgeError {
    constructor(message: string, cause?: unknown) {
        super(message, 'CONFIGURATION_ERROR', cause);
        this.name = 'ConfigurationError';
    }
}

export class TunnelError extends BridgeError {
    constructor(message: string, cause?: unknown) {
        super(message, 'TUNNEL_ERROR', cause);
        this.name = 'TunnelError';
    }
}

export class ModelError extends BridgeError {
    constructor(message: string, cause?: unknown) {
        super(message, 'MODEL_ERROR', cause);
        this.name = 'ModelError';
    }
}

export const DEFAULT_CONFIGURATION: BridgeConfiguration = {
    providerUrl: 'http://localhost:1234',
    autoStart: false,
    showStatusBar: true,
    ngrokAuthToken: '',
    ngrokDomain: '',
    ngrokRegion: 'us'
} as const;

export const NGROK_REGIONS: ReadonlyArray<NgrokRegion> = [
    'us', 'eu', 'au', 'ap', 'sa', 'jp', 'in'
] as const;