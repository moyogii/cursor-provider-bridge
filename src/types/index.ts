/**
 * Core types and interfaces for the Cursor Model Bridge extension
 */

// Configuration types
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

// Status types
export interface TunnelStatus {
    readonly isRunning: boolean;
    readonly url?: string;
    readonly error?: string;
}

// Model types
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

// UI types
export interface QuickPickOption {
    readonly label: string;
    readonly description?: string;
    readonly detail?: string;
}

// Result types
export type Result<T, E = Error> = 
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly error: E };

// Logger interface
export interface Logger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, error?: unknown): void;
    debug(message: string, ...args: unknown[]): void;
}

// Service interfaces
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
    testConnection(): Promise<boolean>;
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

// Events
export interface ConfigurationChangedEvent {
    readonly key: ConfigurationKey;
    readonly oldValue: unknown;
    readonly newValue: unknown;
}

export interface TunnelStatusChangedEvent {
    readonly oldStatus: TunnelStatus;
    readonly newStatus: TunnelStatus;
}

// Error types
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

// Constants
export const DEFAULT_CONFIGURATION: BridgeConfiguration = {
    providerUrl: 'http://localhost:1234/v1',
    autoStart: false,
    showStatusBar: true,
    ngrokAuthToken: '',
    ngrokDomain: '',
    ngrokRegion: 'us'
} as const;

export const NGROK_REGIONS: ReadonlyArray<NgrokRegion> = [
    'us', 'eu', 'au', 'ap', 'sa', 'jp', 'in'
] as const;